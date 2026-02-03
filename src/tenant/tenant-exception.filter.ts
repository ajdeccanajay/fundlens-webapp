/**
 * Tenant Exception Filter
 * 
 * Sanitizes error responses to prevent information leakage.
 * 
 * Security features:
 * - Returns 404 for all access denied scenarios (prevents enumeration)
 * - Removes tenant identifiers from error messages
 * - Provides consistent error format
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class TenantExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TenantExceptionFilter.name);

  // Patterns to detect and redact tenant identifiers
  private readonly tenantIdPatterns = [
    /tenant[_-]?id[:\s]*['"]?[a-f0-9-]{36}['"]?/gi,
    /tenant[_-]?id[:\s]*['"]?[a-zA-Z0-9_-]+['"]?/gi,
    /owner[_-]?tenant[_-]?id[:\s]*['"]?[a-f0-9-]{36}['"]?/gi,
  ];

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status: number;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
      } else {
        message = exception.message;
      }

      // Convert ForbiddenException to NotFoundException for security
      // This prevents attackers from knowing if a resource exists
      if (exception instanceof ForbiddenException) {
        status = HttpStatus.NOT_FOUND;
        message = 'Resource not found';
        this.logger.debug(
          `Converted 403 to 404 for security: ${request.method} ${request.url}`
        );
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      this.logger.error(`Unknown exception type: ${exception}`);
    }

    // Sanitize the message to remove tenant identifiers
    const sanitizedMessage = this.sanitizeMessage(message);

    // Build response
    const errorResponse = {
      statusCode: status,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }

  /**
   * Remove tenant identifiers from error messages
   */
  private sanitizeMessage(message: string | string[]): string | string[] {
    if (Array.isArray(message)) {
      return message.map(m => this.sanitizeSingleMessage(m));
    }
    return this.sanitizeSingleMessage(message);
  }

  private sanitizeSingleMessage(message: string): string {
    let sanitized = message;

    // Remove tenant ID patterns
    for (const pattern of this.tenantIdPatterns) {
      sanitized = sanitized.replace(pattern, '[redacted]');
    }

    // Remove UUID-like strings that might be tenant IDs
    // Only if they appear in suspicious contexts
    sanitized = sanitized.replace(
      /for tenant [a-f0-9-]{36}/gi,
      'for tenant [redacted]'
    );

    return sanitized;
  }
}
