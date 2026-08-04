import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ApiControlSettings,
  ApiControlSettingsDocument,
} from './entities/api-control-settings.entity';
import {
  ADMIN_APIS,
  ALL_APIS,
  ApiEndpointDef,
  ApiPortal,
  FRONTEND_APIS,
  matchApiEndpoint,
} from './api-registry';
import { ApiToggleUpdateDto } from './dto/update-api-control.dto';

const SETTINGS_KEY = 'default';
/** Security code required to change any API toggle. */
export const API_CONTROL_SECURITY_CODE = '26040';

@Injectable()
export class ApiControlService implements OnModuleInit {
  private readonly logger = new Logger(ApiControlService.name);
  private disabledIds = new Set<string>();
  private cacheReady = false;

  constructor(
    @InjectModel(ApiControlSettings.name)
    private readonly settingsModel: Model<ApiControlSettingsDocument>,
  ) {}

  async onModuleInit() {
    try {
      await this.refreshCache();
    } catch (err) {
      this.logger.warn(
        `API control cache init failed — all APIs remain enabled. ${err}`,
      );
      this.disabledIds = new Set();
      this.cacheReady = true;
    }
  }

  async refreshCache(): Promise<void> {
    const doc = await this.ensureSettings();
    this.disabledIds = new Set(doc.disabledIds || []);
    this.cacheReady = true;
  }

  /**
   * Fast in-memory check used by middleware.
   * Fail-open: if cache is not ready, allow the request.
   */
  isEndpointDisabled(id: string): boolean {
    if (!this.cacheReady) return false;
    return this.disabledIds.has(id);
  }

  /**
   * Resolve whether a client request should be blocked.
   * Unknown portals / unlisted routes are never blocked.
   */
  shouldBlockRequest(
    portalHeader: string | undefined,
    method: string,
    pathname: string,
  ): { block: boolean; endpoint?: ApiEndpointDef } {
    const portal = this.normalizePortal(portalHeader);
    if (!portal) return { block: false };

    const match = matchApiEndpoint(portal, method, pathname);
    if (!match) return { block: false };

    if (this.isEndpointDisabled(match.id)) {
      return { block: true, endpoint: match };
    }
    return { block: false, endpoint: match };
  }

  async getSettings() {
    const doc = await this.ensureSettings();
    const disabled = new Set(doc.disabledIds || []);

    const mapPortal = (apis: ApiEndpointDef[]) => {
      const groups = new Map<
        string,
        Array<{
          id: string;
          method: string;
          path: string;
          label: string;
          enabled: boolean;
        }>
      >();

      for (const api of apis) {
        if (!groups.has(api.group)) groups.set(api.group, []);
        groups.get(api.group)!.push({
          id: api.id,
          method: api.method,
          path: api.path,
          label: api.label,
          enabled: !disabled.has(api.id),
        });
      }

      return Array.from(groups.entries()).map(([group, endpoints]) => ({
        group,
        endpoints,
      }));
    };

    return {
      frontend: mapPortal(FRONTEND_APIS),
      admin: mapPortal(ADMIN_APIS),
      disabledCount: disabled.size,
      updatedAt: (doc as any).updatedAt as Date | undefined,
    };
  }

  async applyUpdates(securityCode: string, updates: ApiToggleUpdateDto[]) {
    this.assertSecurityCode(securityCode);

    const validIds = new Set(ALL_APIS.map((a) => a.id));
    const doc = await this.ensureSettings();
    const next = new Set(doc.disabledIds || []);

    for (const update of updates || []) {
      if (!update?.id || !validIds.has(update.id)) continue;
      if (update.enabled) {
        next.delete(update.id);
      } else {
        next.add(update.id);
      }
    }

    doc.disabledIds = Array.from(next);
    await doc.save();
    this.disabledIds = next;

    return this.getSettings();
  }

  async bulkSetPortal(
    securityCode: string,
    portal: ApiPortal,
    enabled: boolean,
  ) {
    this.assertSecurityCode(securityCode);

    const portalApis = portal === 'admin' ? ADMIN_APIS : FRONTEND_APIS;
    const doc = await this.ensureSettings();
    const next = new Set(doc.disabledIds || []);

    for (const api of portalApis) {
      if (enabled) next.delete(api.id);
      else next.add(api.id);
    }

    doc.disabledIds = Array.from(next);
    await doc.save();
    this.disabledIds = next;

    return this.getSettings();
  }

  private assertSecurityCode(code: string) {
    if (String(code || '').trim() !== API_CONTROL_SECURITY_CODE) {
      throw new ForbiddenException('Invalid security code');
    }
  }

  private normalizePortal(header?: string): ApiPortal | null {
    const v = String(header || '')
      .trim()
      .toLowerCase();
    if (v === 'frontend' || v === 'admin') return v;
    return null;
  }

  private async ensureSettings(): Promise<ApiControlSettingsDocument> {
    let doc = await this.settingsModel.findOne({ key: SETTINGS_KEY }).exec();
    if (!doc) {
      doc = await this.settingsModel.create({
        key: SETTINGS_KEY,
        disabledIds: [],
      });
    }
    return doc;
  }
}
