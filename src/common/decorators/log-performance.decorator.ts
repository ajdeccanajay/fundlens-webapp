import { Logger } from '@nestjs/common';

/**
 * Performance logging decorator
 * Logs execution time of methods and warns on slow queries (>1s)
 * 
 * Usage:
 * @LogPerformance
 * async myMethod() { ... }
 */
export function LogPerformance(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) {
  const originalMethod = descriptor.value;
  const className = target.constructor.name;

  descriptor.value = async function (...args: any[]) {
    const logger = new Logger(className);
    const start = Date.now();

    try {
      const result = await originalMethod.apply(this, args);
      const duration = Date.now() - start;

      // Log execution time
      logger.log(`${propertyKey}() completed in ${duration}ms`);

      // Warn on slow queries (>1s)
      if (duration > 1000) {
        logger.warn(
          `⚠️  SLOW QUERY: ${propertyKey}() took ${duration}ms (threshold: 1000ms)`,
        );
      }

      // Error on very slow queries (>5s)
      if (duration > 5000) {
        logger.error(
          `🔴 CRITICAL: ${propertyKey}() took ${duration}ms (threshold: 5000ms)`,
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(
        `${propertyKey}() failed after ${duration}ms: ${error.message}`,
      );
      throw error;
    }
  };

  return descriptor;
}

/**
 * Performance logging decorator with custom threshold
 * 
 * Usage:
 * @LogPerformanceWithThreshold(500)
 * async myMethod() { ... }
 */
export function LogPerformanceWithThreshold(thresholdMs: number) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;

    descriptor.value = async function (...args: any[]) {
      const logger = new Logger(className);
      const start = Date.now();

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - start;

        // Log execution time
        logger.log(`${propertyKey}() completed in ${duration}ms`);

        // Warn if exceeds custom threshold
        if (duration > thresholdMs) {
          logger.warn(
            `⚠️  SLOW QUERY: ${propertyKey}() took ${duration}ms (threshold: ${thresholdMs}ms)`,
          );
        }

        return result;
      } catch (error) {
        const duration = Date.now() - start;
        logger.error(
          `${propertyKey}() failed after ${duration}ms: ${error.message}`,
        );
        throw error;
      }
    };

    return descriptor;
  };
}
