/**
 * Admin Module
 * 
 * INTERNAL ONLY - Platform administration module.
 * This module provides hidden endpoints for platform-level operations.
 * 
 * Security Notes:
 * - All endpoints are protected by PlatformAdminGuard
 * - Requires x-admin-key header with valid API key
 * - Not documented in public API documentation
 * - All operations are logged for audit purposes
 */

import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RAGModule } from '../rag/rag.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { ParsingReviewController } from './parsing-review.controller';
import { ParsingReviewService } from './parsing-review.service';
import { IntentAnalyticsController } from './intent-analytics.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule, // For CognitoAuthService
    forwardRef(() => RAGModule), // For IntentAnalyticsService - use forwardRef to avoid circular dependency
  ],
  controllers: [
    PlatformAdminController,
    ParsingReviewController,
    IntentAnalyticsController,
  ],
  providers: [
    PlatformAdminService,
    PlatformAdminGuard,
    ParsingReviewService,
  ],
  exports: [PlatformAdminService, ParsingReviewService],
})
export class AdminModule {}
