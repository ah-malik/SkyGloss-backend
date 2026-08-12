import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
  statusCode: number;
  message: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T> | T>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T> | T> {
    const request = context.switchToHttp().getRequest<{ url?: string }>();
    const path = (request.url || '').split('?')[0];

    // Keep Terminus health payloads in native format for uptime monitors
    if (path === '/health' || path.startsWith('/health/')) {
      return next.handle();
    }

    // Stripe expects a simple acknowledgment body
    if (
      path === '/orders/webhook' ||
      path === '/orders/webhook-usa' ||
      path === '/stripe/webhook' ||
      path.endsWith('/orders/webhook') ||
      path.endsWith('/orders/webhook-usa') ||
      path.endsWith('/stripe/webhook')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        data,
        statusCode: context.switchToHttp().getResponse().statusCode,
        message: 'Request successful',
      })),
    );
  }
}
