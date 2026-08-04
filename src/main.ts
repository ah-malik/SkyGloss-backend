// Restart Trigger: 2026-04-01 00:50
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  // rawBody: true lets NestJS capture raw body for Stripe webhook verification
  // Do NOT add manual bodyParser middleware — it conflicts with rawBody
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable CORS — allow custom client header for API control
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Client-App',
      'X-Client-Portal',
    ],
    exposedHeaders: ['Content-Disposition'],
  });
  // Global Config
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  console.log('MONGO_URI:', process.env.MONGO_URI);

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('E-commerce API')
    .setDescription('The API documentation for the E-commerce platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
