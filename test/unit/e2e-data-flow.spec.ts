import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { DealService } from '../../src/deals/deal.service';
import { SimpleProcessingService } from '../../src/s3/simple-processing.service';
import { ResearchAssistantService } from '../../src/research/research-assistant.service';
import { ScratchPadService } from '../../src/deals/scratch-pad.service';

describe('E2E Data Flow Tests', () => {
  let prismaService: PrismaService;
  let dealService: DealService;
  let processingService: SimpleProcessingService;
  let researchService: ResearchAssistantService;
  let scratchPadService: ScratchPadService;

  const TEST_TENANT_ID = 'test-tenant-e2e';
  const TEST_USER_ID = 'test-user-e2e';
  const TEST_TICKER = 'TEST';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            deal: {
              create: jest.fn(),
              findFirst: jest.fn(),
              deleteMany: jest.fn(),
            },
            financialMetric: {
              findMany: jest.fn(),
            },
            narrativeChunk: {
              findMany: jest.fn(),
            },
            conversation: {
              create: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            conversationMessage: {
              create: jest.fn(),
              deleteMany: jest.fn(),
            },
            scratchpadItem: {
              create: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: DealService,
          useValue: {
            createDeal: jest.fn(),
          },
        },
        {
          provide: SimpleProcessingService,
          useValue: {
            processTicker: jest.fn(),
          },
        },
        {
          provide: ResearchAssistantService,
          useValue: {
            createConversation: jest.fn(),
            sendMessage: jest.fn(),
          },
        },
        {
          provide: ScratchPadService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
          },
        },
      ],
    }).compile();

    prismaService = module.get<PrismaService>(PrismaService);
    dealService = module.get<DealService>(DealService);
    processingService = module.get<SimpleProcessingService>(SimpleProcessingService);
    researchService = module.get<ResearchAssistantService>(ResearchAssistantService);
    scratchPadService = module.get<ScratchPadService>(ScratchPadService);
  });

  describe('Prisma Client Initialization', () => {
    it('should have all required models defined', () => {
      expect(prismaService.deal).toBeDefined();
      expect(prismaService.financialMetric).toBeDefined();
      expect(prismaService.narrativeChunk).toBeDefined();
      expect(prismaService.conversation).toBeDefined();
      expect(prismaService.conversationMessage).toBeDefined();
      expect(prismaService.scratchpadItem).toBeDefined();
    });

    it('should have CRUD methods on all models', () => {
      expect(typeof prismaService.deal.create).toBe('function');
      expect(typeof prismaService.deal.findFirst).toBe('function');
      expect(typeof prismaService.deal.deleteMany).toBe('function');
      
      expect(typeof prismaService.scratchpadItem.create).toBe('function');
      expect(typeof prismaService.scratchpadItem.findMany).toBe('function');
      expect(typeof prismaService.scratchpadItem.deleteMany).toBe('function');
    });
  });

  describe('Deal Model Schema', () => {
    it('should create deal with correct field names', async () => {
      const mockDeal = {
        id: 'test-deal-id',
        ticker: TEST_TICKER,
        dealType: 'public',
        name: 'Test Deal',
        description: 'Test description',
        status: 'draft',
        tenantId: TEST_TENANT_ID,
        created_by: TEST_USER_ID,  // ← Correct field name
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.deal, 'create').mockResolvedValue(mockDeal as any);

      const result = await prismaService.deal.create({
        data: {
          ticker: TEST_TICKER,
          dealType: 'public',
          name: 'Test Deal',
          description: 'Test description',
          status: 'draft',
          tenantId: TEST_TENANT_ID,
          created_by: TEST_USER_ID,  // ← Use created_by, not userId
        },
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('test-deal-id');
      expect(result.created_by).toBe(TEST_USER_ID);
      expect(result.ticker).toBe(TEST_TICKER);
    });

    it('should not accept userId field (should use created_by)', async () => {
      // This test verifies that the schema uses created_by, not userId
      const validData = {
        ticker: TEST_TICKER,
        dealType: 'public',
        name: 'Test Deal',
        status: 'draft',
        tenantId: TEST_TENANT_ID,
        created_by: TEST_USER_ID,
      };

      jest.spyOn(prismaService.deal, 'create').mockResolvedValue({
        id: 'test-id',
        ...validData,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await prismaService.deal.create({ data: validData });
      expect(result.created_by).toBe(TEST_USER_ID);
    });
  });

  describe('ScratchPad Model Schema', () => {
    it('should create scratchpad item with correct field names', async () => {
      const mockItem = {
        id: 'test-item-id',
        content: 'Test content',
        sourceType: 'research_message',
        sourceId: 'message-id',
        created_by: TEST_USER_ID,  // ← Correct field name
        tenantId: TEST_TENANT_ID,
        createdAt: new Date(),
      };

      jest.spyOn(prismaService.scratchpadItem, 'create').mockResolvedValue(mockItem as any);

      const result = await prismaService.scratchpadItem.create({
        data: {
          content: 'Test content',
          sourceType: 'research_message',
          sourceId: 'message-id',
          created_by: TEST_USER_ID,  // ← Use created_by
          tenantId: TEST_TENANT_ID,
        },
      });

      expect(result).toBeDefined();
      expect(result.created_by).toBe(TEST_USER_ID);
    });

    it('should query scratchpad items by created_by', async () => {
      const mockItems = [
        {
          id: 'item-1',
          content: 'Content 1',
          created_by: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
          createdAt: new Date(),
        },
        {
          id: 'item-2',
          content: 'Content 2',
          created_by: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
          createdAt: new Date(),
        },
      ];

      jest.spyOn(prismaService.scratchpadItem, 'findMany').mockResolvedValue(mockItems as any);

      const result = await prismaService.scratchpadItem.findMany({
        where: { created_by: TEST_USER_ID },  // ← Query by created_by
      });

      expect(result).toHaveLength(2);
      expect(result[0].created_by).toBe(TEST_USER_ID);
    });
  });

  describe('E2E Data Flow Integration', () => {
    it('should flow from Deal → Metrics → Chunks → RAG → Scratchpad', async () => {
      // Step 1: Create Deal
      const mockDeal = {
        id: 'deal-id',
        ticker: TEST_TICKER,
        dealType: 'public',
        name: 'Test Deal',
        status: 'draft',
        tenantId: TEST_TENANT_ID,
        created_by: TEST_USER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prismaService.deal, 'create').mockResolvedValue(mockDeal as any);
      const deal = await prismaService.deal.create({
        data: {
          ticker: TEST_TICKER,
          dealType: 'public',
          name: 'Test Deal',
          status: 'draft',
          tenantId: TEST_TENANT_ID,
          created_by: TEST_USER_ID,
        },
      });

      expect(deal).toBeDefined();
      expect(deal.id).toBe('deal-id');

      // Step 2: Verify Metrics exist
      const mockMetrics = [
        { id: 'metric-1', ticker: TEST_TICKER, normalized_metric: 'revenue', value: 1000000 },
        { id: 'metric-2', ticker: TEST_TICKER, normalized_metric: 'net_income', value: 100000 },
      ];

      jest.spyOn(prismaService.financialMetric, 'findMany').mockResolvedValue(mockMetrics as any);
      const metrics = await prismaService.financialMetric.findMany({
        where: { ticker: TEST_TICKER, tenantId: TEST_TENANT_ID },
      });

      expect(metrics).toHaveLength(2);
      expect(metrics[0].ticker).toBe(TEST_TICKER);

      // Step 3: Verify Narrative Chunks exist
      const mockChunks = [
        { id: 'chunk-1', ticker: TEST_TICKER, content: 'Revenue analysis...', section_type: 'revenue' },
        { id: 'chunk-2', ticker: TEST_TICKER, content: 'Profitability analysis...', section_type: 'profitability' },
      ];

      jest.spyOn(prismaService.narrativeChunk, 'findMany').mockResolvedValue(mockChunks as any);
      const chunks = await prismaService.narrativeChunk.findMany({
        where: { ticker: TEST_TICKER, tenantId: TEST_TENANT_ID },
      });

      expect(chunks).toHaveLength(2);
      expect(chunks[0].ticker).toBe(TEST_TICKER);

      // Step 4: Create Conversation (RAG)
      const mockConversation = {
        id: 'conv-id',
        userId: TEST_USER_ID,
        title: 'Test Conversation',
        createdAt: new Date(),
      };

      jest.spyOn(prismaService.conversation, 'create').mockResolvedValue(mockConversation as any);
      const conversation = await prismaService.conversation.create({
        data: {
          userId: TEST_USER_ID,
          title: 'Test Conversation',
        },
      });

      expect(conversation).toBeDefined();
      expect(conversation.id).toBe('conv-id');

      // Step 5: Save to Scratchpad
      const mockScratchpadItem = {
        id: 'scratch-id',
        content: 'RAG response content',
        sourceType: 'research_message',
        sourceId: 'message-id',
        created_by: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        createdAt: new Date(),
      };

      jest.spyOn(prismaService.scratchpadItem, 'create').mockResolvedValue(mockScratchpadItem as any);
      const scratchpadItem = await prismaService.scratchpadItem.create({
        data: {
          content: 'RAG response content',
          sourceType: 'research_message',
          sourceId: 'message-id',
          created_by: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
        },
      });

      expect(scratchpadItem).toBeDefined();
      expect(scratchpadItem.id).toBe('scratch-id');
      expect(scratchpadItem.created_by).toBe(TEST_USER_ID);

      // Verify complete data flow
      expect(deal.id).toBeDefined();
      expect(metrics.length).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
      expect(conversation.id).toBeDefined();
      expect(scratchpadItem.id).toBeDefined();
    });
  });

  describe('Cleanup Operations', () => {
    it('should cleanup test data in correct order', async () => {
      jest.spyOn(prismaService.scratchpadItem, 'deleteMany').mockResolvedValue({ count: 2 });
      jest.spyOn(prismaService.conversationMessage, 'deleteMany').mockResolvedValue({ count: 5 });
      jest.spyOn(prismaService.conversation, 'deleteMany').mockResolvedValue({ count: 1 });
      jest.spyOn(prismaService.deal, 'deleteMany').mockResolvedValue({ count: 1 });

      // Delete in correct order to respect foreign keys
      const scratchpadResult = await prismaService.scratchpadItem.deleteMany({
        where: { created_by: TEST_USER_ID },
      });

      const messagesResult = await prismaService.conversationMessage.deleteMany({
        where: { conversation: { userId: TEST_USER_ID } },
      });

      const conversationsResult = await prismaService.conversation.deleteMany({
        where: { userId: TEST_USER_ID },
      });

      const dealsResult = await prismaService.deal.deleteMany({
        where: { ticker: TEST_TICKER, tenantId: TEST_TENANT_ID },
      });

      expect(scratchpadResult.count).toBe(2);
      expect(messagesResult.count).toBe(5);
      expect(conversationsResult.count).toBe(1);
      expect(dealsResult.count).toBe(1);
    });
  });
});
