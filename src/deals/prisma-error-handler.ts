import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Handle Prisma errors and convert them to HTTP exceptions
 * 
 * @param error - Prisma error object
 * @param context - Optional context for better error messages
 * @throws HttpException with appropriate status code and message
 */
export function handlePrismaError(error: any, context?: string): never {
  const contextPrefix = context ? `${context}: ` : '';

  // Unique constraint violation
  if (error.code === 'P2002') {
    const fields = error.meta?.target || ['field'];
    throw new ConflictException(
      `${contextPrefix}A record with this ${fields.join(', ')} already exists`,
    );
  }

  // Record not found
  if (error.code === 'P2025') {
    throw new NotFoundException(
      `${contextPrefix}Record not found`,
    );
  }

  // Foreign key constraint failed
  if (error.code === 'P2003') {
    const field = error.meta?.field_name || 'related record';
    throw new BadRequestException(
      `${contextPrefix}Invalid ${field} - related record does not exist`,
    );
  }

  // Required field missing
  if (error.code === 'P2011') {
    const field = error.meta?.constraint || 'field';
    throw new BadRequestException(
      `${contextPrefix}Required field ${field} is missing`,
    );
  }

  // Invalid value for field type
  if (error.code === 'P2006') {
    const field = error.meta?.field_name || 'field';
    throw new BadRequestException(
      `${contextPrefix}Invalid value for ${field}`,
    );
  }

  // Connection error
  if (error.code === 'P1001' || error.code === 'P1002') {
    throw new InternalServerErrorException(
      'Database connection error. Please try again later.',
    );
  }

  // Timeout
  if (error.code === 'P1008') {
    throw new InternalServerErrorException(
      'Database operation timed out. Please try again.',
    );
  }

  // Table not found
  if (error.code === 'P2021') {
    throw new InternalServerErrorException(
      'Database schema error. Please contact support.',
    );
  }

  // Generic Prisma error
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    throw new InternalServerErrorException(
      `${contextPrefix}Database operation failed: ${error.message}`,
    );
  }

  // Validation error
  if (error instanceof Prisma.PrismaClientValidationError) {
    throw new BadRequestException(
      `${contextPrefix}Invalid data provided`,
    );
  }

  // Unknown Prisma error
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    throw new InternalServerErrorException(
      'An unexpected database error occurred. Please try again.',
    );
  }

  // Not a Prisma error - re-throw
  throw error;
}

/**
 * Wrap a Prisma operation with error handling
 * 
 * @param operation - Async function that performs Prisma operation
 * @param context - Context for error messages
 * @returns Result of the operation
 */
export async function withPrismaErrorHandling<T>(
  operation: () => Promise<T>,
  context?: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    handlePrismaError(error, context);
  }
}
