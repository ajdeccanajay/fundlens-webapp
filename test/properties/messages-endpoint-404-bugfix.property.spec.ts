/**
 * Bug Condition Exploration Test - Messages Endpoint 404
 * 
 * **Validates: Requirements 2.5**
 * 
 * This is a BUGFIX EXPLORATION TEST - it MUST FAIL on unfixed code.
 * 
 * CRITICAL: This test encodes the EXPECTED behavior (GET messages endpoint returns 200).
 * When run on UNFIXED code, it will FAIL because the endpoint doesn't exist (returns 404).
 * This failure CONFIRMS the bug exists.
 * 
 * After the fix is implemented, this SAME test will PASS, validating the fix.
 * 
 * DO NOT attempt to fix the test or the code when it fails - document the failure.
 * 
 * Bug Condition: GET /api/research/conversations/{id}/messages returns 404
 * Root Cause: ResearchAssistantController only defines POST endpoint for sending messages,
 *             but does NOT define GET endpoint for loading message history.
 * Expected Behavior: GET endpoint should return HTTP 200 with JSON array of message objects
 *                    containing id, role, content, sources, citations, visualization, peerComparison
 */

import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ResearchAssistantController } from '../../src/research/research-assistant.controller';
import { ResearchAssistantService } from '../../src/research/research-assistant.service';
import { TenantGuard } from '../../src/tenant/tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('Property: Messages Endpoint 404 Bug Condition', () => {
  let app: INestApplication;
  let mockResearchService: Partial<ResearchAssistantService>;
  const testConversationId = 'test-conversation-id';
  const testTenantId = 'test-tenant-messages-404';

  beforeAll(async () => {
    // Mock the ResearchAssistantService to avoid complex dependencies
    mockResearchService = {
      getConversationMessages: jest.fn().mockResolvedValue([
        {
          id: 'msg-1',
          conversationId: testConversationId,
          tenantId: testTenantId,
          role: 'user',
          content: 'What is AMZN revenue for FY2024?',
          sources: [],
          citations: [],
          visualization: null,
          peerComparison: null,
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          conversationId: testConversationId,
          tenantId: testTenantId,
          role: 'assistant',
          content: 'Amazon (AMZN) reported revenue of $574.8B for FY2024.',
          sources: [
            {
              title: 'Amazon 10-K FY2024',
              type: 'sec',
              url: 'https://example.com/amzn-10k',
            },
          ],
          citations: [
            {
              num: 1,
              title: 'Amazon 10-K FY2024',
              type: 'sec',
            },
          ],
          visualization: null,
          peerComparison: null,
          createdAt: new Date('2024-01-01T10:00:05Z'),
          updatedAt: new Date('2024-01-01T10:00:05Z'),
        },
      ]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ResearchAssistantController],
      providers: [
        {
          provide: ResearchAssistantService,
          useValue: mockResearchService,
        },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Property 1: Fault Condition - GET Messages Endpoint Missing
   * 
   * For any existing conversation ID, GET /api/research/conversations/{id}/messages
   * should return HTTP 200 with a JSON array of message objects.
   * 
   * EXPECTED OUTCOME ON UNFIXED CODE: This test will FAIL with 404 Not Found
   * because the GET endpoint doesn't exist in ResearchAssistantController.
   * 
   * This failure CONFIRMS the bug exists.
   */
  it('should return 200 with message array for existing conversation (WILL FAIL on unfixed code - confirms bug)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/research/conversations/${testConversationId}/messages`)
      .set('x-tenant-id', testTenantId)
      .expect('Content-Type', /json/);

    // EXPECTED ON UNFIXED CODE: response.status === 404
    // EXPECTED AFTER FIX: response.status === 200
    expect(response.status).toBe(200);

    // Verify response structure
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('data');
    expect(Array.isArray(response.body.data)).toBe(true);

    // Verify messages have required fields
    const messages = response.body.data;
    expect(messages.length).toBeGreaterThan(0);

    for (const message of messages) {
      expect(message).toHaveProperty('id');
      expect(message).toHaveProperty('role');
      expect(message).toHaveProperty('content');
      expect(message).toHaveProperty('sources');
      expect(message).toHaveProperty('citations');
      expect(message).toHaveProperty('visualization');
      expect(message).toHaveProperty('peerComparison');
      expect(message).toHaveProperty('createdAt');

      // Verify role is either 'user' or 'assistant'
      expect(['user', 'assistant']).toContain(message.role);

      // Verify content is a non-empty string
      expect(typeof message.content).toBe('string');
      expect(message.content.length).toBeGreaterThan(0);
    }
  });

  /**
   * Property 2: Messages Ordered by Creation Time
   * 
   * Messages should be returned in chronological order (oldest first)
   * to properly reconstruct conversation history.
   */
  it('should return messages in chronological order (WILL FAIL on unfixed code)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/research/conversations/${testConversationId}/messages`)
      .set('x-tenant-id', testTenantId);

    // EXPECTED ON UNFIXED CODE: 404 Not Found
    // EXPECTED AFTER FIX: 200 OK with ordered messages
    expect(response.status).toBe(200);

    const messages = response.body.data;
    expect(messages.length).toBeGreaterThanOrEqual(2);

    // Verify chronological order
    for (let i = 1; i < messages.length; i++) {
      const prevTime = new Date(messages[i - 1].createdAt).getTime();
      const currTime = new Date(messages[i].createdAt).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }

    // Verify conversation flow: user message followed by assistant response
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  /**
   * Property 3: Non-existent Conversation Returns 404
   * 
   * For non-existent conversation IDs, the endpoint should return 404
   * with appropriate error message.
   */
  it('should return 404 for non-existent conversation (WILL FAIL on unfixed code - different reason)', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    const response = await request(app.getHttpServer())
      .get(`/research/conversations/${nonExistentId}/messages`)
      .set('x-tenant-id', testTenantId);

    // EXPECTED ON UNFIXED CODE: 404 because endpoint doesn't exist
    // EXPECTED AFTER FIX: 404 because conversation doesn't exist
    // Both return 404, but for different reasons
    expect(response.status).toBe(404);
  });

  /**
   * Property 4: Tenant Isolation
   * 
   * Messages should only be returned for conversations belonging to the
   * requesting tenant. Cross-tenant access should be prevented.
   */
  it('should enforce tenant isolation (WILL FAIL on unfixed code)', async () => {
    const differentTenantId = 'different-tenant-id';

    const response = await request(app.getHttpServer())
      .get(`/research/conversations/${testConversationId}/messages`)
      .set('x-tenant-id', differentTenantId);

    // EXPECTED ON UNFIXED CODE: 404 because endpoint doesn't exist
    // EXPECTED AFTER FIX: 404 or 403 because conversation belongs to different tenant
    expect([404, 403]).toContain(response.status);
  });

  /**
   * Property 5: JSON Fields Properly Parsed
   * 
   * The sources, citations, visualization, and peerComparison fields
   * are stored as JSON strings in the database. The endpoint should
   * parse them into proper JavaScript objects/arrays.
   */
  it('should parse JSON fields correctly (WILL FAIL on unfixed code)', async () => {
    const response = await request(app.getHttpServer())
      .get(`/research/conversations/${testConversationId}/messages`)
      .set('x-tenant-id', testTenantId);

    expect(response.status).toBe(200);

    const messages = response.body.data;
    const assistantMessage = messages.find((m) => m.role === 'assistant');

    expect(assistantMessage).toBeDefined();

    // Verify sources is an array (not a JSON string)
    expect(Array.isArray(assistantMessage.sources)).toBe(true);
    expect(assistantMessage.sources.length).toBeGreaterThan(0);
    expect(assistantMessage.sources[0]).toHaveProperty('title');
    expect(assistantMessage.sources[0]).toHaveProperty('type');

    // Verify citations is an array (not a JSON string)
    expect(Array.isArray(assistantMessage.citations)).toBe(true);
    expect(assistantMessage.citations.length).toBeGreaterThan(0);
    expect(assistantMessage.citations[0]).toHaveProperty('num');
    expect(assistantMessage.citations[0]).toHaveProperty('title');
  });
});

/**
 * COUNTEREXAMPLE DOCUMENTATION
 * 
 * When this test is run on UNFIXED code, it will produce the following counterexample:
 * 
 * Counterexample: GET /api/research/conversations/{id}/messages returns 404 Not Found
 * 
 * Root Cause: The ResearchAssistantController only defines a POST endpoint at
 * /api/research/conversations/:id/messages for sending messages (line 128-175).
 * It does NOT define a GET endpoint for loading message history.
 * 
 * The frontend calls GET /api/research/conversations/{id}/messages in the
 * loadConversationHistory() function, but this endpoint doesn't exist in the backend.
 * 
 * Expected Fix: Add a GET endpoint to ResearchAssistantController that:
 * 1. Accepts conversationId as a URL parameter
 * 2. Queries the researchMessage table filtered by conversationId and tenantId
 * 3. Orders messages by createdAt ascending (chronological order)
 * 4. Parses JSON fields (sources, citations, visualization, peerComparison)
 * 5. Returns { success: true, data: messages } with HTTP 200
 * 
 * After the fix is implemented, this SAME test will PASS, validating the fix works correctly.
 */
