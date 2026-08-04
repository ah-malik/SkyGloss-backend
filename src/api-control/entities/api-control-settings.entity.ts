import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ApiControlSettingsDocument = ApiControlSettings & Document;

@Schema({ timestamps: true, collection: 'api_control_settings' })
export class ApiControlSettings {
  /** Singleton key — only one settings document is used. */
  @Prop({ required: true, unique: true, default: 'default' })
  key: string;

  /**
   * Endpoint ids that are DISABLED.
   * Anything not listed here is enabled (safe default = all on).
   */
  @Prop({ type: [String], default: [] })
  disabledIds: string[];
}

export const ApiControlSettingsSchema =
  SchemaFactory.createForClass(ApiControlSettings);
