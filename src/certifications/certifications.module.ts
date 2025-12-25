import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CertificationsController } from './certifications.controller';
import { CertificationsService } from './certifications.service';
import {
  Certification,
  CertificationSchema,
} from './entities/certification.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Certification.name, schema: CertificationSchema },
    ]),
  ],
  controllers: [CertificationsController],
  providers: [CertificationsService],
  exports: [CertificationsService],
})
export class CertificationsModule {}
