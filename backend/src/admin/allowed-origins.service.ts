import { Injectable, Logger } from '@nestjs/common';
import {
  addOrigin,
  isOriginAllowed,
  listOrigins,
  listOriginsDetailed,
  removeRuntimeOrigin,
  type AllowedOrigin,
} from './allowed-origins.state';

@Injectable()
export class AllowedOriginsService {
  private readonly logger = new Logger(AllowedOriginsService.name);

  isAllowed(origin: string): boolean {
    return isOriginAllowed(origin);
  }

  list(): string[] {
    return listOrigins();
  }

  listDetailed(): AllowedOrigin[] {
    return listOriginsDetailed();
  }

  add(origin: string): boolean {
    const added = addOrigin(origin);
    if (added) this.logger.log(`Origin added at runtime: ${origin}`);
    return added;
  }

  remove(origin: string): 'removed' | 'protected' | 'not_found' {
    const result = removeRuntimeOrigin(origin);
    if (result === 'removed') {
      this.logger.log(`Runtime origin removed: ${origin}`);
    }
    return result;
  }
}
