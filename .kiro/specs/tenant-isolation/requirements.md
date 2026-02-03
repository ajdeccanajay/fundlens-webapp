# Requirements Document

## Introduction

This feature implements complete tenant isolation across the FundLens application, ensuring that Client A cannot view, access, or query Client B's deals, documents, chat sessions, or uploaded data. The system maintains full data segregation while allowing tenants to query across their own deals when performing company comparison analyses using SEC data and their own uploads.

The architecture leverages the existing multi-tenant database schema (tenants, tenant_users, data_sources, tenant_data_access) and extends it to cover all user-facing features including deals, chat sessions, document uploads, and RAG queries.

## Glossary

- **Tenant**: An organization or client account that owns deals, documents, and chat sessions with complete data isolation from other tenants
- **Tenant_Context**: Request-scoped context containing the authenticated tenant ID, user ID, and permissions extracted from Cognito JWT
- **Tenant_Guard**: NestJS guard that validates Cognito JWT tokens and enforces access control on all protected endpoints
- **Cognito_User_Pool**: AWS Cognito User Pool that manages user authentication with email/password login
- **Tenant_Interceptor**: NestJS interceptor that automatically injects tenant_id into database queries and filters results
- **Data_Source**: A reference to any data (SEC filing, upload, news) with visibility rules (public, private, premium)
- **Cross_Deal_Query**: A RAG query that spans multiple deals owned by the same tenant for comparison analysis
- **Tenant_Scoped_Service**: A service that automatically filters all operations by the current tenant context
- **Public_Data**: SEC filings and public news that all tenants can access (shared, not duplicated)
- **Private_Data**: Tenant-uploaded documents and deal-specific data visible only to the owning tenant

## Requirements

### Requirement 1: User Authentication with AWS Cognito

**User Story:** As a user, I want to sign up and log in with my email and password, so that I can securely access my organization's data.

#### Acceptance Criteria

1. WHEN a user signs up with email and password, THE Cognito_User_Pool SHALL create a user account and send email verification
2. WHEN a user signs in with valid credentials, THE Cognito_User_Pool SHALL return JWT access and refresh tokens
3. WHEN a user signs in, THE JWT token SHALL contain custom claims for tenant_id and tenant_role
4. WHEN a user's access token expires, THE system SHALL allow token refresh using the refresh token
5. WHEN a user requests password reset, THE Cognito_User_Pool SHALL send a verification code to their email
6. WHEN a user signs out, THE system SHALL invalidate their current session tokens
7. IF a user provides invalid credentials, THEN THE system SHALL return a 401 Unauthorized with generic error message

### Requirement 2: Tenant Context Extraction and Validation

**User Story:** As a system, I want to extract and validate tenant identity from every request, so that all operations are scoped to the correct tenant.

#### Acceptance Criteria

1. WHEN a request contains a valid Cognito JWT token, THE Tenant_Guard SHALL extract tenant_id and user_id from the token custom claims
2. WHEN a request contains an API key header (x-api-key), THE Tenant_Guard SHALL look up the associated tenant_id for service-to-service calls
3. WHEN a request uses subdomain routing (acme.fundlens.com), THE Tenant_Guard SHALL resolve the tenant_id from the subdomain slug
4. WHEN tenant identification fails, THE Tenant_Guard SHALL return a 401 Unauthorized response with a clear error message
5. WHEN a valid tenant context is established, THE Tenant_Guard SHALL attach it to the request for downstream services
6. WHEN a user belongs to multiple tenants, THE Tenant_Guard SHALL use the tenant specified in the JWT token

### Requirement 3: Deal Isolation

**User Story:** As a financial analyst, I want my deals to be completely private to my organization, so that competitors cannot see our analysis work.

#### Acceptance Criteria

1. WHEN creating a deal, THE Deal_Service SHALL associate the deal with the current tenant_id
2. WHEN listing deals, THE Deal_Service SHALL return only deals belonging to the current tenant
3. WHEN fetching a deal by ID, THE Deal_Service SHALL verify the deal belongs to the current tenant before returning it
4. WHEN updating a deal, THE Deal_Service SHALL verify tenant ownership before allowing modifications
5. WHEN deleting a deal, THE Deal_Service SHALL verify tenant ownership before deletion
6. IF a user attempts to access a deal from another tenant, THEN THE Deal_Service SHALL return a 404 Not Found (not 403) to prevent information leakage

### Requirement 4: Chat Session Isolation

**User Story:** As a financial analyst, I want my chat conversations to be private to my organization, so that our analysis discussions remain confidential.

#### Acceptance Criteria

1. WHEN creating a chat session, THE Chat_Service SHALL associate the session with the current tenant_id via the deal relationship
2. WHEN sending a message, THE Chat_Service SHALL verify the session belongs to a deal owned by the current tenant
3. WHEN retrieving conversation history, THE Chat_Service SHALL return only messages from tenant-owned sessions
4. WHEN clearing conversation history, THE Chat_Service SHALL verify tenant ownership before deletion
5. WHEN the RAG system generates responses, THE system SHALL only include context from tenant-accessible data sources
6. IF a user attempts to access a chat session from another tenant's deal, THEN THE Chat_Service SHALL return a 404 Not Found

### Requirement 5: Document Upload Isolation

**User Story:** As a financial analyst, I want my uploaded documents to be private to my organization, so that proprietary research remains confidential.

#### Acceptance Criteria

1. WHEN uploading a document, THE Document_Service SHALL store it in a tenant-specific S3 prefix (tenants/{tenant_id}/uploads/)
2. WHEN uploading a document, THE Document_Service SHALL create a private data_source record with owner_tenant_id set
3. WHEN listing documents, THE Document_Service SHALL return only documents owned by the current tenant
4. WHEN downloading a document, THE Document_Service SHALL verify tenant ownership before generating signed URL
5. WHEN deleting a document, THE Document_Service SHALL verify tenant ownership before deletion
6. WHEN processing a document, THE Document_Service SHALL tag all extracted chunks with tenant_id for RAG filtering

### Requirement 6: RAG Query Isolation

**User Story:** As a financial analyst, I want RAG queries to only return results from data I have access to, so that I don't see other organizations' private data.

#### Acceptance Criteria

1. WHEN executing a RAG query, THE RAG_Service SHALL include tenant_id in Bedrock KB metadata filters
2. WHEN retrieving structured metrics, THE RAG_Service SHALL filter by tenant-accessible data sources
3. WHEN retrieving narrative chunks, THE RAG_Service SHALL filter by tenant-accessible data sources
4. WHEN a tenant queries public SEC data, THE RAG_Service SHALL include public data sources in results
5. WHEN a tenant queries their uploaded documents, THE RAG_Service SHALL include only their private data sources
6. WHEN generating responses, THE RAG_Service SHALL never mix private data from different tenants in the same response

### Requirement 7: Cross-Deal Analysis Within Tenant

**User Story:** As a financial analyst, I want to query across multiple deals I own for company comparison analysis, so that I can leverage all my research in one query.

#### Acceptance Criteria

1. WHEN a user initiates a cross-deal query, THE RAG_Service SHALL identify all deals owned by the current tenant
2. WHEN executing a cross-deal query, THE RAG_Service SHALL include data from all tenant-owned deals in the context
3. WHEN a cross-deal query involves multiple tickers, THE RAG_Service SHALL retrieve SEC data for all specified tickers
4. WHEN a cross-deal query involves uploaded documents, THE RAG_Service SHALL include relevant uploads from any tenant deal
5. WHEN displaying cross-deal results, THE system SHALL clearly indicate which deal each piece of information came from
6. WHEN a cross-deal query is executed, THE system SHALL log the query for usage tracking and billing

### Requirement 8: Public SEC Data - Process Once, Share Many

**User Story:** As a financial analyst, I want to access public SEC filings without them being duplicated per tenant, so that storage is efficient and data is consistent across all users.

#### Acceptance Criteria

1. WHEN SEC filings are ingested from EDGAR, THE system SHALL store raw files in public/sec-filings/raw/{ticker}/{filing_type}/ (no tenant prefix)
2. WHEN SEC filings are processed, THE system SHALL store extracted data in public/sec-filings/processed/{ticker}/ (single copy for all tenants)
3. WHEN creating a data_source record for SEC filings, THE system SHALL set visibility='public' and owner_tenant_id=NULL
4. WHEN indexing SEC chunks to Bedrock KB, THE system SHALL set tenant_id=NULL in metadata to indicate public access
5. WHEN a tenant queries SEC data, THE RAG_Service SHALL include data sources WHERE visibility='public' in the filter
6. WHEN multiple tenants query the same SEC filing simultaneously, THE system SHALL serve from the identical S3 objects and database records
7. WHEN a new SEC filing is ingested, THE system SHALL make it immediately available to all tenants without per-tenant processing
8. WHEN calculating storage costs, THE system SHALL attribute public SEC data to shared infrastructure (not per-tenant billing)
9. WHEN a tenant creates a deal for a public company, THE system SHALL NOT duplicate SEC data - only create deal-specific metadata linking to public data sources

### Requirement 9: Tenant User Management

**User Story:** As a tenant admin, I want to manage users within my organization with different permission levels, so that I can control who can view, edit, or admin our data.

#### Acceptance Criteria

1. WHEN a tenant admin adds a user, THE system SHALL create a tenant_user record with specified role (admin, analyst, viewer)
2. WHEN a viewer user attempts to create a deal, THE system SHALL deny the action based on role permissions
3. WHEN an analyst user attempts to delete a deal, THE system SHALL allow or deny based on configured permissions
4. WHEN a tenant admin removes a user, THE system SHALL revoke all access for that user to tenant data
5. WHEN listing tenant users, THE system SHALL return only users belonging to the current tenant
6. WHEN a user's role changes, THE system SHALL immediately reflect the new permissions on subsequent requests

### Requirement 10: Audit Logging

**User Story:** As a tenant admin, I want all data access to be logged, so that I can audit who accessed what data and when.

#### Acceptance Criteria

1. WHEN a user accesses a deal, THE system SHALL log the access with tenant_id, user_id, deal_id, and timestamp
2. WHEN a user executes a RAG query, THE system SHALL log the query with data sources accessed and tokens used
3. WHEN a user uploads a document, THE system SHALL log the upload with file details and tenant context
4. WHEN a user downloads a document, THE system SHALL log the download with document_id and user context
5. WHEN viewing audit logs, THE system SHALL return only logs for the current tenant
6. WHEN audit logs are created, THE system SHALL include IP address and user agent for security analysis

### Requirement 11: Database Query Enforcement

**User Story:** As a system, I want all database queries to be automatically scoped to the current tenant, so that developers cannot accidentally leak data across tenants.

#### Acceptance Criteria

1. WHEN a service queries the deals table, THE Tenant_Interceptor SHALL automatically add tenant_id filter
2. WHEN a service queries the analysis_sessions table, THE Tenant_Interceptor SHALL filter via deal.tenant_id join
3. WHEN a service queries the uploaded_documents table, THE Tenant_Interceptor SHALL automatically add tenant_id filter
4. WHEN a service queries financial_metrics, THE Tenant_Interceptor SHALL filter via data_source access rules
5. WHEN a raw SQL query is executed, THE system SHALL require explicit tenant_id parameter to prevent bypass
6. IF a query attempts to access data without tenant context, THEN THE system SHALL throw an error and log the attempt

### Requirement 12: S3 Access Control

**User Story:** As a system, I want S3 access to be controlled by tenant, so that one tenant cannot access another tenant's files even with a valid signed URL.

#### Acceptance Criteria

1. WHEN generating a signed URL for download, THE S3_Service SHALL verify tenant ownership of the document
2. WHEN uploading a file, THE S3_Service SHALL enforce the tenant-specific prefix (tenants/{tenant_id}/)
3. WHEN listing files, THE S3_Service SHALL only return files within the tenant's prefix
4. WHEN deleting a file, THE S3_Service SHALL verify the file is within the tenant's prefix
5. WHEN a signed URL is generated, THE S3_Service SHALL set appropriate expiration (default 1 hour)
6. IF a request attempts to access files outside tenant prefix, THEN THE S3_Service SHALL deny access and log the attempt

### Requirement 13: API Response Sanitization

**User Story:** As a system, I want API responses to never leak tenant information, so that attackers cannot enumerate tenants or their data.

#### Acceptance Criteria

1. WHEN a resource is not found or access is denied, THE API SHALL return 404 Not Found (not 403 Forbidden)
2. WHEN returning error messages, THE API SHALL not include tenant_id or other tenant-identifying information
3. WHEN returning lists, THE API SHALL not include total counts that could reveal data from other tenants
4. WHEN returning metadata, THE API SHALL strip internal tenant references from client-facing responses
5. WHEN logging errors, THE system SHALL include tenant context in logs but not in client responses
6. WHEN rate limiting, THE system SHALL apply limits per tenant to prevent one tenant from affecting others
