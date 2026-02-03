/**
 * Tenant Response Interceptor
 * 
 * Sanitizes API responses to remove internal tenant identifiers.
 * Prevents information leakage about tenant structure and IDs.
 * 
 * Removes:
 * - tenant_id
 * - tenantId
 * - owner_tenant_id
 * - ownerTenantId
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TenantResponseInterceptor implements NestInterceptor {
  // Fields to remove from responses
  private readonly sensitiveFields = new Set([
    'tenant_id',
    'tenantId',
    'owner_tenant_id',
    'ownerTenantId',
  ]);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => this.sanitizeResponse(data)),
    );
  }

  /**
   * Recursively sanitize response data
   */
  private sanitizeResponse(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeResponse(item));
    }

    // Handle objects
    if (typeof data === 'object') {
      // Handle Date objects
      if (data instanceof Date) {
        return data;
      }

      // Handle Buffer objects
      if (Buffer.isBuffer(data)) {
        return data;
      }

      const sanitized: Record<string, any> = {};
      
      for (const [key, value] of Object.entries(data)) {
        // Skip sensitive fields
        if (this.sensitiveFields.has(key)) {
          continue;
        }

        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeResponse(value);
      }

      return sanitized;
    }

    // Return primitives as-is
    return data;
  }
}
