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
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class CertificationsService {
  private stripe: Stripe;
  private readonly logger = new Logger(CertificationsService.name);

  constructor(
    @InjectModel(Certification.name)
    private certificationModel: Model<CertificationDocument>,
    private configService: ConfigService,
    private googleCertificationService: GoogleCertificationService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
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
      distributor: userId,
      amount: amount / 100,
      paymentStatus: PaymentStatus.PENDING,
      requestStatus: RequestStatus.PENDING,
    });
    await certification.save();

    const baseUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'https://portal.skygloss.com';
    this.logger.log(
      `Creating Checkout Session for ${certification.shopName}, baseUrl: ${baseUrl}`,
    );

    try {
      const session = await this.stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product: 'prod_U4nSmaaZP83BMv',
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${baseUrl}/dashboard/distributor?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/dashboard/distributor?canceled=true`,
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
        user: cert.distributor as any,
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
      .find({ distributor: userId as any })
      .sort({ createdAt: -1 });
  }

  async getAllRequests() {
    return this.certificationModel
      .find()
      .populate('distributor', 'firstName lastName email')
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
    }

    return cert;
  }
}
