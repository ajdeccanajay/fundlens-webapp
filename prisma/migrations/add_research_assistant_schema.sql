-- Migration: Add Research Assistant Schema
-- Description: Tenant-wide research conversations, notebooks, and IC memos
-- Date: 2026-01-26

-- ============================================================
-- RESEARCH CONVERSATIONS (Tenant-wide, not deal-specific)
-- ============================================================

CREATE TABLE research_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  
  -- Indexes for performance
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_tenant_conversations ON research_conversations(tenant_id, updated_at DESC);
CREATE INDEX idx_user_conversations ON research_conversations(user_id, updated_at DESC);
CREATE INDEX idx_conversation_archived ON research_conversations(tenant_id, is_archived, updated_at DESC);
CREATE INDEX idx_conversation_pinned ON research_conversations(tenant_id, is_pinned, updated_at DESC);

-- ============================================================
-- RESEARCH MESSAGES
-- ============================================================

CREATE TABLE research_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES research_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_conversation FOREIGN KEY (conversation_id) REFERENCES research_conversations(id)
);

CREATE INDEX idx_conversation_messages ON research_messages(conversation_id, created_at ASC);
CREATE INDEX idx_message_created ON research_messages(created_at DESC);

-- Full-text search on message content
CREATE INDEX idx_messages_content_fts ON research_messages USING gin(to_tsvector('english', content));

-- ============================================================
-- RESEARCH NOTEBOOKS (Replaces deal-specific scratch pads)
-- ============================================================

CREATE TABLE research_notebooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_archived BOOLEAN DEFAULT FALSE,
  insight_count INTEGER DEFAULT 0,
  
  CONSTRAINT fk_notebook_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_tenant_notebooks ON research_notebooks(tenant_id, updated_at DESC);
CREATE INDEX idx_user_notebooks ON research_notebooks(user_id, updated_at DESC);
CREATE INDEX idx_notebook_archived ON research_notebooks(tenant_id, is_archived, updated_at DESC);

-- ============================================================
-- RESEARCH INSIGHTS (Saved from conversations)
-- ============================================================

CREATE TABLE research_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id UUID NOT NULL REFERENCES research_notebooks(id) ON DELETE CASCADE,
  message_id UUID REFERENCES research_messages(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  selected_text TEXT,
  user_notes TEXT,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  companies TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  position INTEGER DEFAULT 0,
  
  CONSTRAINT fk_notebook FOREIGN KEY (notebook_id) REFERENCES research_notebooks(id)
);

CREATE INDEX idx_notebook_insights ON research_insights(notebook_id, position ASC);
CREATE INDEX idx_insight_tags ON research_insights USING gin(tags);
CREATE INDEX idx_insight_companies ON research_insights USING gin(companies);
CREATE INDEX idx_insight_message ON research_insights(message_id);

-- Full-text search on insight content
CREATE INDEX idx_insights_content_fts ON research_insights USING gin(to_tsvector('english', content));

-- ============================================================
-- IC MEMOS (Generated from notebooks)
-- ============================================================

CREATE TABLE ic_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  notebook_id UUID REFERENCES research_notebooks(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  template_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'final')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_memo_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_tenant_memos ON ic_memos(tenant_id, updated_at DESC);
CREATE INDEX idx_user_memos ON ic_memos(user_id, updated_at DESC);
CREATE INDEX idx_memo_status ON ic_memos(tenant_id, status, updated_at DESC);

-- ============================================================
-- USER PREFERENCES (For context management)
-- ============================================================

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_user_prefs_tenant ON user_preferences(tenant_id);

-- ============================================================
-- CONVERSATION SHARES (For collaboration)
-- ============================================================

CREATE TABLE conversation_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES research_conversations(id) ON DELETE CASCADE,
  share_token VARCHAR(255) UNIQUE NOT NULL,
  created_by UUID NOT NULL,
  permissions VARCHAR(50) DEFAULT 'read' CHECK (permissions IN ('read', 'comment', 'edit')),
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT fk_share_conversation FOREIGN KEY (conversation_id) REFERENCES research_conversations(id)
);

CREATE INDEX idx_share_token ON conversation_shares(share_token);
CREATE INDEX idx_share_conversation ON conversation_shares(conversation_id);
CREATE INDEX idx_share_expires ON conversation_shares(expires_at);

-- ============================================================
-- CONVERSATION TEMPLATES
-- ============================================================

CREATE TABLE conversation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  query_patterns JSONB DEFAULT '[]'::jsonb,
  example_messages JSONB DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  is_public BOOLEAN DEFAULT FALSE,
  
  CONSTRAINT fk_template_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_tenant_templates ON conversation_templates(tenant_id, category);
CREATE INDEX idx_public_templates ON conversation_templates(is_public, category);

-- ============================================================
-- TRIGGERS FOR AUTO-UPDATE
-- ============================================================

-- Update conversation.updated_at on new message
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE research_conversations
  SET 
    updated_at = NOW(),
    last_message_at = NOW(),
    message_count = message_count + 1
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON research_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();

-- Update notebook.updated_at on new insight
CREATE OR REPLACE FUNCTION update_notebook_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE research_notebooks
  SET 
    updated_at = NOW(),
    insight_count = (
      SELECT COUNT(*) FROM research_insights WHERE notebook_id = NEW.notebook_id
    )
  WHERE id = NEW.notebook_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_notebook_timestamp
AFTER INSERT ON research_insights
FOR EACH ROW
EXECUTE FUNCTION update_notebook_timestamp();

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE research_conversations IS 'Tenant-wide research conversations (not tied to specific deals)';
COMMENT ON TABLE research_messages IS 'Messages within research conversations with full context';
COMMENT ON TABLE research_notebooks IS 'User notebooks for organizing saved insights';
COMMENT ON TABLE research_insights IS 'Saved insights from conversations for IC memo generation';
COMMENT ON TABLE ic_memos IS 'Investment Committee memos generated from notebooks';
COMMENT ON TABLE user_preferences IS 'User preferences for context management and AI behavior';
COMMENT ON TABLE conversation_shares IS 'Shareable conversation links with permissions';
COMMENT ON TABLE conversation_templates IS 'Reusable conversation templates for common workflows';
