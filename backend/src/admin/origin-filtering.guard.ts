import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { isFilteringEnabled } from './allowed-origins.state';

/**
 * Refuses admin requests when ORIGIN_FILTERING_ENABLED is off — managing
 * a list that nothing consults would be misleading. Returns 403 with an
 * explicit reason so the SPA can hide Super Mode entirely instead of
 * showing a token field that can never succeed.
 */
@Injectable()
export class OriginFilteringEnabledGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (!isFilteringEnabled()) {
      throw new ForbiddenException(
        'Origin filtering is disabled (ORIGIN_FILTERING_ENABLED=false). ' +
          'Enable it in .env and restart to use Super Mode.',
      );
    }
    return true;
  }
}
