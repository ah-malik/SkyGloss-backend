import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
    handleRequest(err, user, info) {
        if (err) {
            console.error('[OptionalJwtAuthGuard] Error:', err);
        }
        if (info) {
            console.log('[OptionalJwtAuthGuard] Info:', info.message || info);
        }

        // If there is an error or no user, just return null instead of throwing
        if (err || !user) {
            console.log('[OptionalJwtAuthGuard] User: NULL');
            return null;
        }
        console.log('[OptionalJwtAuthGuard] User found:', user.username || (user as any)._id);
        return user;
    }
}
