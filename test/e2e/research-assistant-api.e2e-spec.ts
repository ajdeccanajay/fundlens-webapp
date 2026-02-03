/**
 * E2E API Tests for Research Assistant
 * 
 * Tests the Research Assistant API endpoints with mocked authentication.
 * Focuses on API functionality rather than full authentication flow.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ResearchAssistantModule } from '../../src/research/research-assistant.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RAGModule } from '../../src/rag/rag.module';
import { TenantModule } from '../../src/tenant/tenant.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Research Assistant API E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenantId = '00000000-0000-0000-0000-000000000000';
  const userId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PrismaModule,
        TenantModule,
        RAGModule,
        ResearchAssistantModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    // Mock tenant guard to inject tenant context
    app.use((req: any, res, next) => {
      req['tenant-context'] = {
        tenantId,
        tenantSlug: 'test-tenant',
        tenantTier: 'pro',
        userId,
        userEmail: 'test@example.com',
        userRole: 'analyst',
        permissions: {
          canCreateDeals: true,
          canDeleteDeals: true,
          canUploadDocuments: true,
          canManageUsers: false,
          canViewAuditLogs: false,
          canExportData: true,
          maxDeals: 50,
          maxUploadsGB: 10,
        },
      };
      next();
    });
    
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.$executeRaw`
      DELETE FROM research_conversations 
      WHERE tenant_id = ${tenantId}::uuid 
      AND user_id = ${userId}::uuid
    `;
    await app.close();
  });

  describe('Conversation CRUD', () => {
    let conversationId: string;

    it('should create a new conversation', async () => {
      const response = await request(app.getHttpServer())
        .post('/research/conversations')
        .send({
          title: 'Test Conversation',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.title).toBe('Test Conversation');
      expect(response.body.data.tenantId).toBe(tenantId);
      expect(response.body.data.messageCount).toBe(0);

      conversationId = response.body.data.id;
    });

    it('should list conversations', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should get conversation by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/research/conversations/${conversationId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.conversation.id).toBe(conversationId);
      expect(Array.isArray(response.body.data.messages)).toBe(true);
    });

    it('should update conversation', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/research/conversations/${conversationId}`)
        .send({
          title: 'Updated Title',
          isPinned: true,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Updated Title');
      expect(response.body.data.isPinned).toBe(true);
    });

    it('should delete conversation', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/research/conversations/${conversationId}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify deletion
      await request(app.getHttpServer())
        .get(`/research/conversations/${conversationId}`)
        .expect(404);
    });
  });

  describe('Message Operations', () => {
    let conversationId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/research/conversations')
        .send({
          title: 'Message Test',
        });

      conversationId = response.body.data.id;
    });

    it('should send a message', async () => {
      const response = await request(app.getHttpServer())
        .post(`/research/conversations/${conversationId}/messages`)
        .send({
          content: 'What is AAPL revenue?',
        })
        .expect(200);

      // Should return SSE stream
      expect(response.headers['content-type']).toContain('text/event-stream');
    });

    it('should handle message with context', async () => {
      const response = await request(app.getHttpServer())
        .post(`/research/conversations/${conversationId}/messages`)
        .send({
          content: 'Compare revenue',
          context: {
            tickers: ['AAPL', 'MSFT'],
            fiscalPeriod: 'FY2024',
          },
        })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');
    });
  });

  describe('Pagination', () => {
    beforeAll(async () => {
      // Create multiple conversations
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/research/conversations')
          .send({
            title: `Pagination Test ${i}`,
          });
      }
    });

    it('should paginate conversations', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations?limit=3&offset=0')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(3);
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('hasMore');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent conversation', async () => {
      await request(app.getHttpServer())
        .get('/research/conversations/00000000-0000-0000-0000-999999999999')
        .expect(404);
    });

    it('should handle invalid UUID', async () => {
      await request(app.getHttpServer())
        .get('/research/conversations/invalid-uuid')
        .expect(404);
    });
  });
});
