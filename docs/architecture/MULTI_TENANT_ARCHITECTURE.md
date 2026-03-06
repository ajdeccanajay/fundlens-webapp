# Multi-Tenant Architecture - Complete Design

## Overview

A **flexible, secure multi-tenant system** that supports:
- SEC filings (shared across tenants)
- User-uploaded documents (tenant-private)
- News articles (shared or tenant-specific)
- Complete data isolation
- Cost-effective storage
- Granular access control

---

## Tenancy Model

### Three-Tier Data Classification

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Classification                       │
└─────────────────────────────────────────────────────────────┘

1. PUBLIC DATA (Shared across all tenants)
   - SEC filings (10-K, 10-Q, 8-K)
   - Public news articles
   - Market data
   
   Storage: Single copy in S3
   Access: All tenants can read
   Cost: Shared (most cost-effective)

2. TENANT-PRIVATE DATA (Isolated per tenant)
   - User-uploaded documents
   - Private research notes
   - Custom analyses
   
   Storage: Tenant-specific S3 prefix
   Access: Only owning tenant
   Cost: Per-tenant

3. TENANT-SUBSCRIBED DATA (Selective sharing)
   - Premium news feeds
   - Research reports
   - Third-party data
   
   Storage: Single copy in S3
   Access: Tenants with subscription
   Cost: Shared among subscribers
```

---

## S3 Bucket Structure

### Complete Layout

```
s3://fundlens-data-lake/

├── public/                           # Shared across all tenants
│   ├── sec-filings/
│   │   ├── raw/
│   │   │   ├── {ticker}/
│   │   │   │   ├── {filing_type}/
│   │   │   │   │   ├── {fiscal_period}/
│   │   │   │   │   │   ├── filing.xml
│   │   │   │   │   │   ├── filing.html
│   │   │   │   │   │   └── metadata.json
│   │   │   │   │   └── ...
│   │   │   │   └── ...
│   │   │   └── ...
│   │   └── processed/
│   │       ├── {ticker}/
│   │       │   ├── {filing_type}/
│   │       │   │   ├── {fiscal_period}/
│   │       │   │   │   ├── metrics.json
│   │       │   │   │   ├── narratives/
│   │       │   │   │   │   ├── chunk-0.json
│   │       │   │   │   │   └── ...
│   │       │   │   │   └── metadata.json
│   │       │   │   └── ...
│   │       │   └── ...
│   │       └── ...
│   │
│   └── news/                         # Public news articles
│       ├── raw/
│       │   ├── {source}/             # reuters, bloomberg, etc.
│       │   │   ├── {date}/
│       │   │   │   ├── article-{id}.json
│       │   │   │   └── ...
│       │   │   └── ...
│       │   └── ...
│       └── processed/
│           ├── {source}/
│           │   ├── {date}/
│           │   │   ├── chunk-{id}.json
│           │   │   └── ...
│           │   └── ...
│           └── ...
│
├── tenants/                          # Tenant-private data
│   ├── {tenant_id}/
│   │   ├── uploads/                  # User-uploaded documents
│   │   │   ├── raw/
│   │   │   │   ├── {document_id}/
│   │   │   │   │   ├── original.pdf
│   │   │   │   │   └── metadata.json
│   │   │   │   └── ...
│   │   │   └── processed/
│   │   │       ├── {document_id}/
│   │   │       │   ├── extracted_text.txt
│   │   │       │   ├── chunks/
│   │   │       │   │   ├── chunk-0.json
│   │   │       │   │   └── ...
│   │   │       │   └── metadata.json
│   │   │       └── ...
│   │   │
│   │   ├── research/                 # Tenant-specific research
│   │   │   ├── notes/
│   │   │   ├── analyses/
│   │   │   └── reports/
│   │   │
│   │   └── config/                   # Tenant configuration
│   │       ├── preferences.json
│   │       ├── subscriptions.json    # Which news feeds, etc.
│   │       └── access_control.json
│   │
│   └── ...
│
├── premium/                          # Premium/subscription content
│   ├── research-reports/
│   │   ├── {provider}/
│   │   │   ├── {report_id}/
│   │   │   │   ├── report.pdf
│   │   │   │   ├── chunks/
│   │   │   │   └── metadata.json
│   │   │   └── ...
│   │   └── ...
│   │
│   └── news-premium/                 # Premium news feeds
│       ├── {source}/
│       │   ├── {date}/
│       │   │   ├── article-{id}.json
│       │   │   └── ...
│       │   └── ...
│       └── ...
│
└── index/                            # Global indexes and metadata
    ├── filing_index.json             # All SEC filings
    ├── news_index.json               # All news articles
    ├── tenant_access.json            # Tenant access mappings
    ├── subscription_index.json       # Premium content subscriptions
    └── sync_state.json               # Last sync timestamps
```

---

## Database Schema (PostgreSQL)

### Complete Multi-Tenant Schema

```sql
-- ============================================
-- TENANT MANAGEMENT
-- ============================================

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,  -- for subdomain: acme.fundlens.com
  tier VARCHAR(50) NOT NULL,          -- free, pro, enterprise
  status VARCHAR(50) DEFAULT 'active', -- active, suspended, cancelled
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,               -- From auth system
  role VARCHAR(50) NOT NULL,           -- admin, analyst, viewer
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_user ON tenant_users(user_id);

-- ============================================
-- DATA ACCESS CONTROL
-- ============================================

CREATE TABLE data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,           -- sec_filing, news, upload, premium
  source_id VARCHAR(255) NOT NULL,     -- filing_id, article_id, document_id
  visibility VARCHAR(50) NOT NULL,     -- public, private, premium
  owner_tenant_id UUID REFERENCES tenants(id), -- NULL for public data
  s3_path VARCHAR(500) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(type, source_id)
);

CREATE INDEX idx_data_sources_type ON data_sources(type, visibility);
CREATE INDEX idx_data_sources_owner ON data_sources(owner_tenant_id);

CREATE TABLE tenant_data_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  data_source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  access_type VARCHAR(50) NOT NULL,    -- read, write, admin
  granted_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,                -- NULL = never expires
  
  UNIQUE(tenant_id, data_source_id)
);

CREATE INDEX idx_tenant_access ON tenant_data_access(tenant_id, data_source_id);

-- ============================================
-- METRICS (Tenant-Aware)
-- ============================================

CREATE TABLE metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Data source reference
  data_source_id UUID REFERENCES data_sources(id),
  
  -- Metric details
  ticker VARCHAR(10) NOT NULL,
  normalized_metric VARCHAR(255) NOT NULL,
  raw_label VARCHAR(500),
  value NUMERIC NOT NULL,
  unit VARCHAR(50),
  
  -- Time context
  fiscal_period VARCHAR(20) NOT NULL,
  period_type VARCHAR(20) NOT NULL,    -- annual, quarterly
  statement_date DATE,
  filing_date DATE,
  
  -- Filing context
  filing_type VARCHAR(10) NOT NULL,
  filing_id VARCHAR(255) NOT NULL,
  statement_type VARCHAR(50),
  
  -- Quality
  confidence_score NUMERIC(3,2),
  extraction_method VARCHAR(50),       -- xbrl, ocr, manual
  
  -- Metadata
  source_page INTEGER,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Unique constraint: one metric per filing
  UNIQUE(data_source_id, ticker, normalized_metric, fiscal_period, filing_type)
);

CREATE INDEX idx_metrics_ticker ON metrics(ticker, fiscal_period);
CREATE INDEX idx_metrics_source ON metrics(data_source_id);
CREATE INDEX idx_metrics_filing ON metrics(filing_id);

-- ============================================
-- NARRATIVE CHUNKS (Tenant-Aware)
-- ============================================

CREATE TABLE narrative_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Data source reference
  data_source_id UUID REFERENCES data_sources(id),
  
  -- Content
  content TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,   -- SHA-256 for deduplication
  
  -- Context
  ticker VARCHAR(10),
  filing_id VARCHAR(255),
  filing_type VARCHAR(10),
  fiscal_period VARCHAR(20),
  section_type VARCHAR(50) NOT NULL,   -- mda, risk_factors, business, etc.
  
  -- Chunking
  chunk_index INTEGER NOT NULL,
  total_chunks INTEGER,
  
  -- Location
  s3_path VARCHAR(500) NOT NULL,
  page_number INTEGER,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(data_source_id, chunk_index)
);

CREATE INDEX idx_chunks_source ON narrative_chunks(data_source_id);
CREATE INDEX idx_chunks_ticker ON narrative_chunks(ticker, section_type);
CREATE INDEX idx_chunks_hash ON narrative_chunks(content_hash);

-- ============================================
-- USER UPLOADS (Tenant-Private)
-- ============================================

CREATE TABLE uploaded_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Upload details
  original_filename VARCHAR(500) NOT NULL,
  file_type VARCHAR(50) NOT NULL,      -- pdf, docx, xlsx, etc.
  file_size BIGINT NOT NULL,
  
  -- Storage
  s3_path VARCHAR(500) NOT NULL,
  
  -- Processing
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
  processed_at TIMESTAMP,
  
  -- Extracted data
  extracted_text TEXT,
  extracted_metrics JSONB,
  
  -- Metadata
  tags VARCHAR(100)[],
  description TEXT,
  metadata JSONB DEFAULT '{}',
  
  -- Audit
  uploaded_by UUID NOT NULL,           -- User ID
  uploaded_at TIMESTAMP DEFAULT NOW(),
  
  -- Link to data_sources
  data_source_id UUID REFERENCES data_sources(id)
);

CREATE INDEX idx_uploads_tenant ON uploaded_documents(tenant_id);
CREATE INDEX idx_uploads_status ON uploaded_documents(status);

-- ============================================
-- NEWS ARTICLES
-- ============================================

CREATE TABLE news_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Article details
  article_id VARCHAR(255) UNIQUE NOT NULL,
  source VARCHAR(100) NOT NULL,        -- reuters, bloomberg, etc.
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url VARCHAR(500),
  
  -- Classification
  tickers VARCHAR(10)[],               -- Related companies
  topics VARCHAR(100)[],               -- earnings, merger, lawsuit, etc.
  sentiment VARCHAR(20),               -- positive, negative, neutral
  
  -- Time
  published_at TIMESTAMP NOT NULL,
  
  -- Access control
  visibility VARCHAR(50) NOT NULL,     -- public, premium
  
  -- Storage
  s3_path VARCHAR(500) NOT NULL,
  
  -- Link to data_sources
  data_source_id UUID REFERENCES data_sources(id),
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_news_tickers ON news_articles USING GIN(tickers);
CREATE INDEX idx_news_published ON news_articles(published_at DESC);
CREATE INDEX idx_news_source ON news_articles(source, visibility);

-- ============================================
-- SUBSCRIPTIONS (Premium Content)
-- ============================================

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Subscription details
  subscription_type VARCHAR(100) NOT NULL, -- news_premium, research_reports, etc.
  provider VARCHAR(100) NOT NULL,
  
  -- Status
  status VARCHAR(50) DEFAULT 'active',  -- active, cancelled, expired
  
  -- Billing
  started_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  
  -- Access control
  access_rules JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id, status);

-- ============================================
-- USAGE TRACKING (Per-Tenant Billing)
-- ============================================

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Query details
  query_type VARCHAR(50) NOT NULL,     -- structured, semantic, hybrid
  query_text TEXT,
  
  -- Data accessed
  data_sources_accessed UUID[],
  metrics_retrieved INTEGER DEFAULT 0,
  chunks_retrieved INTEGER DEFAULT 0,
  
  -- Cost
  cost NUMERIC(10,6) NOT NULL,
  
  -- LLM usage
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  model_used VARCHAR(100),
  
  -- Performance
  latency_ms INTEGER,
  
  -- Audit
  user_id UUID,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_usage_tenant ON usage_logs(tenant_id, timestamp DESC);
CREATE INDEX idx_usage_date ON usage_logs(timestamp);

-- ============================================
-- VIEWS FOR EASY ACCESS
-- ============================================

-- View: Tenant's accessible data sources
CREATE VIEW tenant_accessible_data AS
SELECT 
  t.id as tenant_id,
  t.name as tenant_name,
  ds.id as data_source_id,
  ds.type as data_type,
  ds.source_id,
  ds.visibility,
  ds.s3_path,
  CASE 
    WHEN ds.visibility = 'public' THEN true
    WHEN ds.owner_tenant_id = t.id THEN true
    WHEN tda.tenant_id IS NOT NULL THEN true
    ELSE false
  END as has_access
FROM tenants t
CROSS JOIN data_sources ds
LEFT JOIN tenant_data_access tda ON tda.tenant_id = t.id AND tda.data_source_id = ds.id
WHERE 
  ds.visibility = 'public'
  OR ds.owner_tenant_id = t.id
  OR tda.tenant_id IS NOT NULL;

-- View: Tenant's metrics (with access control)
CREATE VIEW tenant_metrics AS
SELECT 
  tad.tenant_id,
  m.*
FROM metrics m
JOIN tenant_accessible_data tad ON tad.data_source_id = m.data_source_id
WHERE tad.has_access = true;

-- View: Tenant's narrative chunks (with access control)
CREATE VIEW tenant_narratives AS
SELECT 
  tad.tenant_id,
  nc.*
FROM narrative_chunks nc
JOIN tenant_accessible_data tad ON tad.data_source_id = nc.data_source_id
WHERE tad.has_access = true;
```

---

## How Tenancy Works

### 1. Tenant Identification

```typescript
// Extract tenant from request
export class TenantMiddleware {
  extractTenantId(req: Request): string {
    // Method 1: Subdomain
    // acme.fundlens.com → tenant: acme
    const subdomain = this.getSubdomain(req.hostname);
    if (subdomain) {
      return this.getTenantIdBySlug(subdomain);
    }
    
    // Method 2: JWT Token
    const token = this.extractToken(req);
    if (token) {
      const decoded = this.verifyToken(token);
      return decoded.tenantId;
    }
    
    // Method 3: API Key
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      return this.getTenantIdByApiKey(apiKey);
    }
    
    // Method 4: Header
    const tenantId = req.headers['x-tenant-id'];
    if (tenantId) {
      return tenantId;
    }
    
    throw new UnauthorizedException('Tenant identification required');
  }
}
```

### 2. Data Access Control

```typescript
// Check if tenant can access data source
export class DataAccessService {
  async canAccess(
    tenantId: string,
    dataSourceId: string
  ): Promise<boolean> {
    const dataSource = await this.prisma.dataSource.findUnique({
      where: { id: dataSourceId }
    });
    
    if (!dataSource) return false;
    
    // Public data: everyone can access
    if (dataSource.visibility === 'public') {
      return true;
    }
    
    // Private data: only owner can access
    if (dataSource.visibility === 'private') {
      return dataSource.ownerTenantId === tenantId;
    }
    
    // Premium data: check subscription
    if (dataSource.visibility === 'premium') {
      return await this.hasSubscription(tenantId, dataSource);
    }
    
    return false;
  }
  
  async hasSubscription(
    tenantId: string,
    dataSource: DataSource
  ): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        subscriptionType: dataSource.metadata.subscriptionType,
        status: 'active',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });
    
    return !!subscription;
  }
}
```

### 3. Query Execution with Tenant Context

```typescript
// RAG query with tenant isolation
export class RAGService {
  async query(
    query: string,
    tenantId: string
  ): Promise<RAGResponse> {
    // 1. Route query
    const plan = await this.queryRouter.route(query);
    
    // 2. Retrieve structured metrics (tenant-aware)
    let metrics: MetricResult[] = [];
    if (plan.useStructured) {
      metrics = await this.prisma.$queryRaw`
        SELECT m.*
        FROM tenant_metrics m
        WHERE m.tenant_id = ${tenantId}
          AND m.ticker = ${plan.structuredQuery.tickers[0]}
          AND m.normalized_metric = ANY(${plan.structuredQuery.metrics})
          AND m.fiscal_period = ${plan.structuredQuery.period}
      `;
    }
    
    // 3. Retrieve semantic narratives (tenant-aware)
    let narratives: ChunkResult[] = [];
    if (plan.useSemantic) {
      // Query Bedrock KB with tenant filter
      narratives = await this.bedrockKB.retrieve(
        plan.semanticQuery.query,
        {
          tenant_id: tenantId,  // Critical: tenant isolation
          ticker: plan.semanticQuery.tickers[0],
          section_type: plan.semanticQuery.sectionTypes[0]
        }
      );
    }
    
    // 4. Generate response
    const answer = await this.responseGenerator.generate(
      query,
      this.contextBuilder.buildContext(query, metrics, narratives),
      tenantId
    );
    
    // 5. Track usage
    await this.usageTracker.trackQuery(tenantId, {
      queryType: plan.type,
      metricsRetrieved: metrics.length,
      chunksRetrieved: narratives.length,
      cost: this.calculateCost(metrics, narratives, answer.usage)
    });
    
    return {
      answer: answer.text,
      metrics,
      narratives,
      sources: this.extractSources(metrics, narratives),
      tenantId,
      usage: answer.usage
    };
  }
}
```

### 4. Document Upload (Tenant-Private)

```typescript
// Upload document for specific tenant
export class DocumentUploadService {
  async uploadDocument(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
    metadata: UploadMetadata
  ): Promise<UploadedDocument> {
    // 1. Upload to tenant-specific S3 prefix
    const s3Path = `tenants/${tenantId}/uploads/raw/${uuid()}/${file.originalname}`;
    await this.s3.upload(file.buffer, s3Path);
    
    // 2. Create data source (private)
    const dataSource = await this.prisma.dataSource.create({
      data: {
        type: 'upload',
        sourceId: uuid(),
        visibility: 'private',
        ownerTenantId: tenantId,
        s3Path,
        metadata: {
          originalFilename: file.originalname,
          fileType: file.mimetype,
          uploadedBy: userId
        }
      }
    });
    
    // 3. Create upload record
    const upload = await this.prisma.uploadedDocument.create({
      data: {
        tenantId,
        originalFilename: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        s3Path,
        status: 'pending',
        uploadedBy: userId,
        dataSourceId: dataSource.id,
        tags: metadata.tags,
        description: metadata.description
      }
    });
    
    // 4. Queue for processing
    await this.processingQueue.add({
      uploadId: upload.id,
      tenantId,
      s3Path
    });
    
    return upload;
  }
}
```

### 5. News Article Ingestion

```typescript
// Ingest news article (public or premium)
export class NewsIngestionService {
  async ingestArticle(
    article: NewsArticle,
    visibility: 'public' | 'premium'
  ): Promise<void> {
    // 1. Upload to S3
    const s3Path = `${visibility}/news/raw/${article.source}/${article.date}/${article.id}.json`;
    await this.s3.upload(JSON.stringify(article), s3Path);
    
    // 2. Create data source
    const dataSource = await this.prisma.dataSource.create({
      data: {
        type: 'news',
        sourceId: article.id,
        visibility,
        ownerTenantId: null,  // NULL = shared
        s3Path,
        metadata: {
          source: article.source,
          publishedAt: article.publishedAt,
          tickers: article.tickers
        }
      }
    });
    
    // 3. Create news record
    await this.prisma.newsArticle.create({
      data: {
        articleId: article.id,
        source: article.source,
        title: article.title,
        content: article.content,
        url: article.url,
        tickers: article.tickers,
        topics: article.topics,
        sentiment: article.sentiment,
        publishedAt: article.publishedAt,
        visibility,
        s3Path,
        dataSourceId: dataSource.id
      }
    });
    
    // 4. Process and chunk for Bedrock KB
    await this.processingQueue.add({
      dataSourceId: dataSource.id,
      type: 'news',
      s3Path
    });
  }
}
```

---

## Bedrock KB Metadata Structure

### Chunk Metadata for All Document Types

```json
{
  "content": "...",
  "metadata": {
    // Universal fields
    "tenant_id": "tenant-123",           // NULL for public data
    "data_source_id": "ds-456",
    "document_type": "sec_filing",       // sec_filing, upload, news
    "visibility": "public",              // public, private, premium
    
    // SEC Filing specific
    "ticker": "AAPL",
    "filing_type": "10-K",
    "fiscal_period": "FY2024",
    "section_type": "mda",
    "filing_date": "2025-10-31",
    
    // Upload specific
    "original_filename": "research.pdf",
    "uploaded_by": "user-789",
    "upload_date": "2025-12-09",
    "tags": ["research", "analysis"],
    
    // News specific
    "source": "reuters",
    "published_at": "2025-12-09T10:00:00Z",
    "article_id": "news-123",
    "topics": ["earnings", "guidance"],
    "sentiment": "positive",
    
    // Common fields
    "chunk_index": 0,
    "page_number": 23,
    "s3_path": "public/sec-filings/processed/..."
  }
}
```

### Retrieval with Filters

```typescript
// Retrieve with tenant and document type filters
const results = await bedrockKB.retrieve(query, {
  andAll: [
    // Tenant isolation
    {
      orAll: [
        { equals: { key: 'visibility', value: 'public' } },
        { equals: { key: 'tenant_id', value: tenantId } }
      ]
    },
    
    // Document type filter
    {
      orAll: [
        { equals: { key: 'document_type', value: 'sec_filing' } },
        { equals: { key: 'document_type', value: 'upload' } },
        { equals: { key: 'document_type', value: 'news' } }
      ]
    },
    
    // Ticker filter (if specified)
    { equals: { key: 'ticker', value: 'AAPL' } }
  ]
});
```

---

## Cost Allocation

### Per-Tenant Usage Tracking

```typescript
export class BillingService {
  async calculateMonthlyBill(tenantId: string): Promise<Bill> {
    const usage = await this.prisma.usageLog.aggregate({
      where: {
        tenantId,
        timestamp: {
          gte: startOfMonth(),
          lt: endOfMonth()
        }
      },
      _sum: {
        cost: true,
        inputTokens: true,
        outputTokens: true
      },
      _count: true
    });
    
    // Base costs
    const queryCost = usage._sum.cost || 0;
    
    // Storage costs (tenant-private data only)
    const storageCost = await this.calculateStorageCost(tenantId);
    
    // Subscription costs
    const subscriptionCost = await this.calculateSubscriptionCost(tenantId);
    
    return {
      tenantId,
      period: { start: startOfMonth(), end: endOfMonth() },
      queries: usage._count,
      queryCost,
      storageCost,
      subscriptionCost,
      totalCost: queryCost + storageCost + subscriptionCost,
      breakdown: {
        structuredQueries: await this.countByType(tenantId, 'structured'),
        semanticQueries: await this.countByType(tenantId, 'semantic'),
        hybridQueries: await this.countByType(tenantId, 'hybrid'),
        inputTokens: usage._sum.inputTokens || 0,
        outputTokens: usage._sum.outputTokens || 0
      }
    };
  }
}
```

---

## Summary

### Tenancy Model:

1. **Public Data** (SEC filings, public news)
   - Single copy in S3
   - All tenants can access
   - Cost shared

2. **Tenant-Private Data** (uploads)
   - Stored in tenant-specific S3 prefix
   - Only owning tenant can access
   - Cost per tenant

3. **Premium Data** (premium news, research)
   - Single copy in S3
   - Access via subscription
   - Cost shared among subscribers

### Access Control:
- Database-level isolation via `tenant_id`
- S3-level isolation via prefixes
- Bedrock KB-level isolation via metadata filters
- View-based access control for easy queries

### Cost Efficiency:
- Shared storage for public data
- Per-tenant billing for private data
- Subscription model for premium content
- Detailed usage tracking

This architecture supports **unlimited growth** while maintaining **complete tenant isolation** and **cost efficiency**!

Ready to implement?
