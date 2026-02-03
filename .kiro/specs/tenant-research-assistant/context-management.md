# Context Management & Conversation Continuity

**Version**: 1.0
**Last Updated**: January 26, 2026

---

## 1. Overview

Context management ensures that the AI assistant maintains awareness of:
- Previous messages in the conversation
- User preferences and settings
- Companies/tickers being discussed
- Time periods of interest
- Saved insights and notebooks
- Cross-conversation context (when relevant)

**Goal**: Create a seamless experience where users don't need to repeat themselves, and the AI "remembers" the conversation context.

---

## 2. Context Layers

### 2.1 Conversation-Level Context (Primary)

**What's Saved**:
- All messages in the current conversation (user + assistant)
- Extracted entities (tickers, metrics, time periods)
- User intent history
- Data sources accessed
- Visualizations generated

**Storage**:
```sql
-- research_messages table stores full conversation history
CREATE TABLE research_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  sources JSONB, -- Citations and data sources
  metadata JSONB, -- Extracted entities, intent, etc.
  tokens_used INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Metadata structure
{
  "entities": {
    "tickers": ["AAPL", "MSFT"],
    "metrics": ["revenue", "gross_margin"],
    "timePeriods": ["Q4 2024", "FY2024"],
    "sectors": ["technology"]
  },
  "intent": {
    "type": "comparison",
    "confidence": 0.95
  },
  "dataAccessed": {
    "tables": ["financial_metrics"],
    "filings": ["AAPL 10-K FY2024", "MSFT 10-K FY2024"]
  }
}
```

**Context Window**:
- **Full History**: All messages stored in database
- **AI Context Window**: Last 20 messages (or ~8,000 tokens)
- **Summarization**: Older messages summarized if conversation exceeds 50 messages

**Example Flow**:
```
User: "What was Apple's revenue in Q4 2024?"
AI: "Apple's revenue in Q4 2024 was $124.3B..."
[Context saved: ticker=AAPL, metric=revenue, period=Q4 2024]

User: "How does that compare to Microsoft?"
AI: "Microsoft's Q4 2024 revenue was $62.0B..."
[Context used: Inferred comparison with AAPL, same period]

User: "Show me the trend over the last 4 quarters"
AI: "Here's the quarterly revenue trend for both companies..."
[Context used: Both AAPL and MSFT, last 4 quarters]
```

---

### 2.2 User-Level Context (Preferences)

**What's Saved**:
- Default time periods (e.g., always show last 5 years)
- Preferred metrics (e.g., always include margins)
- Favorite companies/watchlist
- Display preferences (charts vs tables)
- Notification settings

**Storage**:
```sql
CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  preferences JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Preferences structure
{
  "defaultTimePeriod": "5Y",
  "defaultMetrics": ["revenue", "gross_margin", "operating_margin"],
  "watchlist": ["AAPL", "MSFT", "GOOGL", "AMZN"],
  "displayPreferences": {
    "chartType": "line",
    "numberFormat": "abbreviated", // 124.3B vs 124,300,000,000
    "currency": "USD",
    "dateFormat": "MM/DD/YYYY"
  },
  "aiPreferences": {
    "responseLength": "concise", // concise, detailed, comprehensive
    "includeCharts": true,
    "includeSources": true,
    "autoSuggestQueries": true
  }
}
```

**Usage**:
```typescript
// When building query context
const userPrefs = await this.getUserPreferences(userId);

// Apply defaults if not specified in query
if (!query.includes('last') && !query.includes('period')) {
  context.timePeriod = userPrefs.defaultTimePeriod;
}

// Include watchlist companies in suggestions
if (userPrefs.watchlist.length > 0) {
  context.suggestedCompanies = userPrefs.watchlist;
}
```

---

### 2.3 Session-Level Context (Temporary)

**What's Saved** (in memory, not persisted):
- Active filters (sector, metric thresholds)
- Current view state (chart zoom level, table sort)
- Temporary selections (companies being compared)
- Draft messages
- Scroll position

**Storage**: Frontend state management (React Context/Redux)

**Lifetime**: Until page refresh or session timeout (30 minutes)

---

### 2.4 Cross-Conversation Context (Advanced)

**What's Saved**:
- Frequently asked questions
- Common query patterns
- Related conversations
- Saved insights from other conversations

**Storage**:
```sql
CREATE TABLE conversation_relationships (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  related_conversation_id UUID NOT NULL,
  relationship_type VARCHAR(50), -- 'similar_topic', 'follow_up', 'related_company'
  similarity_score FLOAT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Usage**:
```typescript
// When starting a new conversation about AAPL
const relatedConversations = await this.findRelatedConversations({
  tickers: ['AAPL'],
  userId,
  limit: 3
});

// Show in sidebar: "Related conversations"
// - "Apple Q4 2024 Analysis" (2 days ago)
// - "Tech Giants Comparison" (1 week ago)
```

---

## 3. Context Building Strategy

### 3.1 Message Context Window

**Strategy**: Sliding window with intelligent summarization

```typescript
async buildMessageContext(conversationId: string): Promise<string> {
  const messages = await this.getRecentMessages(conversationId, 20);
  
  // If conversation is long, summarize older messages
  if (messages.length >= 20) {
    const olderMessages = await this.getOlderMessages(conversationId, 20, 50);
    const summary = await this.summarizeMessages(olderMessages);
    
    return `
      [Previous conversation summary: ${summary}]
      
      [Recent messages:]
      ${this.formatMessages(messages)}
    `;
  }
  
  return this.formatMessages(messages);
}
```

**Example Summary**:
```
Previous conversation summary:
User asked about Apple's financial performance in 2024. 
Discussed revenue growth (7% YoY), margin expansion (46.2% gross margin),
and compared to Microsoft. User saved insights about Services revenue growth.

Recent messages:
[Last 20 messages with full detail]
```

---

### 3.2 Entity Extraction & Tracking

**Extract entities from every message**:

```typescript
interface ExtractedEntities {
  tickers: string[];           // ["AAPL", "MSFT"]
  metrics: string[];           // ["revenue", "gross_margin"]
  timePeriods: string[];       // ["Q4 2024", "FY2024"]
  sectors: string[];           // ["technology", "healthcare"]
  comparisons: string[];       // ["vs", "compared to"]
  aggregations: string[];      // ["average", "total", "growth"]
}

async extractEntities(message: string): Promise<ExtractedEntities> {
  // Use regex + NLP to extract
  const tickers = this.extractTickers(message); // AAPL, MSFT, etc.
  const metrics = this.extractMetrics(message); // revenue, margin, etc.
  const timePeriods = this.extractTimePeriods(message); // Q4 2024, last year
  
  return { tickers, metrics, timePeriods, ... };
}
```

**Track entity evolution**:
```typescript
// Conversation entity state
{
  "currentTickers": ["AAPL", "MSFT"],      // Currently discussing
  "mentionedTickers": ["AAPL", "MSFT", "GOOGL"], // All mentioned
  "currentMetrics": ["revenue", "gross_margin"],
  "currentPeriod": "Q4 2024",
  "comparisonMode": true
}
```

---

### 3.3 Intent Tracking

**Track user intent across messages**:

```typescript
interface ConversationIntent {
  primaryIntent: 'analysis' | 'comparison' | 'trend' | 'research' | 'memo_prep';
  subIntents: string[];
  confidence: number;
  evolution: IntentChange[];
}

// Example intent evolution
[
  { message: 1, intent: 'single_company_analysis', ticker: 'AAPL' },
  { message: 3, intent: 'comparison', tickers: ['AAPL', 'MSFT'] },
  { message: 5, intent: 'trend_analysis', period: 'last_4_quarters' },
  { message: 8, intent: 'memo_preparation', action: 'save_insights' }
]
```

**Use intent to guide responses**:
```typescript
if (intent.primaryIntent === 'comparison') {
  // Automatically include comparison tables
  // Suggest "Show me the difference" queries
}

if (intent.primaryIntent === 'memo_prep') {
  // Highlight key insights
  // Suggest "Add to notebook" for important findings
}
```

---

## 4. Context Injection into AI Prompts

### 4.1 System Prompt with Context

```typescript
function buildSystemPrompt(context: ConversationContext): string {
  return `You are a financial research assistant for institutional investors.

CONVERSATION CONTEXT:
- Current companies: ${context.tickers.join(', ')}
- Current metrics: ${context.metrics.join(', ')}
- Time period: ${context.timePeriod}
- User intent: ${context.intent}

USER PREFERENCES:
- Response style: ${context.userPrefs.responseLength}
- Always include: ${context.userPrefs.defaultMetrics.join(', ')}
- Watchlist: ${context.userPrefs.watchlist.join(', ')}

CONVERSATION HISTORY:
${context.messageHistory}

AVAILABLE DATA:
- Financial metrics from PostgreSQL (100% accurate)
- SEC narrative content from Bedrock KB
- Real-time market data (if requested)

INSTRUCTIONS:
1. Maintain context from previous messages
2. Infer missing details from conversation history
3. Always cite sources with filing type and date
4. Use user's preferred number format and metrics
5. Suggest relevant follow-up questions
6. Highlight insights worth saving to notebook

Respond professionally, concisely, and with institutional-grade accuracy.`;
}
```

---

### 4.2 Context-Aware Query Enhancement

**Enhance user queries with context**:

```typescript
async enhanceQuery(
  userQuery: string,
  context: ConversationContext
): Promise<EnhancedQuery> {
  
  // Example: User asks "What about margins?"
  // Context: Previously discussing AAPL revenue
  
  const enhanced = {
    originalQuery: "What about margins?",
    enhancedQuery: "What are Apple's gross and operating margins in Q4 2024?",
    inferredEntities: {
      ticker: "AAPL",        // From context
      metrics: ["gross_margin", "operating_margin"],
      period: "Q4 2024"      // From context
    },
    confidence: 0.92
  };
  
  // If confidence < 0.8, ask clarifying question
  if (enhanced.confidence < 0.8) {
    return {
      needsClarification: true,
      question: "Which company's margins would you like to see? (Currently discussing: AAPL, MSFT)"
    };
  }
  
  return enhanced;
}
```

---

## 5. Context Persistence & Recovery

### 5.1 Auto-Save Strategy

**Save context automatically**:
- After every message exchange
- Every 30 seconds (for draft messages)
- On page navigation
- On browser close (beforeunload event)

```typescript
// Auto-save hook
useEffect(() => {
  const autoSave = debounce(() => {
    saveConversationState({
      conversationId,
      messages,
      entities: extractedEntities,
      scrollPosition: window.scrollY,
      draftMessage: inputValue
    });
  }, 1000);

  autoSave();
  
  return () => autoSave.cancel();
}, [messages, inputValue]);
```

---

### 5.2 Session Recovery

**Recover context on page reload**:

```typescript
async recoverSession(conversationId: string): Promise<SessionState> {
  // 1. Load conversation from database
  const conversation = await this.getConversation(conversationId);
  
  // 2. Load messages
  const messages = await this.getMessages(conversationId);
  
  // 3. Rebuild entity context
  const entities = this.extractEntitiesFromMessages(messages);
  
  // 4. Load user preferences
  const userPrefs = await this.getUserPreferences(userId);
  
  // 5. Restore UI state (if saved)
  const uiState = await this.getUIState(conversationId);
  
  return {
    conversation,
    messages,
    entities,
    userPrefs,
    uiState: {
      scrollPosition: uiState?.scrollPosition || 0,
      draftMessage: uiState?.draftMessage || '',
      activeFilters: uiState?.activeFilters || {}
    }
  };
}
```

---

### 5.3 Offline Support

**Queue messages when offline**:

```typescript
// Service worker for offline support
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/research/messages')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Queue message for later
        return queueMessage(event.request);
      })
    );
  }
});

// Sync when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncQueuedMessages());
  }
});
```

---

## 6. Context Sharing & Collaboration

### 6.1 Share Conversation Link

**Generate shareable link**:

```typescript
// POST /api/research/conversations/:id/share
async shareConversation(conversationId: string): Promise<ShareLink> {
  // Verify ownership
  await this.verifyOwnership(conversationId);
  
  // Generate share token
  const shareToken = generateSecureToken();
  
  // Save share record
  await this.prisma.conversationShares.create({
    data: {
      conversationId,
      shareToken,
      createdBy: userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      permissions: 'read' // read, comment, edit
    }
  });
  
  return {
    url: `https://fundlens.com/research/shared/${shareToken}`,
    expiresAt: '7 days'
  };
}
```

**Access shared conversation**:
```typescript
// GET /api/research/shared/:token
async getSharedConversation(token: string): Promise<Conversation> {
  const share = await this.prisma.conversationShares.findUnique({
    where: { shareToken: token },
    include: { conversation: true }
  });
  
  // Check expiration
  if (share.expiresAt < new Date()) {
    throw new Error('Share link expired');
  }
  
  // Return read-only view
  return {
    ...share.conversation,
    isReadOnly: share.permissions === 'read',
    sharedBy: share.createdBy
  };
}
```

---

### 6.2 Conversation Templates

**Save conversation as template**:

```typescript
// POST /api/research/conversations/:id/save-as-template
async saveAsTemplate(conversationId: string, templateData: {
  name: string;
  description: string;
  category: string;
}): Promise<Template> {
  
  const conversation = await this.getConversation(conversationId);
  const messages = await this.getMessages(conversationId);
  
  // Extract query patterns
  const patterns = this.extractQueryPatterns(messages);
  
  return await this.prisma.conversationTemplates.create({
    data: {
      tenantId,
      name: templateData.name,
      description: templateData.description,
      category: templateData.category,
      queryPatterns: patterns,
      exampleMessages: messages.slice(0, 5), // First 5 messages
      createdBy: userId
    }
  });
}
```

**Use template**:
```typescript
// POST /api/research/conversations/from-template
async createFromTemplate(templateId: string, params: {
  tickers?: string[];
  timePeriod?: string;
}): Promise<Conversation> {
  
  const template = await this.getTemplate(templateId);
  
  // Create new conversation
  const conversation = await this.createConversation({
    title: `${template.name} - ${params.tickers?.join(', ')}`
  });
  
  // Apply template patterns with user params
  const initialMessages = this.applyTemplate(template, params);
  
  // Add system message with context
  await this.addMessage(conversation.id, 'system', 
    `Starting analysis using "${template.name}" template for ${params.tickers?.join(', ')}`
  );
  
  return conversation;
}
```

**Example Templates**:
- "Quarterly Earnings Analysis" - Compare revenue, margins, EPS
- "Sector Comparison" - Compare 5+ companies in same sector
- "Deep Dive Research" - Comprehensive analysis of single company
- "Risk Assessment" - Focus on risks, debt, cash flow
- "Growth Analysis" - Revenue growth, market share, expansion

---

## 7. Context Limits & Management

### 7.1 Token Limits

**Claude Opus 4.5 Context Window**: 200,000 tokens (~150,000 words)

**Our Strategy**:
- **Reserve 50,000 tokens** for system prompt + context
- **Reserve 100,000 tokens** for conversation history
- **Reserve 50,000 tokens** for response generation

**When approaching limits**:
```typescript
async manageContextWindow(conversationId: string): Promise<void> {
  const messages = await this.getMessages(conversationId);
  const totalTokens = this.estimateTokens(messages);
  
  if (totalTokens > 100000) {
    // Summarize older messages
    const oldMessages = messages.slice(0, -20); // All but last 20
    const summary = await this.summarizeMessages(oldMessages);
    
    // Replace old messages with summary
    await this.replaceWithSummary(conversationId, oldMessages, summary);
    
    this.logger.log(`Summarized ${oldMessages.length} messages to save tokens`);
  }
}
```

---

### 7.2 Storage Limits

**Per-Tenant Limits**:
- Max conversations: 1,000 active + unlimited archived
- Max messages per conversation: 10,000
- Max notebooks: 100 active + unlimited archived
- Max insights per notebook: 500

**Enforcement**:
```typescript
async createConversation(data: CreateConversationDto): Promise<Conversation> {
  // Check tenant limits
  const activeCount = await this.countActiveConversations(tenantId);
  
  if (activeCount >= 1000) {
    throw new Error(
      'Conversation limit reached. Please archive old conversations.'
    );
  }
  
  return await this.prisma.researchConversation.create({ data });
}
```

**Auto-Archive**:
```typescript
// Cron job: Archive conversations inactive for 90 days
async autoArchiveOldConversations(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  
  await this.prisma.researchConversation.updateMany({
    where: {
      lastMessageAt: { lt: cutoffDate },
      isArchived: false
    },
    data: {
      isArchived: true,
      archivedAt: new Date()
    }
  });
}
```

---

## 8. Privacy & Security

### 8.1 Context Isolation

**Tenant Isolation**:
- Context never shared across tenants
- All queries filtered by `tenant_id`
- Shared links only work within tenant

**User Isolation** (within tenant):
- Users can only see their own conversations
- Exception: Admins can view all tenant conversations (audit)

---

### 8.2 Sensitive Data Handling

**PII Detection**:
```typescript
async detectSensitiveData(message: string): Promise<{
  hasPII: boolean;
  types: string[];
}> {
  const patterns = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/,
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/
  };
  
  const detected = [];
  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(message)) {
      detected.push(type);
    }
  }
  
  return {
    hasPII: detected.length > 0,
    types: detected
  };
}
```

**Warning to user**:
```typescript
if (sensitiveData.hasPII) {
  return {
    warning: 'Your message contains sensitive information (email, phone). ' +
             'Please remove it before sending.',
    blocked: true
  };
}
```

---

## 9. Performance Optimization

### 9.1 Context Caching

**Cache frequently accessed context**:

```typescript
// Redis cache for active conversations
const cacheKey = `conversation:${conversationId}:context`;
const cached = await redis.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

// Build context and cache for 5 minutes
const context = await this.buildContext(conversationId);
await redis.setex(cacheKey, 300, JSON.stringify(context));

return context;
```

---

### 9.2 Lazy Loading

**Load messages on demand**:

```typescript
// Initial load: Last 20 messages
const recentMessages = await this.getMessages(conversationId, { limit: 20 });

// Scroll up: Load more
const olderMessages = await this.getMessages(conversationId, {
  limit: 20,
  before: recentMessages[0].createdAt
});
```

---

## 10. Monitoring & Analytics

**Track context usage**:
- Average conversation length (messages)
- Context window utilization (tokens used)
- Entity extraction accuracy
- Intent detection accuracy
- Context recovery success rate
- Share link usage

**Alerts**:
- Context window approaching limit (>80%)
- High entity extraction failure rate (>10%)
- Slow context building (>1s)

---

## 11. Future Enhancements

### Phase 2:
- **Multi-modal context**: Images, charts, PDFs in conversation
- **Voice context**: Transcribe voice messages, maintain context
- **Cross-platform sync**: Mobile + desktop context sync

### Phase 3:
- **AI memory**: Long-term memory across all conversations
- **Personalized insights**: "Based on your previous research..."
- **Proactive suggestions**: "You might want to check AAPL's latest filing"

---

## Summary

**Context is saved at multiple levels**:
1. ✅ **Conversation-level**: Full message history, entities, intent
2. ✅ **User-level**: Preferences, watchlist, defaults
3. ✅ **Session-level**: Temporary UI state, filters
4. ✅ **Cross-conversation**: Related conversations, templates

**Key Features**:
- Auto-save every message
- Intelligent summarization for long conversations
- Entity tracking (tickers, metrics, periods)
- Intent tracking and evolution
- Session recovery on page reload
- Shareable conversation links
- Conversation templates
- Privacy-first (tenant isolation, PII detection)

**Performance**:
- Redis caching for active conversations
- Lazy loading for long message histories
- Token management for AI context window
- Auto-archive for old conversations

This ensures users never lose context and can pick up exactly where they left off!
