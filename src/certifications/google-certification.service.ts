import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Certification } from './entities/certification.entity';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GoogleCertificationService {
  private readonly logger = new Logger(GoogleCertificationService.name);

  constructor(private readonly configService: ConfigService) {}

  async portToGoogleSheet(
    certification: Certification,
    status: string = 'UNPAID',
  ) {
    const logPath = path.join(process.cwd(), 'porting-debug.log');
    const webappUrl = this.configService.get<string>('GOOGLE_WEBAPP_URL');

    const logEntry = (msg: string) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
      this.logger.log(msg);
    };

    if (!webappUrl) {
      logEntry('[GoogleSheet] ERROR: GOOGLE_WEBAPP_URL is not defined in .env');
      return;
    }

    // Convert Mongoose document to plain object if necessary
    const certData = (certification as any).toObject
      ? (certification as any).toObject()
      : certification;

    const payload = {
      requesterName: certData.requesterName,
      distributorName: certData.distributorName,
      shopName: certData.shopName,
      shopEmail: certData.shopEmail,
      shopPhone: certData.shopPhone,
      country: certData.country,
      streetAddress: certData.shopAddress,
      city: certData.shopCity,
      state: certData.shopState,
      zip: certData.shopZip,
      instagram: certData.shopInstagram || '',
      facebook: certData.shopFacebook || '',
      website: certData.shopWebsite || '',
    };

    logEntry(
      `[GoogleSheet] Attempting port for ${certData.shopName} (Status: ${status}) to ${webappUrl}`,
    );

    try {
      const response = await axios.post(webappUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        maxRedirects: 10,
      });

      logEntry(
        `[GoogleSheet] SUCCESS! Status: ${response.status}, Data: ${JSON.stringify(response.data)}`,
      );
    } catch (error: any) {
      let errorMsg = `[GoogleSheet] FAILED: ${error.message}`;
      if (error.response) {
        errorMsg += ` | Status: ${error.response.status} | Data: ${JSON.stringify(error.response.data)}`;
      }
      logEntry(errorMsg);
    }
  }
}
