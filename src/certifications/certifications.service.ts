import {
  Injectable,
  NotFoundException,
  BadRequestException,
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

@Injectable()
export class CertificationsService {
  private stripe: Stripe;

  constructor(
    @InjectModel(Certification.name)
    private certificationModel: Model<CertificationDocument>,
    private configService: ConfigService,
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

    // Create a pending certification request
    const certification = new this.certificationModel({
      ...createDto,
      distributor: userId,
      amount: amount / 100,
    });
    try {
      const session = await this.stripe.checkout.sessions.create({
        line_items: [
          {
            price: 'price_1ShyVv2LCzOLfpYpDkE7JN6P',
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'}/dashboard/distributor?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'}/dashboard/distributor?canceled=true`,
        client_reference_id: certification._id.toString(),
        metadata: {
          certificationId: certification._id.toString(),
        },
      });

      certification.stripeSessionId = session.id;
      await certification.save();

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
      await this.confirmPayment(session.id);
    }

    return { received: true };
  }

  private async confirmPayment(sessionId: string) {
    await this.certificationModel.findOneAndUpdate(
      { stripeSessionId: sessionId },
      { paymentStatus: PaymentStatus.PAID },
    );
  }

  async verifyPayment(sessionId: string) {
    if (!this.stripe) {
      throw new BadRequestException('Stripe is not configured');
    }

    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        await this.confirmPayment(sessionId);
        return { success: true, status: 'paid' };
      }
      return { success: false, status: session.payment_status };
    } catch (error) {
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
    const cert = await this.certificationModel.findByIdAndUpdate(
      id,
      { requestStatus: status },
      { new: true },
    );
    if (!cert) {
      throw new NotFoundException('Certification request not found');
    }
    return cert;
  }
}
