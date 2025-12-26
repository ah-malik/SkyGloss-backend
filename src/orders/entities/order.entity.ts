import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from '../../users/entities/user.entity';

export type OrderDocument = Order & Document;

export enum OrderStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    SHIPPED = 'SHIPPED',
    DELIVERED = 'DELIVERED',
    CANCELLED = 'CANCELLED',
    FAILED = 'FAILED',
}

@Schema()
export class OrderItem {
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
    product: string;

    @Prop({ required: true })
    name: string;

    @Prop({ required: true })
    size: string;

    @Prop({ required: true })
    quantity: number;

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
}

@Schema({ timestamps: true })
export class Order {
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
    user: User;

    @Prop({ type: [OrderItem], required: true })
    items: OrderItem[];

    @Prop({ required: true })
    totalAmount: number;

    @Prop({ type: ShippingAddress, required: true })
    shippingAddress: ShippingAddress;

    @Prop({ type: String, enum: OrderStatus, default: OrderStatus.PENDING })
    status: OrderStatus;

    @Prop({ required: true, unique: true })
    orderNumber: string;

    @Prop()
    stripeSessionId: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
