import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private isConnected = false;

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      errorFormat: 'pretty',
      // Connection pool settings for long-running operations
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.isConnected = false;
    this.logger.log('🔌 Disconnected from PostgreSQL database');
  }

  /**
   * Connect with automatic retry on failure
   */
  private async connectWithRetry(): Promise<void> {
    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      try {
        await this.$connect();
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.logger.log('🔌 Connected to PostgreSQL database');
        return;
      } catch (error) {
        this.reconnectAttempts++;
        this.logger.warn(
          `Database connection failed (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}): ${error.message}`
        );
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          throw new Error(`Failed to connect to database after ${this.maxReconnectAttempts} attempts`);
        }
        
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delay = Math.pow(2, this.reconnectAttempts - 1) * 1000;
        await this.sleep(delay);
      }
    }
  }

  /**
   * Ensure connection is alive, reconnect if needed
   * Call this before long-running operations
   */
  async ensureConnection(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.warn('Database connection lost, attempting to reconnect...');
      this.isConnected = false;
      await this.connectWithRetry();
    }
  }

  /**
   * Execute a query with automatic reconnection on connection errors
   */
  async executeWithRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Ensure connection before operation
        if (attempt > 1) {
          await this.ensureConnection();
        }
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Check if it's a connection error
        const isConnectionError = 
          error.message?.includes('Connection') ||
          error.message?.includes('Closed') ||
          error.message?.includes('ECONNRESET') ||
          error.message?.includes('ETIMEDOUT') ||
          error.code === 'P1001' || // Prisma connection error
          error.code === 'P1002';   // Prisma timeout
        
        if (isConnectionError && attempt < maxRetries) {
          this.logger.warn(`Database operation failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
          const delay = Math.pow(2, attempt - 1) * 1000;
          await this.sleep(delay);
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper method to clean up database (useful for testing)
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'test') {
      const tablenames = await this.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables WHERE schemaname='public'
      `;

      const tables = tablenames
        .map(({ tablename }) => tablename)
        .filter((name) => name !== '_prisma_migrations')
        .map((name) => `"public"."${name}"`)
        .join(', ');

      try {
        await this.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
      } catch (error) {
        console.log({ error });
      }
    }
  }

  // Helper method to get database health status
  async getHealthStatus() {
    try {
      await this.$queryRaw`SELECT 1`;
      return { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
    }
  }
} 