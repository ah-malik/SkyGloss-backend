import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type InventoryDocument = Inventory & Document;

@Schema({ timestamps: true })
export class Inventory {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  bottlesAndPackaging: number;

  @Prop({ type: Number, default: 0, min: 0 })
  boxes: number;

  @Prop({ type: Number, default: 0, min: 0 })
  labels: number;

  @Prop({ type: Number, default: 0, min: 0 })
  components: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const InventorySchema = SchemaFactory.createForClass(Inventory);
