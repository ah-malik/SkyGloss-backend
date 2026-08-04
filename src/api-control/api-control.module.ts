import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ApiControlSettings,
  ApiControlSettingsSchema,
} from './entities/api-control-settings.entity';
import { ApiControlService } from './api-control.service';
import { ApiControlController } from './api-control.controller';
import { ApiControlMiddleware } from './api-control.middleware';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ApiControlSettings.name,
        schema: ApiControlSettingsSchema,
      },
    ]),
  ],
  controllers: [ApiControlController],
  providers: [ApiControlService, ApiControlMiddleware],
  exports: [ApiControlService],
})
export class ApiControlModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ApiControlMiddleware).forRoutes('*');
  }
}
