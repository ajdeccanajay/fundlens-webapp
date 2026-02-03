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

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { ParsingReviewController } from './parsing-review.controller';
import { ParsingReviewService } from './parsing-review.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule, // For CognitoAuthService
  ],
  controllers: [
    PlatformAdminController,
    ParsingReviewController,
  ],
  providers: [
    PlatformAdminService,
    PlatformAdminGuard,
    ParsingReviewService,
  ],
  exports: [PlatformAdminService, ParsingReviewService],
})
export class AdminModule {}
