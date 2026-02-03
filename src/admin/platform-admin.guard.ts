/**
 * Platform Admin Guard
 * 
 * Protects internal admin endpoints with API key authentication.
 * This guard is used for platform-level operations that should never
 * be accessible to regular users or tenant admins.
 * 
 * Security:
 * - API key must be provided in x-admin-key header
 * - Keys are stored in environment variables (should use AWS Secrets Manager in production)
 * - All access attempts are logged
 * - Failed attempts do not reveal whether the endpoint exists
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly logger = new Logger(PlatformAdminGuard.name);
  private adminKeys: Set<string> | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Lazily load admin keys on first request
   * This ensures ConfigService has loaded all env vars
   */
  private getAdminKeys(): Set<string> {
    if (this.adminKeys !== null) {
      return this.adminKeys;
    }

    // Load admin keys from environment via ConfigService
    const primaryKey = this.configService.get<string>('PLATFORM_ADMIN_KEY');
    const secondaryKey = this.configService.get<string>('PLATFORM_ADMIN_KEY_SECONDARY');
    
    this.adminKeys = new Set<string>();
    
    if (primaryKey && primaryKey.trim()) {
      this.adminKeys.add(this.hashKey(primaryKey.trim()));
      this.logger.log('Primary admin key configured');
    }
    if (secondaryKey && secondaryKey.trim()) {
      this.adminKeys.add(this.hashKey(secondaryKey.trim()));
      this.logger.log('Secondary admin key configured');
    }

    if (this.adminKeys.size === 0) {
      this.logger.warn('No platform admin keys configured - admin endpoints will be inaccessible');
    }

    return this.adminKeys;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const adminKey = request.headers['x-admin-key'] as string;
    const clientIp = this.getClientIp(request);
    const userAgent = request.headers['user-agent'] || 'unknown';

    // Log all access attempts (successful or not)
    this.logger.log(`Admin access attempt from IP: ${clientIp}, UA: ${userAgent.substring(0, 50)}`);

    if (!adminKey) {
      this.logger.warn(`Admin access denied - no key provided from IP: ${clientIp}`);
      // Return generic 401 to not reveal endpoint exists
      throw new UnauthorizedException();
    }

    const hashedKey = this.hashKey(adminKey);
    const adminKeys = this.getAdminKeys();
    
    if (!adminKeys.has(hashedKey)) {
      this.logger.warn(`Admin access denied - invalid key from IP: ${clientIp}`);
      // Return generic 401 to not reveal endpoint exists
      throw new UnauthorizedException();
    }

    // Log successful access
    this.logger.log(`Admin access granted to IP: ${clientIp}`);
    
    // Attach admin context to request
    (request as any).isplatformAdmin = true;
    (request as any).adminIp = clientIp;

    return true;
  }

  /**
   * Hash the API key for secure comparison
   * We don't store raw keys in memory
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Get client IP, handling proxies
   */
  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = (forwarded as string).split(',');
      return ips[0].trim();
    }
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
