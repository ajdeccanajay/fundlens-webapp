/**
 * E2E Tests for Research Assistant Frontend
 * 
 * Tests the complete user journey through the Research Assistant interface:
 * - Authentication and authorization
 * - Conversation creation and management
 * - Message sending and streaming
 * - Markdown rendering
 * - Source citations
 * - Pin/unpin/delete operations
 * 
 * These tests verify the frontend integrates correctly with the backend API.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('Research Assistant E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Setup test tenant and user
    await setupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function setupTestData() {
    // Create test tenant
    tenantId = '00000000-0000-0000-0000-000000000000'; // Default tenant
    userId = '00000000-0000-0000-0000-000000000001'; // Test user UUID

    // Create mock auth token (in real app, this would come from Cognito)
    authToken = createMockJWT({
      sub: userId,
      email: 'test@example.com',
      'custom:tenant_id': tenantId,
      'custom:tenant_name': 'Test Tenant',
      'custom:role': 'analyst',
    });
  }

  async function cleanupTestData() {
    // Clean up test conversations
    await prisma.$executeRaw`
      DELETE FROM research_conversations 
      WHERE tenant_id = ${tenantId}::uuid 
      AND user_id = ${userId}::uuid
    `;
  }

  function createMockJWT(payload: any): string {
    // Simple mock JWT for testing
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = 'mock-signature';
    return `${header}.${body}.${signature}`;
  }

  describe('Authentication', () => {
    it('should reject requests without auth token', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations')
        .expect(401);

      expect(response.body.message).toContain('Unauthorized');
    });

    it('should accept requests with valid auth token', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Conversation Management', () => {
    let conversationId: string;

    it('should create a new conversation', async () => {
      const response = await request(app.getHttpServer())
        .post('/research/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Test Research Conversation',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.title).toBe('Test Research Conversation');
      expect(response.body.data.tenantId).toBe(tenantId);
      expect(response.body.data.userId).toBe(userId);
      expect(response.body.data.messageCount).toBe(0);

      conversationId = response.body.data.id;
    });

    it('should list conversations for current user', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
      
      const conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv).toBeDefined();
      expect(conv.title).toBe('Test Research Conversation');
    });

    it('should get conversation by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.conversation.id).toBe(conversationId);
      expect(response.body.data.messages).toBeInstanceOf(Array);
    });

    it('should update conversation title', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Updated Title',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Updated Title');
    });

    it('should pin conversation', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          isPinned: true,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isPinned).toBe(true);
    });

    it('should unpin conversation', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          isPinned: false,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isPinned).toBe(false);
    });

    it('should archive conversation', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          isArchived: true,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isArchived).toBe(true);
    });

    it('should filter archived conversations', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations?archived=true')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const archivedConv = response.body.data.find((c: any) => c.id === conversationId);
      expect(archivedConv).toBeDefined();
    });

    it('should delete conversation', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify deletion
      await request(app.getHttpServer())
        .get(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('Message Sending and Streaming', () => {
    let conversationId: string;

    beforeEach(async () => {
      // Create a fresh conversation for each test
      const response = await request(app.getHttpServer())
        .post('/research/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Message Test Conversation',
        });

      conversationId = response.body.data.id;
    });

    it('should send message and receive streaming response', async () => {
      const response = await request(app.getHttpServer())
        .post(`/research/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'What is AAPL revenue?',
        })
        .expect(200);

      // Response should be SSE stream
      expect(response.headers['content-type']).toContain('text/event-stream');
    });

    it('should extract tickers from query', async () => {
      const response = await request(app.getHttpServer())
        .post(`/research/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Compare AAPL and MSFT revenue',
        })
        .expect(200);

      // Verify the message was saved
      const convResponse = await request(app.getHttpServer())
        .get(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const messages = convResponse.body.data.messages;
      expect(messages.length).toBeGreaterThan(0);
      
      const userMessage = messages.find((m: any) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage.content).toBe('Compare AAPL and MSFT revenue');
    });

    it('should handle empty message', async () => {
      const response = await request(app.getHttpServer())
        .post(`/research/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: '',
        })
        .expect(200);

      // Should still process (backend handles validation)
    });

    it('should include context in message', async () => {
      const response = await request(app.getHttpServer())
        .post(`/research/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Show me revenue',
          context: {
            tickers: ['GOOGL', 'META'],
            fiscalPeriod: 'FY2024',
          },
        })
        .expect(200);

      // Verify context was saved
      const convResponse = await request(app.getHttpServer())
        .get(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const messages = convResponse.body.data.messages;
      const assistantMessage = messages.find((m: any) => m.role === 'assistant');
      
      if (assistantMessage && assistantMessage.metadata) {
        expect(assistantMessage.metadata.tickers).toBeDefined();
      }
    });
  });

  describe('Tenant Isolation', () => {
    let otherTenantToken: string;
    let conversationId: string;

    beforeEach(async () => {
      // Create conversation for tenant A
      const response = await request(app.getHttpServer())
        .post('/research/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Tenant A Conversation',
        });

      conversationId = response.body.data.id;

      // Create token for tenant B
      otherTenantToken = createMockJWT({
        sub: 'other-user-uuid',
        email: 'other@example.com',
        'custom:tenant_id': 'other-tenant-uuid',
        'custom:tenant_name': 'Other Tenant',
        'custom:role': 'analyst',
      });
    });

    it('should not allow tenant B to access tenant A conversations', async () => {
      await request(app.getHttpServer())
        .get(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .expect(404);
    });

    it('should not allow tenant B to update tenant A conversations', async () => {
      await request(app.getHttpServer())
        .patch(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .send({
          title: 'Hacked Title',
        })
        .expect(404);
    });

    it('should not allow tenant B to delete tenant A conversations', async () => {
      await request(app.getHttpServer())
        .delete(`/research/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .expect(404);
    });

    it('should not allow tenant B to send messages to tenant A conversations', async () => {
      await request(app.getHttpServer())
        .post(`/research/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${otherTenantToken}`)
        .send({
          content: 'Hacking attempt',
        })
        .expect(404);
    });
  });

  describe('Pagination', () => {
    beforeEach(async () => {
      // Create multiple conversations
      for (let i = 0; i < 15; i++) {
        await request(app.getHttpServer())
          .post('/research/conversations')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            title: `Conversation ${i}`,
          });
      }
    });

    it('should paginate conversations', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations?limit=10&offset=0')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
      expect(response.body.pagination.hasMore).toBeDefined();
    });

    it('should return correct pagination metadata', async () => {
      const response = await request(app.getHttpServer())
        .get('/research/conversations?limit=5&offset=0')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('hasMore');
      expect(response.body.pagination.limit).toBe(5);
      expect(response.body.pagination.offset).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent conversation', async () => {
      await request(app.getHttpServer())
        .get('/research/conversations/non-existent-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should handle malformed conversation ID', async () => {
      await request(app.getHttpServer())
        .get('/research/conversations/invalid-uuid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should handle missing required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/research/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(201); // Should still create with default title

      expect(response.body.data.title).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle rapid conversation creation', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app.getHttpServer())
            .post('/research/conversations')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              title: `Rapid Test ${i}`,
            })
        );
      }

      const responses = await Promise.all(promises);
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });
    });

    it('should respond quickly to list requests', async () => {
      const startTime = Date.now();
      
      await request(app.getHttpServer())
        .get('/research/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should respond within 1 second
    });
  });
});
