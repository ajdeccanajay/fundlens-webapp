import { Module, forwardRef } from '@nestjs/common';
import { FilingDetectorService } from './filing-detector.service';
import { FilingDetectionScheduler } from './filing-detection-scheduler.service';
import { FilingDownloadService } from './filing-download.service';
import { FilingNotificationService } from './filing-notification.service';
import { FilingNotificationController } from './filing-notification.controller';
import { RateLimiterService } from './rate-limiter.service';
import { DistributedLockService } from '../common/distributed-lock.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecModule } from '../dataSources/sec/sec.module';
import { S3Module } from '../s3/s3.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [PrismaModule, SecModule, S3Module, forwardRef(() => AgentsModule)],
  controllers: [FilingNotificationController],
  providers: [
    DistributedLockService,
    RateLimiterService,
    FilingDetectorService,
    FilingDetectionScheduler,
    FilingDownloadService,
    FilingNotificationService,
  ],
  exports: [
    DistributedLockService,
    RateLimiterService,
    FilingDetectorService,
    FilingDetectionScheduler,
    FilingDownloadService,
    FilingNotificationService,
  ],
})
export class FilingsModule {}
