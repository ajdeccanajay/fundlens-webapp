import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

/**
 * Global HTTP Exception Filter
 * 
 * Catches all exceptions and formats them consistently
 * Provides user-friendly error messages
 * Logs errors with context for debugging
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any = null;
    let userMessage: string | null = null;

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        userMessage = this.getUserFriendlyMessage(status, message);
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        details = (exceptionResponse as any).details;
        userMessage = this.getUserFriendlyMessage(status, message);
      }
    } 
    // Handle standard errors
    else if (exception instanceof Error) {
      message = exception.message;
      userMessage = 'An unexpected error occurred. Please try again.';
      
      // Log stack trace for debugging
      this.logger.error(
        `Unhandled error: ${message}`,
        exception.stack,
      );
    }
    // Handle unknown exceptions
    else {
      message = 'Unknown error occurred';
      userMessage = 'An unexpected error occurred. Please try again.';
      this.logger.error(`Unknown exception type:`, exception);
    }

    // Log error with context
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      {
        method: request.method,
        url: request.url,
        status,
        message,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      },
    );

    // Send formatted response
    response.status(status).json({
      success: false,
      statusCode: status,
      message: userMessage || message,
      technicalMessage: message, // For debugging
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  /**
   * Convert technical error messages to user-friendly messages
   */
  private getUserFriendlyMessage(status: number, message: string): string {
    // Authentication errors
    if (status === HttpStatus.UNAUTHORIZED) {
      return 'Your session has expired. Please log in again.';
    }

    // Permission errors
    if (status === HttpStatus.FORBIDDEN) {
      return 'You don\'t have permission to access this resource.';
    }

    // Not found errors
    if (status === HttpStatus.NOT_FOUND) {
      if (message.toLowerCase().includes('deal')) {
        return 'Deal not found. Please check your selection.';
      }
      if (message.toLowerCase().includes('ticker')) {
        return 'Company not found. Please check the ticker symbol.';
      }
      return 'The requested resource was not found.';
    }

    // Validation errors
    if (status === HttpStatus.BAD_REQUEST) {
      if (message.toLowerCase().includes('required')) {
        return 'Missing required information. Please check your input.';
      }
      if (message.toLowerCase().includes('invalid')) {
        return 'Invalid input. Please check your data and try again.';
      }
      return message; // Return specific validation message
    }

    // Conflict errors
    if (status === HttpStatus.CONFLICT) {
      return 'This record already exists. Please use a different value.';
    }

    // Rate limiting
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return 'Too many requests. Please wait a moment and try again.';
    }

    // Server errors
    if (status >= 500) {
      return 'Server error. Our team has been notified. Please try again later.';
    }

    // Default: return original message
    return message;
  }
}
