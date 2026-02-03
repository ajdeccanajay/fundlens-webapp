# Design Document: Tenant Isolation

## Overview

This design implements complete tenant isolation for FundLens, ensuring data segregation across deals, chat sessions, documents, and RAG queries while maintaining efficient sharing of public SEC filing data. The architecture uses a request-scoped tenant context pattern with automatic query filtering, S3 prefix enforcement, and Bedrock KB metadata filtering.

The design follows the "Process Once, Share Many" principle for public SEC data while maintaining strict isolation for tenant-private data (uploads, deals, chat sessions).

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Request                                 │
│                    (JWT Token / API Key / Subdomain)                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         TenantGuard (NestJS)                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 1. Extract tenant identity from JWT/API Key/Subdomain           │   │
│  │ 2. Validate tenant exists and is active                         │   │
│  │ 3. Validate user belongs to tenant with appropriate role        │   │
│  │ 4. Attach TenantContext to request                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      TenantInterceptor (NestJS)                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 1. Inject tenant_id into all Prisma queries                     │   │
│  │ 2. Filter response data by tenant ownership                     │   │
│  │ 3. Log access for audit trail                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ DealService │ │ ChatService │ │  RAGService │
            │ (Tenant-    │ │ (Tenant-    │ │ (Tenant-    │
            │  Scoped)    │ │  Scoped)    │ │  Scoped)    │
            └─────────────┘ └─────────────┘ └─────────────┘
                    │               │               │
                    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Data Access Layer                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │   PostgreSQL     │  │       S3         │  │   Bedrock KB     │      │
│  │ (tenant_id FK)   │  │ (prefix-based)   │  │ (metadata filter)│      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow for Tenant-Scoped Operations

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Tenant A: Create Deal for AAPL                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. DealService.createDeal()                                             │
│    - Inject tenant_id from TenantContext                                │
│    - Create deal record with tenant_id = 'tenant-A'                     │
│    - Link to public SEC data_source (AAPL-10-K-FY2024)                 │
│    - DO NOT duplicate SEC data                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Database State                                                        │
│    deals: { id: 'deal-1', tenant_id: 'tenant-A', ticker: 'AAPL' }      │
│    data_sources: { id: 'ds-1', visibility: 'public', owner: NULL }     │
│    (SEC data shared - no duplication)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Tenant A uploads private research document                           │
│    - S3 path: tenants/tenant-A/uploads/{doc-id}/research.pdf           │
│    - data_sources: { visibility: 'private', owner: 'tenant-A' }        │
│    - Bedrock KB chunk metadata: { tenant_id: 'tenant-A' }              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. RAG Query: "What is Apple's revenue growth?"                         │
│    Filter: (visibility='public') OR (tenant_id='tenant-A')             │
│    Returns: Public SEC data + Tenant A's private uploads               │
│    Does NOT return: Tenant B's private uploads                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. TenantContext (Request-Scoped)

```typescript
// src/tenant/tenant-context.ts
export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  tenantTier: 'free' | 'pro' | 'enterprise';
  userId: string;
  userRole: 'admin' | 'analyst' | 'viewer';
  permissions: TenantPermissions;
}

export interface TenantPermissions {
  canCreateDeals: boolean;
  canDeleteDeals: boolean;
  canUploadDocuments: boolean;
  canManageUsers: boolean;
  canViewAuditLogs: boolean;
  maxDeals: number;
  maxUploadsGB: number;
}

// Role-based default permissions
export const ROLE_PERMISSIONS: Record<string, TenantPermissions> = {
  admin: {
    canCreateDeals: true,
    canDeleteDeals: true,
    canUploadDocuments: true,
    canManageUsers: true,
    canViewAuditLogs: true,
    maxDeals: -1, // unlimited
    maxUploadsGB: -1,
  },
  analyst: {
    canCreateDeals: true,
    canDeleteDeals: false,
    canUploadDocuments: true,
    canManageUsers: false,
    canViewAuditLogs: false,
    maxDeals: 50,
    maxUploadsGB: 10,
  },
  viewer: {
    canCreateDeals: false,
    canDeleteDeals: false,
    canUploadDocuments: false,
    canManageUsers: false,
    canViewAuditLogs: false,
    maxDeals: 0,
    maxUploadsGB: 0,
  },
};
```

### 2. TenantGuard (Authentication & Authorization)

```typescript
// src/tenant/tenant.guard.ts
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Extract tenant identity (priority: JWT > API Key > Subdomain)
    const tenantContext = await this.extractTenantContext(request);
    
    if (!tenantContext) {
      throw new UnauthorizedException('Tenant identification required');
    }
    
    // Validate tenant is active
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantContext.tenantId },
    });
    
    if (!tenant || tenant.status !== 'active') {
      throw new UnauthorizedException('Tenant not found or inactive');
    }
    
    // Attach context to request for downstream services
    request.tenantContext = tenantContext;
    
    return true;
  }

  private async extractTenantContext(request: Request): Promise<TenantContext | null> {
    // Method 1: JWT Token
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return this.extractFromJwt(authHeader.substring(7));
    }
    
    // Method 2: API Key
    const apiKey = request.headers['x-api-key'];
    if (apiKey) {
      return this.extractFromApiKey(apiKey as string);
    }
    
    // Method 3: Subdomain
    const subdomain = this.extractSubdomain(request.hostname);
    if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
      return this.extractFromSubdomain(subdomain);
    }
    
    return null;
  }
}
```

### 3. TenantInterceptor (Automatic Query Filtering)

```typescript
// src/tenant/tenant.interceptor.ts
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const tenantContext: TenantContext = request.tenantContext;
    
    if (!tenantContext) {
      return next.handle();
    }
    
    // Log access for audit
    this.auditService.logAccess({
      tenantId: tenantContext.tenantId,
      userId: tenantContext.userId,
      action: request.method,
      resource: request.path,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    
    return next.handle().pipe(
      map(data => this.sanitizeResponse(data, tenantContext)),
    );
  }

  private sanitizeResponse(data: any, context: TenantContext): any {
    // Remove internal tenant references from response
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeItem(item));
    }
    return this.sanitizeItem(data);
  }

  private sanitizeItem(item: any): any {
    if (!item || typeof item !== 'object') return item;
    
    // Remove internal fields from client response
    const { tenantId, tenant_id, ...sanitized } = item;
    return sanitized;
  }
}
```

### 4. TenantAwarePrismaService (Database Query Enforcement)

```typescript
// src/tenant/tenant-aware-prisma.service.ts
@Injectable()
export class TenantAwarePrismaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  get tenantContext(): TenantContext {
    return (this.request as any).tenantContext;
  }

  // Deals - direct tenant_id filter
  async findDeals(where?: Prisma.DealWhereInput) {
    return this.prisma.deal.findMany({
      where: {
        ...where,
        tenantId: this.tenantContext.tenantId,
      },
    });
  }

  async findDealById(id: string) {
    const deal = await this.prisma.deal.findFirst({
      where: {
        id,
        tenantId: this.tenantContext.tenantId,
      },
    });
    
    if (!deal) {
      throw new NotFoundException('Deal not found'); // 404, not 403
    }
    
    return deal;
  }

  // Data sources - visibility-based access
  async findAccessibleDataSources() {
    return this.prisma.dataSource.findMany({
      where: {
        OR: [
          { visibility: 'public' },
          { ownerTenantId: this.tenantContext.tenantId },
          {
            accessGrants: {
              some: {
                tenantId: this.tenantContext.tenantId,
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            },
          },
        ],
      },
    });
  }

  // Financial metrics - via data source access
  async findAccessibleMetrics(ticker: string, period?: string) {
    const accessibleSources = await this.findAccessibleDataSources();
    const sourceIds = accessibleSources.map(s => s.id);
    
    return this.prisma.financialMetric.findMany({
      where: {
        ticker,
        dataSourceId: { in: sourceIds },
        ...(period && { fiscalPeriod: period }),
      },
    });
  }
}
```

### 5. TenantAwareS3Service (S3 Prefix Enforcement)

```typescript
// src/tenant/tenant-aware-s3.service.ts
@Injectable()
export class TenantAwareS3Service {
  constructor(
    private readonly s3Service: S3Service,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  get tenantContext(): TenantContext {
    return (this.request as any).tenantContext;
  }

  // Upload to tenant-specific prefix
  async uploadTenantFile(
    file: Express.Multer.File,
    documentId: string,
  ): Promise<string> {
    const tenantPrefix = `tenants/${this.tenantContext.tenantId}/uploads`;
    const s3Key = `${tenantPrefix}/${documentId}/${file.originalname}`;
    
    await this.s3Service.uploadFile(file, s3Key, {
      tenantId: this.tenantContext.tenantId,
      uploadedBy: this.tenantContext.userId,
    });
    
    return s3Key;
  }

  // Download with ownership verification
  async getTenantFileUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    // Verify the file belongs to this tenant
    if (!this.isOwnedByTenant(s3Key)) {
      throw new NotFoundException('File not found'); // 404, not 403
    }
    
    return this.s3Service.getSignedDownloadUrl(s3Key, expiresIn);
  }

  // Delete with ownership verification
  async deleteTenantFile(s3Key: string): Promise<void> {
    if (!this.isOwnedByTenant(s3Key)) {
      throw new NotFoundException('File not found');
    }
    
    await this.s3Service.deleteFile(s3Key);
  }

  private isOwnedByTenant(s3Key: string): boolean {
    const tenantPrefix = `tenants/${this.tenantContext.tenantId}/`;
    return s3Key.startsWith(tenantPrefix);
  }

  // Public files (SEC data) - no tenant restriction
  async getPublicFileUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    if (!s3Key.startsWith('public/')) {
      throw new ForbiddenException('Not a public file');
    }
    
    return this.s3Service.getSignedDownloadUrl(s3Key, expiresIn);
  }
}
```

### 6. TenantAwareRAGService (Bedrock KB Filtering)

```typescript
// src/tenant/tenant-aware-rag.service.ts
@Injectable()
export class TenantAwareRAGService {
  constructor(
    private readonly bedrockService: BedrockService,
    private readonly tenantPrisma: TenantAwarePrismaService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  get tenantContext(): TenantContext {
    return (this.request as any).tenantContext;
  }

  async query(
    query: string,
    options: { ticker?: string; includeUploads?: boolean },
  ): Promise<RAGResponse> {
    // Build tenant-aware filter for Bedrock KB
    const kbFilter = this.buildTenantFilter(options);
    
    // Retrieve from Bedrock KB with tenant filter
    const narratives = await this.bedrockService.retrieve(
      query,
      kbFilter,
      10,
    );
    
    // Retrieve structured metrics (tenant-aware)
    const metrics = options.ticker
      ? await this.tenantPrisma.findAccessibleMetrics(options.ticker)
      : [];
    
    // Generate response
    return this.bedrockService.generate(query, { metrics, narratives });
  }

  private buildTenantFilter(options: any): any {
    const tenantId = this.tenantContext.tenantId;
    
    // Filter: public data OR tenant's private data
    const accessFilter = {
      orAll: [
        { equals: { key: 'visibility', value: 'public' } },
        { equals: { key: 'tenant_id', value: tenantId } },
      ],
    };
    
    const conditions = [accessFilter];
    
    // Add ticker filter if specified
    if (options.ticker) {
      conditions.push({
        equals: { key: 'ticker', value: options.ticker.toUpperCase() },
      });
    }
    
    return conditions.length === 1 ? conditions[0] : { andAll: conditions };
  }
}
```

## Data Models

### Database Schema Updates

```sql
-- Add tenant_id to deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals(tenant_id);

-- Add tenant_id to documents table  
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);

-- Update analysis_sessions to inherit tenant from deal
-- (No direct tenant_id needed - accessed via deal.tenant_id)

-- Update chat_messages to inherit tenant from session->deal
-- (No direct tenant_id needed - accessed via session.deal.tenant_id)

-- Ensure data_sources has proper indexes
CREATE INDEX IF NOT EXISTS idx_data_sources_visibility ON data_sources(visibility);
CREATE INDEX IF NOT EXISTS idx_data_sources_owner ON data_sources(owner_tenant_id);

-- Create tenant-scoped views for easy querying
CREATE OR REPLACE VIEW tenant_deals AS
SELECT d.*, t.name as tenant_name, t.slug as tenant_slug
FROM deals d
JOIN tenants t ON d.tenant_id = t.id;

CREATE OR REPLACE VIEW tenant_documents AS
SELECT doc.*, t.name as tenant_name
FROM documents doc
JOIN tenants t ON doc.tenant_id = t.id;
```

### Prisma Schema Updates

```prisma
model Deal {
  id                String            @id @default(uuid())
  tenantId          String            @map("tenant_id")
  tenant            Tenant            @relation(fields: [tenantId], references: [id])
  name              String
  description       String?
  dealType          String            @map("deal_type")
  ticker            String?
  companyName       String?           @map("company_name")
  years             Int?              @default(3)
  status            String            @default("draft")
  processingMessage String?           @map("processing_message")
  newsData          Json?             @map("news_data")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")
  analysisSessions  AnalysisSession[]
  scratchPads       ScratchPad[]

  @@index([tenantId])
  @@index([ticker])
  @@index([status])
  @@map("deals")
}

model Document {
  id              String          @id @default(uuid())
  tenantId        String          @map("tenant_id")
  tenant          Tenant          @relation(fields: [tenantId], references: [id])
  ticker          String?
  documentType    String          @map("document_type")
  fileType        String          @map("file_type")
  title           String
  s3Bucket        String          @map("s3_bucket")
  s3Key           String          @map("s3_key")
  fileSize        BigInt          @map("file_size")
  uploadDate      DateTime        @default(now()) @map("upload_date")
  sourceUrl       String?         @map("source_url")
  metadata        Json?
  processed       Boolean         @default(false)
  processingError String?         @map("processing_error")
  dataSourceId    String?         @map("data_source_id")
  dataSource      DataSource?     @relation(fields: [dataSourceId], references: [id])
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")
  chunks          DocumentChunk[]

  @@index([tenantId])
  @@index([ticker])
  @@index([documentType])
  @@map("documents")
}
```

## Error Handling

### Security-First Error Responses

```typescript
// src/tenant/tenant-exceptions.ts

// Always return 404 for access denied to prevent information leakage
export class TenantResourceNotFoundException extends NotFoundException {
  constructor(resource: string) {
    super(`${resource} not found`);
  }
}

// Rate limiting per tenant
export class TenantRateLimitException extends HttpException {
  constructor() {
    super('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }
}

// Quota exceeded
export class TenantQuotaExceededException extends HttpException {
  constructor(resource: string, limit: number) {
    super(
      `${resource} quota exceeded. Limit: ${limit}`,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

// Error handler that sanitizes tenant info
@Catch()
export class TenantExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    
    // Never expose tenant_id in error messages
    const sanitizedMessage = this.sanitizeErrorMessage(exception.message);
    
    response.status(exception.status || 500).json({
      statusCode: exception.status || 500,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
    });
  }

  private sanitizeErrorMessage(message: string): string {
    // Remove any tenant IDs from error messages
    return message.replace(/tenant[_-]?id[:\s]*[a-f0-9-]+/gi, '[redacted]');
  }
}
```

## Testing Strategy

### Unit Tests
- TenantGuard: Test JWT, API key, and subdomain extraction
- TenantInterceptor: Test query filtering and response sanitization
- TenantAwarePrismaService: Test tenant-scoped queries
- TenantAwareS3Service: Test prefix enforcement
- TenantAwareRAGService: Test Bedrock KB filter construction

### Integration Tests
- Cross-tenant isolation: Verify Tenant A cannot access Tenant B's data
- Public data sharing: Verify all tenants can access SEC filings
- Permission enforcement: Verify role-based access control

### Property-Based Tests
- Tenant isolation invariant: For any query, results only contain accessible data
- Public data consistency: Same SEC query returns identical results for all tenants
- S3 prefix enforcement: All tenant uploads have correct prefix



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following correctness properties must be validated through property-based testing:

### Property 1: Tenant Context Extraction Consistency

*For any* valid authentication credential (JWT token, API key, or subdomain), extracting the tenant context and then using that context to query tenant data SHALL return the same tenant information.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Deal Tenant Association Invariant

*For any* deal created through the DealService, the deal's tenant_id SHALL equal the tenant_id from the request's TenantContext at creation time.

**Validates: Requirements 2.1**

### Property 3: Deal Listing Isolation

*For any* tenant T and any call to list deals, the returned set SHALL contain only deals where deal.tenant_id equals T, and SHALL NOT contain any deals where deal.tenant_id differs from T.

**Validates: Requirements 2.2**

### Property 4: Deal Ownership Verification

*For any* deal D and tenant T where D.tenant_id ≠ T, attempting to fetch, update, or delete D while authenticated as T SHALL return a 404 Not Found response (not 403 Forbidden).

**Validates: Requirements 2.3, 2.4, 2.5, 2.6**

### Property 5: Chat Session Tenant Inheritance

*For any* chat session S created for deal D, the effective tenant_id of S (via S.deal.tenant_id) SHALL equal D.tenant_id.

**Validates: Requirements 3.1**

### Property 6: Chat Ownership Verification

*For any* chat session S belonging to deal D where D.tenant_id ≠ current tenant T, attempting to send messages, retrieve history, or clear history SHALL return a 404 Not Found response.

**Validates: Requirements 3.2, 3.3, 3.4, 3.6**

### Property 7: RAG Context Isolation Invariant

*For any* RAG query executed by tenant T, the response context SHALL contain only data from sources where (visibility = 'public') OR (owner_tenant_id = T), and SHALL NEVER contain private data from any tenant T' where T' ≠ T.

**Validates: Requirements 3.5, 5.5, 5.6**

### Property 8: Document S3 Prefix Enforcement

*For any* document uploaded by tenant T, the S3 key SHALL match the pattern `tenants/{T}/uploads/*`, and no document owned by T SHALL have an S3 key outside this prefix.

**Validates: Requirements 4.1, 11.2**

### Property 9: Document Ownership Verification

*For any* document D where D.tenant_id ≠ current tenant T, attempting to list, download, or delete D SHALL either exclude D from results (listing) or return 404 Not Found (download/delete).

**Validates: Requirements 4.3, 4.4, 4.5**

### Property 10: Document Chunk Tenant Tagging

*For any* document D processed by the system, all extracted chunks SHALL have metadata.tenant_id equal to D.tenant_id for Bedrock KB filtering.

**Validates: Requirements 4.6**

### Property 11: RAG Filter Construction

*For any* RAG query executed by tenant T, the Bedrock KB filter SHALL include a condition equivalent to: (visibility = 'public' OR tenant_id = T).

**Validates: Requirements 5.1, 5.4**

### Property 12: Data Source Access Filtering

*For any* query for financial metrics or narrative chunks by tenant T, the results SHALL only include records where the associated data_source satisfies: (visibility = 'public') OR (owner_tenant_id = T) OR (tenant_data_access grants T access).

**Validates: Requirements 5.2, 5.3**

### Property 13: Public SEC Data Accessibility

*For any* SEC filing data source DS where DS.visibility = 'public' and DS.owner_tenant_id = NULL, querying this data as any tenant T SHALL return the same results.

**Validates: Requirements 7.5, 7.6**

### Property 14: SEC Data Non-Duplication

*For any* deal D created for a public company ticker, creating D SHALL NOT create new data_source records for existing SEC filings—only deal metadata linking to existing public data sources.

**Validates: Requirements 7.9**

### Property 15: Role-Based Permission Enforcement

*For any* user U with role R in tenant T, attempting an action A SHALL succeed if and only if ROLE_PERMISSIONS[R] grants permission for A.

**Validates: Requirements 8.2, 8.3**

### Property 16: Audit Log Completeness

*For any* data access operation (deal access, RAG query, document upload, document download), an audit log entry SHALL be created containing: tenant_id, user_id, action type, resource identifier, timestamp, IP address, and user agent.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.6**

### Property 17: Audit Log Isolation

*For any* tenant T viewing audit logs, the returned logs SHALL contain only entries where log.tenant_id = T.

**Validates: Requirements 9.5**

### Property 18: API Response Sanitization

*For any* API response R, R SHALL NOT contain any field named 'tenant_id', 'tenantId', or 'owner_tenant_id' in client-facing data, and error messages SHALL NOT contain tenant identifiers.

**Validates: Requirements 12.2, 12.4**

### Property 19: Security Response Consistency

*For any* request attempting to access a resource that either doesn't exist OR belongs to a different tenant, the response status code SHALL be 404 (not 403, 401, or any other code that would reveal the resource exists).

**Validates: Requirements 12.1**

### Property 20: Per-Tenant Rate Limiting

*For any* tenant T, rate limit counters SHALL be scoped to T, such that tenant T1 exhausting their rate limit SHALL NOT affect tenant T2's ability to make requests.

**Validates: Requirements 12.6**
