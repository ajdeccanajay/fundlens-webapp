/**
 * Unit Tests for E2E Test Fixes
 * 
 * Tests for all issues found during E2E testing and their fixes.
 * These tests ensure the fixes remain stable and prevent regressions.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';

// Simple UUID validation function
function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

describe('E2E Test Fixes Validation', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Issue 1: Tenant Slug Field', () => {
    it('should require slug field when creating tenant', async () => {
      // Attempt to create tenant without slug should fail
      await expect(
        prisma.tenant.create({
          data: {
            name: 'Test Tenant',
            // Missing slug field
          } as any,
        }),
      ).rejects.toThrow();
    });

    it('should successfully create tenant with slug field', async () => {
      const tenant = await prisma.tenant.create({
        data: {
          name: 'Test Tenant With Slug',
          slug: 'test-tenant-with-slug',
          tier: 'free',
          status: 'active',
        },
      });

      expect(tenant).toBeDefined();
      expect(tenant.slug).toBe('test-tenant-with-slug');
      expect(tenant.name).toBe('Test Tenant With Slug');

      // Cleanup
      await prisma.tenant.delete({ where: { id: tenant.id } });
    });

    it('should enforce unique slug constraint', async () => {
      const slug = 'unique-slug-test';

      const tenant1 = await prisma.tenant.create({
        data: {
          name: 'Tenant 1',
          slug,
          tier: 'free',
          status: 'active',
        },
      });

      // Attempt to create second tenant with same slug should fail
      await expect(
        prisma.tenant.create({
          data: {
            name: 'Tenant 2',
            slug, // Duplicate slug
            tier: 'free',
            status: 'active',
          },
        }),
      ).rejects.toThrow();

      // Cleanup
      await prisma.tenant.delete({ where: { id: tenant1.id } });
    });
  });

  describe('Issue 2: UUID Format Validation', () => {
    it('should validate UUID format for user IDs', () => {
      // Valid UUID
      const validUUID = '00000000-0000-0000-0000-000000000001';
      expect(isValidUUID(validUUID)).toBe(true);

      // Invalid UUIDs
      const invalidUUIDs = [
        'test-user-e2e', // String
        '12345', // Number-like string
        'not-a-uuid', // Random string
        '', // Empty string
      ];

      invalidUUIDs.forEach((invalidUUID) => {
        expect(isValidUUID(invalidUUID)).toBe(false);
      });
    });

    it('should accept UUID format in database queries', async () => {
      const validUserId = '00000000-0000-0000-0000-000000000001';

      // This should not throw an error
      const conversations = await prisma.conversation.findMany({
        where: { userId: validUserId },
      });

      expect(Array.isArray(conversations)).toBe(true);
    });

    it('should reject invalid UUID format in database queries', async () => {
      const invalidUserId = 'test-user-e2e';

      // This should throw an error
      await expect(
        prisma.conversation.findMany({
          where: { userId: invalidUserId },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Issue 3: Prisma Model Names', () => {
    it('should use correct model name: Message (not conversationMessage)', () => {
      // Verify the model exists
      expect(prisma.message).toBeDefined();
      expect((prisma as any).conversationMessage).toBeUndefined();
    });

    it('should use correct model name: Insight (not scratchPadItem)', () => {
      // Verify the model exists
      expect(prisma.insight).toBeDefined();
      expect((prisma as any).scratchPadItem).toBeUndefined();
    });

    it('should use correct model name: Conversation', () => {
      expect(prisma.conversation).toBeDefined();
    });

    it('should use correct model name: Notebook', () => {
      expect(prisma.notebook).toBeDefined();
    });
  });

  describe('Issue 4: Field Name Mapping (camelCase vs snake_case)', () => {
    it('should use camelCase field names for NarrativeChunk', async () => {
      const chunks = await prisma.narrativeChunk.findMany({
        take: 1,
      });

      if (chunks.length > 0) {
        const chunk = chunks[0];

        // Should have camelCase fields
        expect(chunk).toHaveProperty('sectionType');
        expect(chunk).toHaveProperty('chunkIndex');
        expect(chunk).toHaveProperty('filingType');
        expect(chunk).toHaveProperty('filingDate');

        // Should NOT have snake_case fields
        expect(chunk).not.toHaveProperty('section_type');
        expect(chunk).not.toHaveProperty('chunk_index');
        expect(chunk).not.toHaveProperty('filing_type');
        expect(chunk).not.toHaveProperty('filing_date');
      }
    });

    it('should use camelCase field names for FinancialMetric', async () => {
      const metrics = await prisma.financialMetric.findMany({
        take: 1,
      });

      if (metrics.length > 0) {
        const metric = metrics[0];

        // Should have camelCase fields
        expect(metric).toHaveProperty('normalizedMetric');
        expect(metric).toHaveProperty('rawLabel');
        expect(metric).toHaveProperty('fiscalPeriod');
        expect(metric).toHaveProperty('periodType');
        expect(metric).toHaveProperty('filingType');
        expect(metric).toHaveProperty('filingDate');

        // Should NOT have snake_case fields
        expect(metric).not.toHaveProperty('normalized_metric');
        expect(metric).not.toHaveProperty('raw_label');
        expect(metric).not.toHaveProperty('fiscal_period');
        expect(metric).not.toHaveProperty('period_type');
      }
    });
  });

  describe('Issue 5: Tenant Filtering', () => {
    it('should NOT filter FinancialMetric by tenantId (public data)', async () => {
      // FinancialMetric does not have tenantId field
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker: 'AAPL' },
        take: 1,
      });

      if (metrics.length > 0) {
        expect(metrics[0]).not.toHaveProperty('tenantId');
      }
    });

    it('should NOT filter NarrativeChunk by tenantId (public data)', async () => {
      // NarrativeChunk does not have tenantId field
      const chunks = await prisma.narrativeChunk.findMany({
        where: { ticker: 'AAPL' },
        take: 1,
      });

      if (chunks.length > 0) {
        expect(chunks[0]).not.toHaveProperty('tenantId');
      }
    });

    it('should filter Deal by tenantId (tenant-specific data)', async () => {
      // Deal has tenantId field and should be filtered
      const deals = await prisma.deal.findMany({
        where: { tenantId: 'test-tenant' },
        take: 1,
      });

      // Query should succeed (even if no results)
      expect(Array.isArray(deals)).toBe(true);
    });

    it('should filter Document by tenantId (tenant-specific data)', async () => {
      // Document has tenantId field and should be filtered
      const documents = await prisma.document.findMany({
        where: { tenantId: 'test-tenant' },
        take: 1,
      });

      // Query should succeed (even if no results)
      expect(Array.isArray(documents)).toBe(true);
    });
  });

  describe('Issue 6: Research Assistant Models', () => {
    it('should have Conversation model with correct fields', async () => {
      const conversations = await prisma.conversation.findMany({
        take: 1,
      });

      if (conversations.length > 0) {
        const conv = conversations[0];
        expect(conv).toHaveProperty('id');
        expect(conv).toHaveProperty('tenantId');
        expect(conv).toHaveProperty('userId');
        expect(conv).toHaveProperty('title');
        expect(conv).toHaveProperty('createdAt');
        expect(conv).toHaveProperty('updatedAt');
      }
    });

    it('should have Message model with correct fields', async () => {
      const messages = await prisma.message.findMany({
        take: 1,
      });

      if (messages.length > 0) {
        const msg = messages[0];
        expect(msg).toHaveProperty('id');
        expect(msg).toHaveProperty('conversationId');
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        expect(msg).toHaveProperty('createdAt');
      }
    });

    it('should have Notebook model with correct fields', async () => {
      const notebooks = await prisma.notebook.findMany({
        take: 1,
      });

      if (notebooks.length > 0) {
        const notebook = notebooks[0];
        expect(notebook).toHaveProperty('id');
        expect(notebook).toHaveProperty('tenantId');
        expect(notebook).toHaveProperty('userId');
        expect(notebook).toHaveProperty('title');
        expect(notebook).toHaveProperty('createdAt');
        expect(notebook).toHaveProperty('updatedAt');
      }
    });

    it('should have Insight model with correct fields', async () => {
      const insights = await prisma.insight.findMany({
        take: 1,
      });

      if (insights.length > 0) {
        const insight = insights[0];
        expect(insight).toHaveProperty('id');
        expect(insight).toHaveProperty('notebookId');
        expect(insight).toHaveProperty('content');
        expect(insight).toHaveProperty('createdAt');
        expect(insight).toHaveProperty('updatedAt');
      }
    });
  });

  describe('Issue 7: Data Availability for AMGN', () => {
    it('should have financial metrics for AMGN', async () => {
      const metrics = await prisma.financialMetric.findMany({
        where: { ticker: 'AMGN' },
        take: 5,
      });

      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0].ticker).toBe('AMGN');
    });

    it('should have narrative chunks for AMGN', async () => {
      const chunks = await prisma.narrativeChunk.findMany({
        where: { ticker: 'AMGN' },
        take: 5,
      });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].ticker).toBe('AMGN');
    });

    it('should have recent data for AMGN', async () => {
      const recentMetrics = await prisma.financialMetric.findMany({
        where: { ticker: 'AMGN' },
        orderBy: { filingDate: 'desc' },
        take: 1,
      });

      if (recentMetrics.length > 0) {
        const daysSinceLastFiling =
          (Date.now() - recentMetrics[0].filingDate.getTime()) /
          (1000 * 60 * 60 * 24);

        // Data should be less than 1 year old
        expect(daysSinceLastFiling).toBeLessThan(365);
      }
    });
  });
});
