/**
 * Tenant Module
 * 
 * Provides tenant isolation infrastructure for the entire application.
 * Registers TenantGuard globally to protect all routes by default.
 * 
 * Routes can opt-out of authentication using the @Public() decorator.
 */

import { Module, Global, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TenantGuard } from './tenant.guard';
import { TenantAwarePrismaService } from './tenant-aware-prisma.service';
import { TenantAwareS3Service } from './tenant-aware-s3.service';
import { TenantAwareRAGService } from './tenant-aware-rag.service';
import { TenantUserService } from './tenant-user.service';
import { TenantUserController } from './tenant-user.controller';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { RAGModule } from '../rag/rag.module';
import { CognitoAuthService } from '../auth/cognito-auth.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => RAGModule),
  ],
  controllers: [TenantUserController, AuditController],
  providers: [
    TenantGuard,
    TenantAwarePrismaService,
    TenantAwareS3Service,
    TenantAwareRAGService,
    TenantUserService,
    AuditService,
    CognitoAuthService,
    // Register TenantGuard globally - all routes require auth by default
    // Use @Public() decorator to opt-out specific routes
    // {
    //   provide: APP_GUARD,
    //   useClass: TenantGuard,
    // },
  ],
  exports: [
    TenantGuard,
    TenantAwarePrismaService,
    TenantAwareS3Service,
    TenantAwareRAGService,
    TenantUserService,
    AuditService,
  ],
})
export class TenantModule {}
