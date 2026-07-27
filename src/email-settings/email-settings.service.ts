import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EmailSettings,
  EmailSettingsDocument,
  EmailTemplateVersion,
} from './entities/email-settings.entity';

const SETTINGS_KEY = 'default';

@Injectable()
export class EmailSettingsService {
  constructor(
    @InjectModel(EmailSettings.name)
    private readonly emailSettingsModel: Model<EmailSettingsDocument>,
  ) {}

  async getSettings(): Promise<{
    templateVersion: EmailTemplateVersion;
    updatedAt?: Date;
  }> {
    const doc = await this.ensureSettings();
    return {
      templateVersion: doc.templateVersion,
      updatedAt: (doc as any).updatedAt,
    };
  }

  async getTemplateVersion(): Promise<EmailTemplateVersion> {
    const doc = await this.ensureSettings();
    return doc.templateVersion || 'legacy';
  }

  async isLatestActive(): Promise<boolean> {
    return (await this.getTemplateVersion()) === 'latest';
  }

  async setTemplateVersion(templateVersion: EmailTemplateVersion) {
    const doc = await this.emailSettingsModel
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { templateVersion } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    return {
      templateVersion: doc.templateVersion,
      updatedAt: (doc as any).updatedAt,
    };
  }

  private async ensureSettings(): Promise<EmailSettingsDocument> {
    let doc = await this.emailSettingsModel.findOne({ key: SETTINGS_KEY }).exec();
    if (!doc) {
      doc = await this.emailSettingsModel.create({
        key: SETTINGS_KEY,
        templateVersion: 'legacy',
      });
    }
    return doc;
  }
}
