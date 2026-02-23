import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { SecModule } from './dataSources/sec/sec.module';
import { NewsModule } from './dataSources/news/news.module';
import { DocumentsModule } from './documents/documents.module';
import { RAGModule } from './rag/rag.module';
import { S3Module } from './s3/s3.module';
import { DealsModule } from './deals/deals.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { TenantModule } from './tenant/tenant.module';
import { ResearchAssistantModule } from './research/research-assistant.module';
import { FilingsModule } from './filings/filings.module';
import { InstantRAGModule } from './instant-rag/instant-rag.module';

const publicPath = join(process.cwd(), 'public');
console.log('📁 Serving static files from:', publicPath);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule.register({ timeout: 20000, maxRedirects: 5 }),
    ServeStaticModule.forRoot({
      rootPath: publicPath,
      serveRoot: '/',
    }),
    PrismaModule,
    TenantModule,
    HealthModule,
    AuthModule,
    AdminModule,
    SecModule,
    NewsModule,
    DocumentsModule,
    RAGModule,
    S3Module,
    DealsModule,
    ResearchAssistantModule,
    FilingsModule,
    InstantRAGModule,
  ],
})
export class AppModule {} 