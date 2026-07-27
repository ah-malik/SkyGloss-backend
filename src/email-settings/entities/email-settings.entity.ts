import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmailTemplateVersion = 'legacy' | 'latest';

export type EmailSettingsDocument = EmailSettings & Document;

@Schema({ timestamps: true, collection: 'email_settings' })
export class EmailSettings {
  /** Singleton key — only one settings document is used. */
  @Prop({ required: true, unique: true, default: 'default' })
  key: string;

  /**
   * Which customer email templates are active.
   * - legacy: current inline templates in mail.service.ts
   * - latest: new branded draft templates
   */
  @Prop({ required: true, enum: ['legacy', 'latest'], default: 'legacy' })
  templateVersion: EmailTemplateVersion;
}

export const EmailSettingsSchema = SchemaFactory.createForClass(EmailSettings);
