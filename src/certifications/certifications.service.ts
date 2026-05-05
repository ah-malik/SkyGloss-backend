import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  Certification,
  CertificationDocument,
  PaymentStatus,
  RequestStatus,
} from './entities/certification.entity';
import { CreateCertificationDto } from './dto/create-certification.dto';
import { GoogleCertificationService } from './google-certification.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { MailService } from '../mail/mail.service';
import { PdfService } from '../pdf/pdf.service';
import { NotificationType } from '../notifications/entities/notification.entity';

import { User, UserDocument, UserRole } from '../users/entities/user.entity';

import * as XLSX from 'xlsx';

@Injectable()
export class CertificationsService {
  private stripe: Stripe;
  private readonly logger = new Logger(CertificationsService.name);

  constructor(
    @InjectModel(Certification.name)
    private certificationModel: Model<CertificationDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private configService: ConfigService,
    private googleCertificationService: GoogleCertificationService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
    private mailService: MailService,
    private pdfService: PdfService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const stripeApiVersion =
      this.configService.get<string>('STRIPE_API_VERSION') || '2022-11-15';
    if (!stripeSecretKey) {
      console.warn(
        'STRIPE_SECRET_KEY is not defined in the environment variables',
      );
      this.stripe = undefined as any;
    } else {
      // Basic validation: ensure it's a string and looks like a Stripe secret key
      if (
        typeof stripeSecretKey !== 'string' ||
        !/^sk_(test|live)_[A-Za-z0-9]+/.test(stripeSecretKey)
      ) {
        console.error(
          'STRIPE_SECRET_KEY appears to be malformed or not a plain string.',
        );
        throw new BadRequestException(
          'Invalid STRIPE_SECRET_KEY format. Ensure you set the literal secret key (sk_test_... or sk_live_...) in your environment.',
        );
      }
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: stripeApiVersion as Stripe.LatestApiVersion,
      });
    }
  }

  async createCheckoutSession(
    userId: string,
    createDto: CreateCertificationDto,
  ) {
    console.log('Received DTO:', createDto);
    console.log(
      'STRIPE_SECRET_KEY:',
      this.configService.get('STRIPE_SECRET_KEY')?.slice(0, 10) + '...',
    );
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe is not configured on the server. Please set STRIPE_SECRET_KEY.',
      );
    }
    const amount = 2500; // $25.00 in cents

    // 1. Save record FIRST to guarantee it exists in DB before Stripe/Webhook/Verification hits
    const certification = new this.certificationModel({
      ...createDto,
      partner: userId,
      partnerName: createDto.distributorName, // Keep DTO as is for now or update DTO later
      amount: amount / 100,
      paymentStatus: PaymentStatus.PENDING,
      requestStatus: RequestStatus.PENDING,
    });
    await certification.save();

    let baseUrl = (this.configService.get<string>('FRONTEND_URL') || '').replace(/\/+$/, '');
    if (!baseUrl) baseUrl = 'https://portal.skygloss.com';
    this.logger.log(
      `Creating Checkout Session for ${certification.shopName}, baseUrl: ${baseUrl}`,
    );

    try {
      const session = await this.stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Certification Request Fee',
                description: `Shop Certification Request for ${certification.shopName}`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${baseUrl}/dashboard/partner?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/dashboard/partner?canceled=true`,
        client_reference_id: certification._id.toString(),
        metadata: {
          certificationId: certification._id.toString(),
        },
      });

      certification.stripeSessionId = session.id;
      await certification.save();

      // Create notification for admin
      const notification = await this.notificationsService.create({
        type: NotificationType.CERT_REQUEST,
        title: 'New Certification Request',
        message: `New certificate request from ${certification.shopName}.`,
        metadata: {
          certificationId: certification._id,
          shopName: certification.shopName,
        },
        user: userId,
        triggeredBy: userId,
        link: `/certification-requests`,
      });
      this.notificationsGateway.broadcastNotification(notification);

      // Data will be ported to Google Sheet only after payment is confirmed
      this.logger.log(
        `Certification created for ${certification.shopName}, waiting for payment...`,
      );

      return { url: session.url };
    } catch (error) {
      throw new BadRequestException(
        `Stripe session creation failed: ${error.message}`,
      );
    }
  }

  async handleWebhook(sig: string, payload: Buffer) {
    const endpointSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!endpointSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured');
    }
    let event: Stripe.Event;

    try {
      if (!this.stripe) {
        throw new BadRequestException(
          'Stripe is not configured on the server.',
        );
      }
      event = this.stripe.webhooks.constructEvent(payload, sig, endpointSecret);
    } catch (err) {
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const certificationId =
        session.client_reference_id || session.metadata?.certificationId;
      await this.confirmPayment(session.id, certificationId);
    }

    return { received: true };
  }

  private async confirmPayment(sessionId: string, certificationId?: string) {
    this.logger.log(
      `[confirmPayment] session: ${sessionId}, certId: ${certificationId}`,
    );

    let existing;
    if (certificationId) {
      existing = await this.certificationModel.findById(certificationId);
    }

    if (!existing) {
      existing = await this.certificationModel.findOne({
        stripeSessionId: sessionId,
      });
    }

    if (!existing) {
      this.logger.warn(
        `[confirmPayment] FAILED: Record not found for session ${sessionId} / cert ${certificationId}`,
      );
      return;
    }

    if (existing.paymentStatus === PaymentStatus.PAID) {
      this.logger.warn(
        `[confirmPayment] SKIPPED: Already PAID for ${existing._id}`,
      );
      return;
    }

    this.logger.log(
      `[confirmPayment] SUCCESS: Updating ${existing._id} (Shop: ${existing.shopName}) to PAID`,
    );
    const cert = await this.certificationModel.findByIdAndUpdate(
      existing._id,
      { $set: { paymentStatus: PaymentStatus.PAID } },
      { new: true },
    );

    if (cert) {
      // Port to Google Sheet as PAID - only happens once
      this.logger.log(`Porting to Google Sheet for ${cert.shopName}`);
      this.googleCertificationService
        .portToGoogleSheet(cert, 'PAID')
        .catch((err) => {
          this.logger.error(`Payment porting failed: ${err.message}`);
        });

      // Create notification for admin
      const notification = await this.notificationsService.create({
        type: NotificationType.CERT_PAID,
        title: 'Certification Paid',
        message: `Certification for ${cert.shopName} has been paid.`,
        metadata: { certificationId: cert._id, shopName: cert.shopName },
        user: cert.partner as any,
        triggeredBy: cert.partner as any,
        link: `/certification-requests`,
      });
      this.notificationsGateway.broadcastNotification(notification);
    }
  }

  async verifyPayment(sessionId: string) {
    this.logger.log(`Verifying payment for session: ${sessionId}`);
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      this.logger.log(`Stripe session status: ${session.payment_status}`);
      if (session.payment_status === 'paid') {
        const certId =
          session.client_reference_id || session.metadata?.certificationId;
        await this.confirmPayment(sessionId, certId);
        return { success: true, status: 'paid' };
      }
      return { success: false, status: session.payment_status };
    } catch (error) {
      this.logger.error(
        `Verification failed for session ${sessionId}: ${error.message}`,
      );
      throw new BadRequestException(`Verification failed: ${error.message}`);
    }
  }
  async getMyRequests(userId: string) {
    return this.certificationModel
      .find({ partner: userId as any })
      .sort({ createdAt: -1 });
  }

  async getAllRequests() {
    return this.certificationModel
      .find()
      .populate('partner', 'firstName lastName email')
      .sort({ createdAt: -1 });
  }

  async updateStatus(id: string, status: RequestStatus) {
    const updateData: any = { requestStatus: status };

    if (status === RequestStatus.APPROVED) {
      // Generate certificate number: SG-CERT-2026-XXXX
      const year = new Date().getFullYear();
      const randomPart = Math.floor(1000 + Math.random() * 9000);
      updateData.certificateNumber = `SG-CERT-${year}-${randomPart}`;
    }

    const cert = await this.certificationModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true },
    );

    if (!cert) {
      throw new NotFoundException('Certification request not found');
    }

    if (status === RequestStatus.APPROVED) {
      // Port to Google Sheet asynchronously
      this.googleCertificationService
        .portToGoogleSheet(cert, 'APPROVED')
        .catch((err) => {
          this.logger.error(`Failed to port to Google Sheet: ${err.message}`);
        });

      // Generate PDF and dispatch via email
      (async () => {
        try {
          // PdfService expects a user object with shopName
          const certificateBuffer = await this.pdfService.generateCertificate(cert as any);
          await this.mailService.sendCertificateEmail(cert.shopEmail, cert.shopName, certificateBuffer);
        } catch (emailErr) {
          this.logger.error(`Failed to generate or send certificate email to ${cert.shopEmail}: ${emailErr.message}`);
        }
      })();
    }

    return cert;
  }

  async getCertificationStatusSummary() {
    // Only query certified_shop users
    const shops = await this.userModel.find({ 
      role: UserRole.CERTIFIED_SHOP
    });
    const requests = await this.certificationModel.find().sort({ createdAt: -1 });

    const summary = await Promise.all(shops.map(async (shop) => {
      // Find partner details
      const partner = await this.userModel.findOne({ partnerCode: shop.referredByPartnerCode });

      // Find relevant certification request
      const shopRequest = requests.find(r => 
        (shop.email && (r as any).shopEmail?.toLowerCase() === shop.email?.toLowerCase()) || 
        (shop.shopName && (r as any).shopName?.toLowerCase() === shop.shopName?.toLowerCase()) ||
        (shop.companyName && (r as any).shopName?.toLowerCase() === shop.companyName?.toLowerCase()) ||
        (shop.firstName && shop.lastName && (r as any).firstName?.toLowerCase() === shop.firstName?.toLowerCase() && (r as any).lastName?.toLowerCase() === shop.lastName?.toLowerCase())
      );

      // Only isCertified === true on the user record counts as Approved
      let status = 'Training in Progress';
      if (shop.isCertified === true) {
        status = 'Approved';
      } else if (shopRequest) {
        if (shopRequest.paymentStatus === PaymentStatus.PAID) {
          status = 'Applied';
        } else if (shop.isTrainingComplete) {
          status = 'Course Complete (Not Applied)';
        }
      } else if (shop.isTrainingComplete) {
        status = 'Course Complete (Not Applied)';
      }

      return {
        userId: shop._id.toString(),
        shopName: shop.shopName || shop.companyName || 'N/A',
        firstName: shop.firstName,
        lastName: shop.lastName,
        email: shop.email,
        country: shop.country,
        city: shop.city,
        partnerName: partner ? `${partner.firstName} ${partner.lastName}` : 'N/A',
        partnerEmail: partner?.email || 'N/A',
        partnerCode: shop.referredByPartnerCode || 'N/A',
        isTrainingComplete: shop.isTrainingComplete,
        isCertified: shop.isCertified,
        status,
        appliedDate: (shopRequest as any)?.createdAt,
      };
    }));

    return summary;
  }

  async emailCertificationStatusSummary(email: string) {
    const summary = await this.getCertificationStatusSummary();
    
    // Prepare data for Excel
    const data = summary.map(item => ({
      'Shop Name': item.shopName,
      'First Name': item.firstName,
      'Last Name': item.lastName,
      'Email': item.email,
      'Country': item.country,
      'City': item.city,
      'Partner': item.partnerName,
      'Partner Code': item.partnerCode,
      'Training Complete': item.isTrainingComplete ? 'Yes' : 'No',
      'Certified': item.isCertified ? 'Yes' : 'No',
      'Status': item.status,
      'Applied Date': item.appliedDate ? new Date(item.appliedDate).toLocaleDateString() : 'N/A'
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Certification Summary');
    
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    await this.mailService.sendCertificationSummaryEmail(email, buffer);

    return { success: true, message: `Report sent to ${email}` };
  }
}
