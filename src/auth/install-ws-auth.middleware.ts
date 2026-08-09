import { Server } from 'socket.io';
import { WsAuthService } from './ws-auth.service';

const INSTALLED = Symbol.for('skygloss.wsAuthMiddleware');

/**
 * Install once on the shared Socket.IO server so JWT auth finishes
 * during the handshake — before the client receives `connect`.
 * Prevents join_room/send_message racing ahead of handleConnection.
 */
export function installWsAuthMiddleware(
  server: Server,
  wsAuthService: WsAuthService,
): void {
  const anyServer = server as any;
  if (anyServer[INSTALLED]) return;
  anyServer[INSTALLED] = true;

  server.use(async (socket, next) => {
    try {
      const user = await wsAuthService.authenticateSocket(socket);
      if (!user) {
        return next(new Error('Unauthorized'));
      }
      socket.data.user = user;
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });
}
