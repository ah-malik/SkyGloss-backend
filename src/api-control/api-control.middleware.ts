import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ApiControlService } from './api-control.service';
import { isAlwaysAllowedPath } from './api-registry';

@Injectable()
export class ApiControlMiddleware implements NestMiddleware {
  constructor(private readonly apiControlService: ApiControlService) {}

  use(req: Request, res: Response, next: NextFunction) {
    try {
      const method = req.method || 'GET';
      const pathname = (req.originalUrl || req.url || req.path || '/')
        .split('?')[0];

      if (isAlwaysAllowedPath(pathname, method)) {
        return next();
      }

      // CORS preflight must never be blocked
      if (method.toUpperCase() === 'OPTIONS') {
        return next();
      }

      const portalHeader =
        (req.headers['x-client-app'] as string | undefined) ||
        (req.headers['x-client-portal'] as string | undefined);

      const { block, endpoint } = this.apiControlService.shouldBlockRequest(
        portalHeader,
        method,
        pathname,
      );

      if (block) {
        return res.status(403).json({
          statusCode: 403,
          message: `This API is currently disabled: ${endpoint?.method} ${endpoint?.path}`,
          error: 'API Disabled',
        });
      }
    } catch {
      // Fail-open: never break the platform if control check errors
    }

    return next();
  }
}
