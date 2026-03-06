# FundLens RAG & Agent System Architecture

## Overview
Building a comprehensive RAG (Retrieval Augmented Generation) system with S3 storage, vector embeddings, and intelligent agent workflows for financial analysis.

## Architecture Components

### 1. Storage Layer

#### A. S3 Buckets (AWS S3)
```
fundlens-documents/
├── sec-filings/
│   ├── 10-K/
│   │   ├── AAPL/
│   │   │   ├── 2023-10-31_10-K.html
│   │   │   ├── 2023-10-31_10-K.pdf
│   │   │   └── metadata.json
│   │   └── MSFT/...
│   ├── 10-Q/
│   └── 8-K/
├── news-articles/
│   ├── AAPL/
│   │   ├── 2024-01-15_earnings-beat.json
│   │   └── 2024-01-15_earnings-beat.txt
│   └── MSFT/...
├── user-uploads/
│   ├── pdfs/
│   │   ├── {uuid}_analyst-report.pdf
│   │   └── {uuid}_research-note.pdf
│   ├── transcripts/
│   │   └── {uuid}_q4-earnings-call.txt
│   ├── presentations/
│   │   └── {uuid}_investor-deck.pptx
│   └── documents/
│       └── {uuid}_memo.docx
└── processed/
    ├── chunks/          # Text chunks for RAG
    └── embeddings/      # Vector embeddings
```

#### B. PostgreSQL Database (Existing + Extensions)
```sql
-- Existing tables
- financial_metrics
- narrative_chunks
- filing_metadata
- metric_mappings

-- New tables needed
- documents (S3 metadata)
- document_chunks (chunked content)
- news_articles
- embeddings (vector storage)
- agent_conversations
- agent_tasks
```

#### C. Vector Database - AWS Native Approach ⭐
**AWS OpenSearch Serverless with Vector Engine**
- Pros: Fully managed, AWS native, auto-scaling, vector + keyword search
- Cons: Higher cost than pgvector (~$700/month minimum)
- Use case: Production-grade vector search

**Alternative: Amazon Bedrock Knowledge Bases**
- Pros: Fully managed RAG, automatic chunking/embedding, integrated with Bedrock
- Cons: Less control over chunking strategy
- Use case: Fastest time to market

**Recommendation: Bedrock Knowledge Bases for MVP, OpenSearch for advanced features**

### 2. Document Processing Pipeline

```
Document Upload/Fetch
    ↓
S3 Storage (raw file)
    ↓
Document Parser (by type)
    ├── PDF → PyPDF2/pdfplumber
    ├── DOCX → python-docx
    ├── PPTX → python-pptx
    ├── HTML → BeautifulSoup
    └── TXT → direct read
    ↓
Text Chunking (LangChain)
    ├── Chunk size: 1000-1500 tokens
    ├── Overlap: 200 tokens
    └── Preserve context
    ↓
Embedding Generation (AWS Bedrock)
    ├── Model: amazon.titan-embed-text-v2
    └── Dimension: 1024
    ↓
Vector Storage (Bedrock Knowledge Base / OpenSearch)
    ↓
Metadata Indexing (PostgreSQL + DynamoDB)
```

### 3. RAG System Architecture

```
User Query
    ↓
Query Understanding (Claude Opus 4)
    ├── Extract intent
    ├── Identify companies
    ├── Identify time periods
    └── Classify query type
    ↓
Multi-Source Retrieval (Parallel)
    ├── Bedrock Knowledge Base (vector search)
    ├── PostgreSQL (structured metrics)
    ├── DynamoDB (news articles)
    └── S3 Select (direct file queries)
    ↓
Context Assembly
    ├── Rank by relevance
    ├── Deduplicate
    ├── Format for Claude
    └── Add metadata
    ↓
LLM Generation (Claude Opus 4 via Bedrock)
    ├── System prompt with context
    ├── Include sources
    └── Structured output (JSON mode)
    ↓
Response + Citations
```

### 4. Agent System

#### Agent Types

**A. Financial Analyst Agent**
- Analyzes metrics, trends, ratios
- Compares companies
- Generates insights

**B. Research Agent**
- Searches across all documents
- Synthesizes information
- Creates summaries

**C. News Monitor Agent**
- Tracks news for companies
- Identifies material events
- Alerts on significant changes

**D. Document Q&A Agent**
- Answers questions about specific documents
- Cross-references multiple sources
- Provides citations

**E. Report Generator Agent**
- Creates investment memos
- Generates comparison reports
- Produces executive summaries

#### Agent Framework Options

**Option 1: Amazon Bedrock Agents** ⭐ RECOMMENDED (AWS Native)
- Pros: Fully managed, integrated with Bedrock, automatic orchestration
- Cons: Less flexibility than custom frameworks
- Features: Action groups, knowledge bases, memory, guardrails

**Option 2: LangGraph + Bedrock**
- Pros: Maximum flexibility, complex workflows, full control
- Cons: More code to maintain, self-managed

**Option 3: AWS Step Functions + Lambda + Bedrock**
- Pros: Serverless, visual workflow, AWS native
- Cons: More complex for conversational agents

**Recommendation: Bedrock Agents for standard workflows, LangGraph for complex analysis**

## Implementation Plan

### Phase 1: S3 Storage & Document Management (Week 1-2)

**Tasks:**
1. Set up AWS S3 buckets with proper IAM policies
2. Create document upload API endpoints
3. Implement document parsers for each file type
4. Store raw files in S3 with metadata
5. Update database schema for document tracking

**Deliverables:**
- S3 bucket structure
- Upload API (multipart for large files)
- Document metadata in DB
- File type parsers

### Phase 2: Text Processing & Chunking (Week 2-3)

**Tasks:**
1. Implement text extraction for all file types
2. Create intelligent chunking strategy
3. Store chunks in database
4. Link chunks to source documents
5. Handle SEC filings (already partially done)

**Deliverables:**
- Document processing pipeline
- Chunk storage system
- Metadata preservation

### Phase 3: Vector Embeddings & Search (Week 3-4)

**Tasks:**
1. Install pgvector extension
2. Generate embeddings for all content
3. Create vector search API
4. Implement hybrid search (vector + keyword)
5. Build relevance ranking

**Deliverables:**
- pgvector setup
- Embedding generation service
- Search API endpoints
- Ranking algorithm

### Phase 4: RAG System (Week 4-5)

**Tasks:**
1. Build query understanding layer
2. Implement multi-source retrieval
3. Create context assembly logic
4. Integrate with LLM (OpenAI/Bedrock)
5. Add citation tracking

**Deliverables:**
- RAG query endpoint
- Context retrieval system
- LLM integration
- Response formatting

### Phase 5: Agent Framework (Week 5-7)

**Tasks:**
1. Set up LangGraph
2. Create base agent class
3. Implement 3-5 specialized agents
4. Build agent orchestration
5. Add conversation memory

**Deliverables:**
- Agent framework
- 5 working agents
- Agent API endpoints
- Conversation tracking

### Phase 6: News Integration (Week 7-8)

**Tasks:**
1. Integrate news API (Alpha Vantage, NewsAPI, etc.)
2. Create news ingestion pipeline
3. Store news in S3 + DB
4. Add news to RAG context
5. Build news monitoring agent

**Deliverables:**
- News ingestion service
- News storage system
- News search capability

## Technology Stack

### Backend Services
```typescript
// NestJS (existing)
- Document upload controller
- S3 service
- RAG query controller
- Agent orchestration controller

// Python (new services)
- Document parsers
- Embedding generation
- Vector search
- Agent execution
```

### Key Libraries

**TypeScript/Node.js:**
- `@aws-sdk/client-s3` - S3 operations
- `@aws-sdk/client-bedrock-runtime` - Bedrock API
- `@aws-sdk/client-bedrock-agent-runtime` - Bedrock Agents
- `@aws-sdk/client-dynamodb` - DynamoDB operations
- `@aws-sdk/lib-storage` - Multipart uploads
- `multer` - File upload handling

**Python:**
- `boto3` - AWS SDK (S3, Bedrock, DynamoDB, Lambda)
- `langchain-aws` - LangChain AWS integrations
- `langgraph` - Agent framework (if not using Bedrock Agents)
- `pypdf2` / `pdfplumber` - PDF parsing
- `python-docx` - Word documents
- `python-pptx` - PowerPoint
- `beautifulsoup4` - HTML parsing
- `anthropic` - Claude SDK (alternative to Bedrock SDK)

### Infrastructure (AWS Native)
- **AWS S3** - Document storage
- **Amazon Bedrock** - LLM (Claude Opus 4) + Embeddings (Titan)
- **Bedrock Knowledge Bases** - Vector storage + RAG
- **Amazon RDS PostgreSQL** - Structured data (metrics)
- **Amazon DynamoDB** - News articles, metadata
- **AWS Lambda** - Serverless processing
- **Amazon EventBridge** - Event-driven workflows
- **AWS Step Functions** - Complex orchestration
- **Amazon CloudWatch** - Logging & monitoring
- **AWS Secrets Manager** - API keys & credentials

## Database Schema Extensions

```sql
-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(10),
    document_type VARCHAR(50), -- 'sec_filing', 'news', 'user_upload'
    file_type VARCHAR(20), -- 'pdf', 'docx', 'pptx', 'html', 'txt'
    title TEXT,
    s3_bucket VARCHAR(255),
    s3_key VARCHAR(500),
    file_size BIGINT,
    upload_date TIMESTAMP DEFAULT NOW(),
    source_url TEXT,
    metadata JSONB,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Document chunks (for RAG)
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER,
    content TEXT,
    token_count INTEGER,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Embeddings (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES document_chunks(id) ON DELETE CASCADE,
    embedding vector(1536), -- OpenAI embedding dimension
    model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops);

-- News articles
CREATE TABLE news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker VARCHAR(10),
    title TEXT,
    content TEXT,
    source VARCHAR(100),
    author VARCHAR(255),
    published_at TIMESTAMP,
    url TEXT,
    sentiment FLOAT, -- -1 to 1
    s3_key VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agent conversations
CREATE TABLE agent_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255),
    agent_type VARCHAR(50),
    messages JSONB,
    context JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent tasks
CREATE TABLE agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES agent_conversations(id),
    task_type VARCHAR(50),
    status VARCHAR(20), -- 'pending', 'running', 'completed', 'failed'
    input JSONB,
    output JSONB,
    error TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints Design

### Document Management
```
POST   /api/documents/upload          - Upload document
GET    /api/documents                 - List documents
GET    /api/documents/:id             - Get document metadata
DELETE /api/documents/:id             - Delete document
POST   /api/documents/:id/process     - Trigger processing
GET    /api/documents/:id/chunks      - Get document chunks
```

### RAG System
```
POST   /api/rag/query                 - Ask a question
POST   /api/rag/search                - Search documents
GET    /api/rag/context/:query        - Get retrieval context
POST   /api/rag/embed                 - Generate embeddings
```

### Agents
```
POST   /api/agents/analyze            - Financial analysis
POST   /api/agents/research           - Research query
POST   /api/agents/compare            - Compare companies
POST   /api/agents/summarize          - Summarize document
GET    /api/agents/conversations      - List conversations
GET    /api/agents/conversations/:id  - Get conversation
POST   /api/agents/conversations/:id/message - Continue conversation
```

### News
```
POST   /api/news/fetch/:ticker        - Fetch latest news
GET    /api/news/:ticker              - Get stored news
POST   /api/news/analyze              - Analyze news sentiment
```

## Cost Estimates (Monthly) - AWS Native Stack

### AWS S3
- Storage: 100GB @ $0.023/GB = $2.30
- Requests: 100K @ $0.0004/1K = $0.40
- **Total: ~$3/month**

### Amazon Bedrock
- Claude Opus 4: 1M input tokens @ $15/1M = $15
- Claude Opus 4: 500K output tokens @ $75/1M = $37.50
- Titan Embeddings: 10M tokens @ $0.0001/1K = $1
- **Total: ~$50-100/month** (depends on usage)

### Bedrock Knowledge Base
- Storage: 100GB @ $0.10/GB = $10
- Vector queries: 100K @ $0.0004/query = $40
- **Total: ~$50/month**

**Alternative: OpenSearch Serverless**
- OCU (compute): 2 OCU × $0.24/hr × 730hr = $350
- Storage: 100GB @ $0.024/GB = $2.40
- **Total: ~$350/month** (more expensive but more powerful)

### PostgreSQL (AWS RDS)
- db.t3.medium: ~$60/month
- Storage: 100GB @ $0.115/GB = $11.50
- **Total: ~$70/month**

### DynamoDB
- On-demand pricing: ~$5-10/month (low traffic)

### AWS Lambda
- 1M requests @ $0.20/1M = $0.20
- Compute: ~$5/month
- **Total: ~$5/month**

### Total Estimated: 
- **With Bedrock KB: ~$180-250/month**
- **With OpenSearch: ~$480-550/month**

**Recommendation: Start with Bedrock Knowledge Bases, migrate to OpenSearch if needed**

## Security Considerations

1. **S3 Bucket Policies**
   - Private buckets
   - Signed URLs for access
   - Encryption at rest

2. **API Authentication**
   - JWT tokens
   - Rate limiting
   - API keys for agents

3. **Data Privacy**
   - PII detection
   - Data retention policies
   - Audit logging

4. **LLM Safety**
   - Input validation
   - Output filtering
   - Prompt injection prevention

## Next Steps

1. **Immediate**: Review and approve architecture
2. **Week 1**: Set up S3 buckets and document upload
3. **Week 2**: Implement document parsers
4. **Week 3**: Add pgvector and embeddings
5. **Week 4**: Build RAG system
6. **Week 5+**: Develop agent framework

## AWS Native Architecture - Final Stack ✅

### Confirmed Decisions
1. **LLM**: AWS Bedrock with Claude Opus 4 (Sonnet 4 available too)
2. **Embeddings**: Amazon Titan Embed Text v2
3. **Vector DB**: Bedrock Knowledge Bases (MVP) → OpenSearch Serverless (scale)
4. **Agent Framework**: Bedrock Agents + LangGraph for complex workflows
5. **Storage**: S3 + RDS PostgreSQL + DynamoDB
6. **Compute**: AWS Lambda + ECS (for NestJS)
7. **Orchestration**: Step Functions + EventBridge

### AWS Services Map
```
┌─────────────────────────────────────────────────────────────┐
│                     User Interface                           │
│              (React Dashboard / API Clients)                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway / ALB                         │
│              (Authentication, Rate Limiting)                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   NestJS Backend (ECS)                       │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Document API │  RAG API     │  Agent API               │ │
│  │ Upload/Query │  Search/Ask  │  Analyze/Research        │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         ↓              ↓                    ↓
┌────────────────┐ ┌──────────────┐ ┌─────────────────────┐
│   AWS Lambda   │ │   Bedrock    │ │  Bedrock Agents     │
│   (Parsers)    │ │   (Claude)   │ │  (Orchestration)    │
└────────────────┘ └──────────────┘ └─────────────────────┘
         ↓                              ↓
┌────────────────────────────────────────────────────────────┐
│                    Data Layer                               │
│  ┌──────────┬──────────────┬──────────────┬─────────────┐ │
│  │    S3    │  PostgreSQL  │  DynamoDB    │  Bedrock KB │ │
│  │  (Files) │  (Metrics)   │  (News)      │  (Vectors)  │ │
│  └──────────┴──────────────┴──────────────┴─────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Implementation Priority

**Phase 1 (Week 1-2): S3 + Document Upload**
- Set up S3 buckets
- Build upload API
- Store raw files

**Phase 2 (Week 2-3): Document Processing**
- Lambda functions for parsing
- Text extraction
- Chunking strategy

**Phase 3 (Week 3-4): Bedrock Knowledge Base**
- Create KB with S3 data source
- Automatic embedding generation
- Test vector search

**Phase 4 (Week 4-5): RAG with Claude**
- Integrate Bedrock Runtime API
- Build RAG query endpoint
- Context assembly + generation

**Phase 5 (Week 5-6): Bedrock Agents**
- Create agent with action groups
- Connect to PostgreSQL (metrics)
- Build 2-3 specialized agents

**Phase 6 (Week 6-7): News + Polish**
- News ingestion pipeline
- DynamoDB storage
- Production hardening

Ready to start with Phase 1?
