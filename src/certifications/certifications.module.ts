import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { CertificationsService } from './certifications.service';
import { CertificationsController } from './certifications.controller';
import {
  Certification,
  CertificationSchema,
} from './entities/certification.entity';
import { GoogleCertificationService } from './google-certification.service';
import { MailModule } from '../mail/mail.module';
import { PdfModule } from '../pdf/pdf.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certification.name, schema: CertificationSchema },
    ]),
    MailModule,
    PdfModule,
    UsersModule,
  ],
  controllers: [CertificationsController],
  providers: [CertificationsService, GoogleCertificationService],
  exports: [CertificationsService, GoogleCertificationService],
})
export class CertificationsModule {}
