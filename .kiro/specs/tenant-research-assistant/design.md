# Tenant-Wide Research Assistant - Design Document

**Version**: 1.0
**Last Updated**: January 26, 2026
**Status**: Draft

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Chat Interface│  │   Notebook   │  │  IC Memo Gen │      │
│  │   Component   │  │   Manager    │  │   Component  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                    ┌───────┴───────┐
                    │   REST API    │
                    │   WebSocket   │
                    └───────┬───────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                    Backend (NestJS)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Tenant Research Assistant Service            │   │
│  │  - Query routing                                     │   │
│  │  - Response streaming                                │   │
│  │  - Conversation management                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌──────────────┬──────────┴──────────┬──────────────┐     │
│  │              │                      │              │     │
│  │  Tenant-Aware│   Bedrock Service   │   Notebook   │     │
│  │  RAG Service │   (Claude Opus 4.5) │   Service    │     │
│  │              │                      │              │     │
│  └──────────────┴─────────────────────┴──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  PostgreSQL  │  │  Bedrock KB  │  │   S3 (PDFs)  │      │
│  │  (Metrics)   │  │ (Narratives) │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema

### 2.1 New Tables

```sql
-- Research conversations (tenant-wide, not tied to deals)
CREATE TABLE research_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  
  INDEX idx_tenant_conversations (tenant_id, updated_at DESC),
  INDEX idx_user_conversations (user_id, updated_at DESC)
);

-- Research messages
CREATE TABLE research_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES research_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  sources JSONB,
  metadata JSONB,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_conversation_messages (conversation_id, created_at ASC)
);

-- Research notebooks (replaces deal-specific scratch pads)
CREATE TABLE research_notebooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_archived BOOLEAN DEFAULT FALSE,
  
  INDEX idx_tenant_notebooks (tenant_id, updated_at DESC),
  INDEX idx_user_notebooks (user_id, updated_at DESC)
);

-- Saved insights (from research conversations)
CREATE TABLE research_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id UUID NOT NULL REFERENCES research_notebooks(id) ON DELETE CASCADE,
  message_id UUID REFERENCES research_messages(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  selected_text TEXT, -- If user selected specific part
  user_notes TEXT,
  tags TEXT[], -- Array of tags for organization
  companies TEXT[], -- Array of tickers mentioned
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  position INTEGER, -- Order within notebook
  
  INDEX idx_notebook_insights (notebook_id, position ASC),
  INDEX idx_insight_tags (tags),
  INDEX idx_insight_companies (companies)
);

-- IC memos generated from notebooks
CREATE TABLE ic_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  notebook_id UUID REFERENCES research_notebooks(id),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  template_type VARCHAR(50), -- 'executive', 'detailed', 'comparison'
  status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'review', 'final'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_tenant_memos (tenant_id, updated_at DESC)
);
```

### 2.2 Schema Migrations

**Migration 1**: Create research tables
**Migration 2**: Migrate existing scratch_pads to research_notebooks (optional)
**Migration 3**: Add full-text search indexes

---

## 3. API Design

### 3.1 Research Conversation Endpoints

```typescript
// Create new conversation
POST /api/research/conversations
Body: { title?: string }
Response: { id, title, createdAt }

// List conversations
GET /api/research/conversations
Query: { archived?, pinned?, limit?, offset? }
Response: { conversations: [...], total, hasMore }

// Get conversation
GET /api/research/conversations/:id
Response: { id, title, messages: [...], createdAt, updatedAt }

// Update conversation
PATCH /api/research/conversations/:id
Body: { title?, isPinned?, isArchived? }

// Delete conversation
DELETE /api/research/conversations/:id

// Send message (with streaming)
POST /api/research/conversations/:id/messages
Body: { content: string, context?: { tickers?, sectors? } }
Response: Stream of { type: 'token'|'source'|'done', data }

// Search conversations
GET /api/research/conversations/search
Query: { q: string, limit?, offset? }
Response: { results: [...], total }
```

### 3.2 Notebook Endpoints

```typescript
// Create notebook
POST /api/research/notebooks
Body: { title: string, description?: string }

// List notebooks
GET /api/research/notebooks
Query: { archived?, limit?, offset? }

// Get notebook with insights
GET /api/research/notebooks/:id
Response: { id, title, insights: [...], createdAt, updatedAt }

// Update notebook
PATCH /api/research/notebooks/:id
Body: { title?, description?, isArchived? }

// Delete notebook
DELETE /api/research/notebooks/:id

// Add insight to notebook
POST /api/research/notebooks/:id/insights
Body: { 
  messageId?: string,
  content: string,
  selectedText?: string,
  userNotes?: string,
  tags?: string[],
  companies?: string[]
}

// Update insight
PATCH /api/research/notebooks/:notebookId/insights/:insightId
Body: { content?, userNotes?, tags?, position? }

// Delete insight
DELETE /api/research/notebooks/:notebookId/insights/:insightId

// Reorder insights
POST /api/research/notebooks/:id/insights/reorder
Body: { insightIds: string[] } // New order

// Export notebook
GET /api/research/notebooks/:id/export
Query: { format: 'markdown'|'pdf'|'docx' }
Response: File download
```

### 3.3 IC Memo Endpoints

```typescript
// Generate IC memo from notebook
POST /api/research/notebooks/:id/generate-memo
Body: { 
  templateType: 'executive'|'detailed'|'comparison',
  insightIds?: string[], // Specific insights to include
  customPrompt?: string
}
Response: { memoId, content, status }

// List IC memos
GET /api/research/memos
Query: { status?, limit?, offset? }

// Get IC memo
GET /api/research/memos/:id

// Update IC memo
PATCH /api/research/memos/:id
Body: { title?, content?, status? }

// Export IC memo
GET /api/research/memos/:id/export
Query: { format: 'pdf'|'docx' }
Response: File download
```

---

## 4. Frontend Architecture

### 4.1 Component Structure

```
src/
├── pages/
│   └── ResearchAssistant.tsx          # Main page
├── components/
│   ├── chat/
│   │   ├── ChatInterface.tsx          # Main chat UI
│   │   ├── MessageList.tsx            # Scrollable message list
│   │   ├── Message.tsx                # Individual message bubble
│   │   ├── MessageInput.tsx           # Input with send button
│   │   ├── TypingIndicator.tsx        # "AI is thinking..."
│   │   ├── SourceCitation.tsx         # Inline source display
│   │   └── SuggestedQueries.tsx       # Quick action buttons
│   ├── notebook/
│   │   ├── NotebookSidebar.tsx        # List of notebooks
│   │   ├── NotebookView.tsx           # View notebook contents
│   │   ├── InsightCard.tsx            # Saved insight display
│   │   ├── AddToNotebookModal.tsx     # Save insight dialog
│   │   └── NotebookExport.tsx         # Export options
│   ├── memo/
│   │   ├── MemoGenerator.tsx          # IC memo generation
│   │   ├── MemoEditor.tsx             # Rich text editor
│   │   ├── MemoPreview.tsx            # Preview before export
│   │   └── MemoTemplates.tsx          # Template selector
│   └── shared/
│       ├── MarkdownRenderer.tsx       # Render markdown
│       ├── DataTable.tsx              # Financial data tables
│       ├── Chart.tsx                  # Chart wrapper
│       └── LoadingState.tsx           # Loading indicators
├── hooks/
│   ├── useResearchChat.ts             # Chat state management
│   ├── useNotebook.ts                 # Notebook operations
│   ├── useStreamingResponse.ts        # Handle SSE/WebSocket
│   └── useAutoSave.ts                 # Auto-save logic
├── services/
│   ├── researchApi.ts                 # API client
│   ├── streamingService.ts            # Streaming handler
│   └── exportService.ts               # Export utilities
└── utils/
    ├── markdown.ts                    # Markdown utilities
    ├── formatting.ts                  # Number/date formatting
    └── citations.ts                   # Citation formatting
```

### 4.2 State Management

**Option 1: React Context + Hooks** (Recommended for simplicity)
```typescript
// ConversationContext
- conversations: Conversation[]
- activeConversation: Conversation | null
- messages: Message[]
- isLoading: boolean
- sendMessage(content: string)
- createConversation()
- switchConversation(id: string)

// NotebookContext
- notebooks: Notebook[]
- activeNotebook: Notebook | null
- insights: Insight[]
- saveInsight(data: InsightData)
- updateInsight(id: string, data: Partial<Insight>)
- deleteInsight(id: string)
```

**Option 2: Redux Toolkit** (If app grows complex)
- Better for large-scale state
- Time-travel debugging
- Middleware for API calls

### 4.3 Real-Time Communication

**Streaming Implementation**:

```typescript
// Using Server-Sent Events (SSE)
const eventSource = new EventSource(
  `/api/research/conversations/${conversationId}/messages/stream`
);

eventSource.addEventListener('token', (event) => {
  const token = JSON.parse(event.data);
  appendToken(token.text);
});

eventSource.addEventListener('source', (event) => {
  const source = JSON.parse(event.data);
  addSource(source);
});

eventSource.addEventListener('done', (event) => {
  eventSource.close();
  markComplete();
});

eventSource.addEventListener('error', (event) => {
  handleError(event);
  eventSource.close();
});
```

**Alternative: WebSocket** (if bidirectional needed)
```typescript
const ws = new WebSocket('wss://api.fundlens.com/research/ws');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleStreamingMessage(message);
};
```

---

## 5. UI/UX Design

### 5.1 Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Header: FundLens Research Assistant          [User Menu]   │
├──────────┬──────────────────────────────────────┬───────────┤
│          │                                      │           │
│ Sidebar  │         Chat Interface               │ Notebook  │
│          │                                      │  Panel    │
│ [New]    │  ┌────────────────────────────────┐ │           │
│          │  │ Assistant: Here's the revenue  │ │ [Notebook]│
│ Conv 1   │  │ comparison for AAPL vs MSFT... │ │           │
│ Conv 2   │  │ [Add to Notebook] [Sources]    │ │ Insight 1 │
│ Conv 3   │  └────────────────────────────────┘ │ Insight 2 │
│          │                                      │ Insight 3 │
│ [Search] │  ┌────────────────────────────────┐ │           │
│          │  │ You: Compare their margins     │ │ [+ Add]   │
│          │  └────────────────────────────────┘ │ [Export]  │
│          │                                      │           │
│          │  [Type your question...]      [Send]│           │
└──────────┴──────────────────────────────────────┴───────────┘
```

### 5.2 Visual Design System

**Colors** (Professional, Trust-Building):
```css
--primary: #2563eb;      /* Blue - primary actions */
--secondary: #64748b;    /* Slate - secondary text */
--success: #10b981;      /* Green - positive metrics */
--warning: #f59e0b;      /* Amber - cautions */
--danger: #ef4444;       /* Red - negative metrics */
--background: #ffffff;   /* White - main background */
--surface: #f8fafc;      /* Light gray - cards */
--border: #e2e8f0;       /* Light border */
--text-primary: #0f172a; /* Dark text */
--text-secondary: #64748b; /* Gray text */
```

**Typography**:
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
```

**Spacing** (8px base unit):
```css
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
```

**Shadows**:
```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
```

### 5.3 Message Bubble Design

**User Message**:
```html
<div class="message message-user">
  <div class="message-content">
    Compare AAPL and MSFT revenue growth
  </div>
  <div class="message-meta">
    <span class="timestamp">2 minutes ago</span>
  </div>
</div>
```

**Assistant Message**:
```html
<div class="message message-assistant">
  <div class="message-avatar">
    <img src="/ai-avatar.svg" alt="AI" />
  </div>
  <div class="message-body">
    <div class="message-content">
      <!-- Markdown rendered content -->
      <p>Here's the revenue growth comparison:</p>
      <table>...</table>
    </div>
    <div class="message-sources">
      <button class="source-chip">AAPL 10-K FY2024</button>
      <button class="source-chip">MSFT 10-K FY2024</button>
    </div>
    <div class="message-actions">
      <button class="btn-icon" title="Add to Notebook">
        <BookmarkIcon />
      </button>
      <button class="btn-icon" title="Copy">
        <CopyIcon />
      </button>
      <button class="btn-icon" title="Regenerate">
        <RefreshIcon />
      </button>
    </div>
  </div>
</div>
```

### 5.4 Animations

**Message Appearance**:
```css
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message {
  animation: slideUp 0.2s ease-out;
}
```

**Typing Indicator**:
```css
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.typing-dot {
  animation: pulse 1.4s infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
```

---

## 6. Backend Implementation

### 6.1 Service Architecture

```typescript
// src/research/research-assistant.service.ts
@Injectable({ scope: Scope.REQUEST })
export class ResearchAssistantService {
  constructor(
    private readonly tenantAwareRAG: TenantAwareRAGService,
    private readonly bedrockService: BedrockService,
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  async sendMessage(
    conversationId: string,
    content: string,
    context?: QueryContext,
  ): AsyncGenerator<StreamChunk> {
    // 1. Verify conversation ownership
    await this.verifyConversationOwnership(conversationId);

    // 2. Save user message
    await this.saveMessage(conversationId, 'user', content);

    // 3. Build query context
    const queryContext = await this.buildQueryContext(content, context);

    // 4. Stream response from Claude
    const stream = this.bedrockService.streamQuery(content, queryContext);

    // 5. Yield tokens and save final response
    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk.text;
      yield chunk;
    }

    // 6. Save assistant message
    await this.saveMessage(conversationId, 'assistant', fullResponse, {
      sources: queryContext.sources,
      metadata: queryContext.metadata,
    });
  }

  private async buildQueryContext(
    query: string,
    context?: QueryContext,
  ): Promise<EnhancedContext> {
    const tenantId = this.getTenantId();

    // Extract tickers from query
    const tickers = this.extractTickers(query);

    // Get relevant data
    const [metrics, narratives] = await Promise.all([
      this.getRelevantMetrics(tickers, query),
      this.getRelevantNarratives(query, tickers),
    ]);

    return {
      tenantId,
      tickers,
      metrics,
      narratives,
      sources: this.buildSources(metrics, narratives),
      metadata: {
        queryType: this.detectQueryType(query),
        confidence: 0.95,
      },
    };
  }
}
```

### 6.2 Streaming Implementation

```typescript
// src/research/research-assistant.controller.ts
@Controller('research')
@UseGuards(TenantGuard)
export class ResearchAssistantController {
  @Post('conversations/:id/messages')
  @Sse() // Server-Sent Events
  async sendMessage(
    @Param('id') conversationId: string,
    @Body() body: { content: string; context?: QueryContext },
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      (async () => {
        try {
          const stream = await this.researchService.sendMessage(
            conversationId,
            body.content,
            body.context,
          );

          for await (const chunk of stream) {
            subscriber.next({
              type: chunk.type, // 'token', 'source', 'done'
              data: JSON.stringify(chunk.data),
            } as MessageEvent);
          }

          subscriber.next({
            type: 'done',
            data: JSON.stringify({ complete: true }),
          } as MessageEvent);

          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();
    });
  }
}
```

---

## 7. Performance Optimization

### 7.1 Caching Strategy

**Query Result Caching**:
```typescript
// Cache frequently asked queries
const cacheKey = `query:${tenantId}:${hashQuery(query)}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

// Cache for 5 minutes
await redis.setex(cacheKey, 300, JSON.stringify(result));
```

**Metric Caching**:
```typescript
// Cache company metrics (updated daily)
const cacheKey = `metrics:${ticker}:${metric}:${period}`;
// TTL: 24 hours
```

### 7.2 Database Optimization

**Indexes**:
```sql
-- Conversation lookup
CREATE INDEX idx_tenant_conversations_updated 
ON research_conversations(tenant_id, updated_at DESC);

-- Message retrieval
CREATE INDEX idx_conversation_messages_created 
ON research_messages(conversation_id, created_at ASC);

-- Full-text search
CREATE INDEX idx_messages_content_fts 
ON research_messages USING gin(to_tsvector('english', content));

-- Notebook insights
CREATE INDEX idx_notebook_insights_position 
ON research_insights(notebook_id, position ASC);
```

**Query Optimization**:
```sql
-- Fetch conversation with messages (single query)
SELECT 
  c.*,
  json_agg(
    json_build_object(
      'id', m.id,
      'role', m.role,
      'content', m.content,
      'sources', m.sources,
      'createdAt', m.created_at
    ) ORDER BY m.created_at ASC
  ) as messages
FROM research_conversations c
LEFT JOIN research_messages m ON c.id = m.conversation_id
WHERE c.id = $1 AND c.tenant_id = $2
GROUP BY c.id;
```

### 7.3 Frontend Optimization

**Code Splitting**:
```typescript
// Lazy load heavy components
const MemoEditor = lazy(() => import('./components/memo/MemoEditor'));
const ChartComponent = lazy(() => import('./components/shared/Chart'));
```

**Virtual Scrolling**:
```typescript
// For long message lists
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={messages.length}
  itemSize={100}
>
  {({ index, style }) => (
    <Message message={messages[index]} style={style} />
  )}
</FixedSizeList>
```

**Debounced Auto-Save**:
```typescript
const debouncedSave = useMemo(
  () => debounce((content) => saveNotebook(content), 1000),
  []
);
```

---

## 8. Security Considerations

### 8.1 Tenant Isolation

**All queries must include tenant filter**:
```typescript
// CORRECT
const conversations = await prisma.researchConversation.findMany({
  where: {
    tenantId: currentTenantId,
    userId: currentUserId,
  },
});

// WRONG - Missing tenant filter
const conversations = await prisma.researchConversation.findMany({
  where: { userId: currentUserId },
});
```

### 8.2 Input Sanitization

```typescript
// Sanitize user input before storing
import DOMPurify from 'isomorphic-dompurify';

const sanitizedContent = DOMPurify.sanitize(userInput, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: [],
});
```

### 8.3 Rate Limiting

```typescript
// Rate limit per user
@UseGuards(ThrottlerGuard)
@Throttle(100, 3600) // 100 requests per hour
@Post('conversations/:id/messages')
async sendMessage() { ... }
```

### 8.4 Audit Logging

```typescript
// Log all research queries
await this.auditService.log({
  tenantId,
  userId,
  action: 'RESEARCH_QUERY',
  resource: 'conversation',
  resourceId: conversationId,
  metadata: {
    query: content,
    tickers: extractedTickers,
    responseTime: latency,
  },
});
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
describe('ResearchAssistantService', () => {
  it('should extract tickers from query', () => {
    const query = 'Compare AAPL and MSFT revenue';
    const tickers = service.extractTickers(query);
    expect(tickers).toEqual(['AAPL', 'MSFT']);
  });

  it('should enforce tenant isolation', async () => {
    const otherTenantConversation = 'other-tenant-conv-id';
    await expect(
      service.sendMessage(otherTenantConversation, 'test')
    ).rejects.toThrow(NotFoundException);
  });
});
```

### 9.2 Integration Tests

```typescript
describe('Research API', () => {
  it('should create conversation and send message', async () => {
    const { body: conv } = await request(app)
      .post('/api/research/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test' })
      .expect(201);

    const response = await request(app)
      .post(`/api/research/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'What is AAPL revenue?' })
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});
```

### 9.3 E2E Tests

```typescript
describe('Research Assistant E2E', () => {
  it('should complete full research workflow', async () => {
    // 1. Create conversation
    // 2. Send query
    // 3. Receive streaming response
    // 4. Save insight to notebook
    // 5. Generate IC memo
    // 6. Export memo as PDF
  });
});
```

---

## 10. Deployment

### 10.1 Environment Variables

```bash
# Bedrock Configuration
BEDROCK_REGION=us-east-1
BEDROCK_KB_ID=your-kb-id
BEDROCK_MODEL_ID=anthropic.claude-opus-4-5

# Database
DATABASE_URL=postgresql://...

# Redis (optional, for caching)
REDIS_URL=redis://...

# Feature Flags
ENABLE_STREAMING=true
ENABLE_NOTEBOOKS=true
ENABLE_IC_MEMO_GEN=true
```

### 10.2 Monitoring

**Metrics to Track**:
- Query latency (p50, p95, p99)
- Streaming token rate
- Error rate
- Cache hit rate
- Active conversations
- Messages per conversation
- Notebook saves per session

**Alerts**:
- Response time > 5s (p95)
- Error rate > 1%
- Streaming failures > 5%

---

## 11. Future Enhancements

### Phase 2 (Q2 2026):
- Voice input/output
- Real-time collaboration
- Advanced visualizations (interactive charts)
- Custom AI model fine-tuning

### Phase 3 (Q3 2026):
- Mobile native apps
- Integration with Bloomberg/FactSet
- Automated alert generation
- Portfolio-level analytics

---

## 12. Success Metrics

**Week 1**:
- 10 beta users complete 5+ sessions
- Average response time < 3s
- Zero critical bugs

**Month 1**:
- 80% user retention
- 4.5+ satisfaction score
- 60% of users save insights
- 30% generate IC memos

**Quarter 1**:
- 500+ active users
- 10,000+ conversations
- 5,000+ saved insights
- 500+ IC memos generated
