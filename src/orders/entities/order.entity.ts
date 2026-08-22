import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from '../../users/entities/user.entity';

export type OrderDocument = Order & Document;

export enum OrderStatus {
  PENDING = 'PENDING',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

@Schema()
export class OrderItem {
  @Prop({ type: String, required: true })
  product: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  size: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ type: String, enum: ['unit', 'case'], default: 'unit' })
  orderType?: 'unit' | 'case';

  @Prop({ required: true })
  price: number;

  @Prop()
  image: string;
}

@Schema()
export class ShippingAddress {
  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop()
  companyName: string;

  @Prop()
  address2: string;

  @Prop({ required: true })
  address: string;


  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  state: string;

  @Prop({ required: true })
  zipCode: string;

  @Prop({ required: true })
  country: string;

  @Prop({ required: true })
  phoneNumber: string;

  @Prop()
  taxId: string;
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User;

  @Prop({ type: [OrderItem], required: true })
  items: OrderItem[];

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ default: 0 })
  shippingFee?: number;

  @Prop({ type: ShippingAddress, required: true })
  shippingAddress: ShippingAddress;

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Prop({ required: true, unique: true })
  orderNumber: string;

  /** request = manual order request; purchase = Stripe checkout / buy flow */
  @Prop({ type: String, enum: ['request', 'purchase'] })
  orderFlow?: 'request' | 'purchase';

  @Prop({ default: 'USD' })
  currency: string;

  /** Currency the customer was charged in (locked at order creation). */
  @Prop()
  originalCurrency?: string;

  /** Amount in original currency (locked at order creation). */
  @Prop()
  originalAmount?: number;

  /** 1 originalCurrency = X baseCurrency at order time (never updated). */
  @Prop()
  exchangeRateAtOrderTime?: number;

  @Prop({ default: 'USD' })
  baseCurrency?: string;

  /** Order value converted to base currency using locked rate. */
  @Prop()
  baseCurrencyAmount?: number;

  @Prop({ default: 0 })
  discount?: number;

  @Prop()
  couponCode?: string;

  @Prop()
  stripeSessionId: string;

  @Prop()
  trackingId: string;

  @Prop()
  shippingCompany: string;

  /**
   * Parent Link (Hub or Distributor) at order creation.
   * Locked so later Parent Link changes do not move historical order management.
   */
  @Prop()
  actingParentPartnerCode?: string;

  /** Set when order is first marked SHIPPED (30-day commission hold starts). */
  @Prop()
  shippedAt?: Date;

  /**
   * Set when product inventory was deducted for the acting Hub/Distributor.
   * Used for idempotent deduct/restore across webhooks and status updates.
   */
  @Prop()
  inventoryDeductedAt?: Date;

  @Prop()
  cancellationReason?: string;

  @Prop({ default: 0 })
  paymentReminderCount?: number;

  @Prop({ type: [Object], default: [] })
  commissions?: {
    recipientUserId: string;
    recipientPartnerCode: string;
    recipientRole: string;
    earningType?: 'Shop Introduction' | 'Partner Development' | 'Operational Support';
    percentage: number;
    amount: number;
    status: 'pending' | 'earned';
    shopId?: string;
    orderAmount?: number;
    originalCurrency?: string;
    exchangeRate?: number;
    convertedUsdAmount?: number;
  }[];
}

export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ 'commissions.recipientPartnerCode': 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ 'commissions.recipientUserId': 1, createdAt: -1 });
OrderSchema.index({ orderFlow: 1, status: 1, createdAt: -1 });
OrderSchema.index({ stripeSessionId: 1 }, { sparse: true });
OrderSchema.index({ shippedAt: 1, status: 1 });
