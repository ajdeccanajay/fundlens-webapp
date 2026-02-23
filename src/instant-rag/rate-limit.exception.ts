/**
 * Rate Limit Exception for Instant RAG
 * 
 * Custom exception that returns 429 status with Retry-After header.
 * Used when tenant or user+deal session limits are exceeded.
 * 
 * Requirements: 13.3, 13.4
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimitExceptionResponse {
  statusCode: number;
  message: string;
  error: string;
  retryAfterSeconds: number;
  limitType: 'tenant_sessions' | 'user_deal_session';
}

export class RateLimitException extends HttpException {
  constructor(
    message: string,
    retryAfterSeconds: number,
    limitType: 'tenant_sessions' | 'user_deal_session',
  ) {
    const response: RateLimitExceptionResponse = {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message,
      error: 'Too Many Requests',
      retryAfterSeconds,
      limitType,
    };
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }

  getRetryAfterSeconds(): number {
    const response = this.getResponse() as RateLimitExceptionResponse;
    return response.retryAfterSeconds;
  }

  getLimitType(): string {
    const response = this.getResponse() as RateLimitExceptionResponse;
    return response.limitType;
  }
}
