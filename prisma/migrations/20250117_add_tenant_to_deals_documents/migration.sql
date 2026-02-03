-- Add tenant_id to deals and documents tables
-- This migration adds tenant isolation to deals and documents

-- Step 1: Add tenant_id column to deals (nullable initially for existing data)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Step 2: Add tenant_id column to documents (nullable initially for existing data)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Step 3: Update existing deals to use default tenant
UPDATE deals 
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

-- Step 4: Update existing documents to use default tenant
UPDATE documents 
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

-- Step 5: Make tenant_id NOT NULL after data migration
ALTER TABLE deals ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE documents ALTER COLUMN tenant_id SET NOT NULL;

-- Step 6: Add foreign key constraints
ALTER TABLE deals 
ADD CONSTRAINT fk_deals_tenant 
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE documents 
ADD CONSTRAINT fk_documents_tenant 
FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- Step 7: Create indexes for efficient tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_deals_tenant_id ON deals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);

-- Step 8: Create composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_deals_tenant_status ON deals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_tenant_ticker ON deals(tenant_id, ticker);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_type ON documents(tenant_id, document_type);
