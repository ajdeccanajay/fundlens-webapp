/**
 * Rate Limit Exception Filter
 * 
 * Catches RateLimitException and adds the Retry-After header to the response.
 * 
 * Requirements: 13.3, 13.4
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RateLimitException, RateLimitExceptionResponse } from './rate-limit.exception';

@Catch(RateLimitException)
export class RateLimitExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RateLimitExceptionFilter.name);

  catch(exception: RateLimitException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as RateLimitExceptionResponse;

    // Log the rate limit violation
    this.logger.warn(
      `Rate limit response: ${exceptionResponse.message} (retry after ${exceptionResponse.retryAfterSeconds}s)`,
    );

    // Set Retry-After header (in seconds)
    response.setHeader('Retry-After', exceptionResponse.retryAfterSeconds.toString());

    // Return the error response
    response.status(status).json({
      statusCode: status,
      message: exceptionResponse.message,
      error: exceptionResponse.error,
      retryAfterSeconds: exceptionResponse.retryAfterSeconds,
      limitType: exceptionResponse.limitType,
      timestamp: new Date().toISOString(),
    });
  }
}
