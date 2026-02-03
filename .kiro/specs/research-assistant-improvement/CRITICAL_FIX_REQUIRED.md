# CRITICAL FIX REQUIRED - Research Assistant Not Working

## Root Cause Identified ⚠️

**The Research Assistant tables are missing from the Prisma schema!**

The migration SQL files exist (`add_research_assistant_schema_simple.sql`) but the Prisma models are NOT defined in `prisma/schema.prisma`. This means:

1. ❌ Backend code expects `Conversation`, `Message`, `Notebook`, `Insight` models
2. ❌ Prisma doesn't know about these tables
3. ❌ API calls fail with "Cannot read properties of undefined"
4. ❌ No responses appear in the UI

## Diagnostic Results

```
✅ Database connected
✅ AAPL data exists (1421 narrative chunks, 8724 financial metrics)
❌ Research tables missing from Prisma schema
❌ Conversation model: undefined
❌ Notebook model: undefined
⚠️  JWT_SECRET not set in environment
```

## Fix Steps

### Step 1: Add Research Assistant Models to Prisma Schema

Add these models to `prisma/schema.prisma`:

```prisma
// ============================================================
// RESEARCH ASSISTANT MODELS
// ============================================================

model Conversation {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String    @map("tenant_id") @db.Uuid
  userId         String    @map("user_id") @db.Uuid
  title          String    @db.VarChar(255)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt      DateTime  @default(now()) @map("updated_at") @db.Timestamp(6)
  lastMessageAt  DateTime? @map("last_message_at") @db.Timestamp(6)
  isPinned       Boolean   @default(false) @map("is_pinned")
  isArchived     Boolean   @default(false) @map("is_archived")
  messageCount   Int       @default(0) @map("message_count")
  
  messages       Message[]

  @@index([tenantId, updatedAt(sort: Desc)], map: "idx_tenant_conversations")
  @@index([userId, updatedAt(sort: Desc)], map: "idx_user_conversations")
  @@index([tenantId, isArchived, updatedAt(sort: Desc)], map: "idx_conversation_archived")
  @@index([tenantId, isPinned, updatedAt(sort: Desc)], map: "idx_conversation_pinned")
  @@map("research_conversations")
}

model Message {
  id             String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  conversationId String       @map("conversation_id") @db.Uuid
  role           String       @db.VarChar(20)
  content        String       @db.Text
  sources        Json         @default("[]")
  metadata       Json         @default("{}")
  tokensUsed     Int          @default(0) @map("tokens_used")
  createdAt      DateTime     @default(now()) @map("created_at") @db.Timestamp(6)
  
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  insights       Insight[]

  @@index([conversationId, createdAt(sort: Asc)], map: "idx_conversation_messages")
  @@index([createdAt(sort: Desc)], map: "idx_message_created")
  @@map("research_messages")
}

model Notebook {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  title        String    @db.VarChar(255)
  description  String?   @db.Text
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamp(6)
  isArchived   Boolean   @default(false) @map("is_archived")
  insightCount Int       @default(0) @map("insight_count")
  
  insights     Insight[]
  icMemos      IcMemo[]

  @@index([tenantId, updatedAt(sort: Desc)], map: "idx_tenant_notebooks")
  @@index([userId, updatedAt(sort: Desc)], map: "idx_user_notebooks")
  @@index([tenantId, isArchived, updatedAt(sort: Desc)], map: "idx_notebook_archived")
  @@map("research_notebooks")
}

model Insight {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  notebookId   String    @map("notebook_id") @db.Uuid
  messageId    String?   @map("message_id") @db.Uuid
  content      String    @db.Text
  selectedText String?   @map("selected_text") @db.Text
  userNotes    String?   @map("user_notes") @db.Text
  tags         String[]  @default([])
  companies    String[]  @default([])
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamp(6)
  position     Int       @default(0)
  
  notebook     Notebook  @relation(fields: [notebookId], references: [id], onDelete: Cascade)
  message      Message?  @relation(fields: [messageId], references: [id], onDelete: SetNull)

  @@index([notebookId, position(sort: Asc)], map: "idx_notebook_insights")
  @@index([messageId], map: "idx_insight_message")
  @@map("research_insights")
}

model IcMemo {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  userId       String    @map("user_id") @db.Uuid
  notebookId   String?   @map("notebook_id") @db.Uuid
  title        String    @db.VarChar(255)
  content      String    @db.Text
  templateType String?   @map("template_type") @db.VarChar(50)
  status       String    @default("draft") @db.VarChar(50)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamp(6)
  
  notebook     Notebook? @relation(fields: [notebookId], references: [id], onDelete: SetNull)

  @@index([tenantId, updatedAt(sort: Desc)], map: "idx_tenant_memos")
  @@index([userId, updatedAt(sort: Desc)], map: "idx_user_memos")
  @@index([tenantId, status, updatedAt(sort: Desc)], map: "idx_memo_status")
  @@map("ic_memos")
}

model UserPreference {
  userId      String   @id @map("user_id") @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  preferences Json     @default("{}")
  updatedAt   DateTime @default(now()) @map("updated_at") @db.Timestamp(6)

  @@index([tenantId], map: "idx_user_prefs_tenant")
  @@map("user_preferences")
}

model ConversationShare {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  conversationId String    @map("conversation_id") @db.Uuid
  shareToken     String    @unique @db.VarChar(255)
  createdBy      String    @map("created_by") @db.Uuid
  permissions    String    @default("read") @db.VarChar(50)
  expiresAt      DateTime? @map("expires_at") @db.Timestamp(6)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamp(6)

  @@index([shareToken], map: "idx_share_token")
  @@index([conversationId], map: "idx_share_conversation")
  @@index([expiresAt], map: "idx_share_expires")
  @@map("conversation_shares")
}

model ConversationTemplate {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  name            String   @db.VarChar(255)
  description     String?  @db.Text
  category        String?  @db.VarChar(100)
  queryPatterns   Json     @default("[]") @map("query_patterns")
  exampleMessages Json     @default("[]") @map("example_messages")
  createdBy       String   @map("created_by") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamp(6)
  isPublic        Boolean  @default(false) @map("is_public")

  @@index([tenantId, category], map: "idx_tenant_templates")
  @@index([isPublic, category], map: "idx_public_templates")
  @@map("conversation_templates")
}
```

### Step 2: Apply the Migration

```bash
# Run the SQL migration
psql -d fundlens -f prisma/migrations/add_research_assistant_schema_simple.sql

# Generate Prisma Client
npx prisma generate

# Verify tables exist
psql -d fundlens -c "\dt research_*"
```

### Step 3: Set JWT_SECRET

Add to `.env`:
```bash
JWT_SECRET=your-secret-key-here-change-in-production
```

### Step 4: Restart Backend

```bash
npm run start:dev
```

### Step 5: Test

1. Open: `http://localhost:3000/app/deals/workspace.html?ticker=AAPL`
2. Login if needed
3. Click "Research Assistant"
4. Ask: "What are the key risks for AAPL?"
5. Should see streaming response

## Quick Fix Script

Run this to apply all fixes:

```bash
#!/bin/bash

echo "🔧 Fixing Research Assistant..."

# 1. Apply migration
echo "1️⃣  Applying database migration..."
psql -d fundlens -f prisma/migrations/add_research_assistant_schema_simple.sql

# 2. Add JWT_SECRET if missing
if ! grep -q "JWT_SECRET" .env; then
  echo "2️⃣  Adding JWT_SECRET to .env..."
  echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
fi

# 3. Generate Prisma Client
echo "3️⃣  Generating Prisma Client..."
npx prisma generate

# 4. Verify
echo "4️⃣  Verifying tables..."
psql -d fundlens -c "SELECT COUNT(*) FROM research_conversations;"

echo "✅ Fix complete! Restart backend with: npm run start:dev"
```

## Alternative: Use Prisma Migrate

If you want Prisma to manage migrations:

```bash
# 1. Add models to schema.prisma (see above)

# 2. Create migration
npx prisma migrate dev --name add_research_assistant

# 3. Generate client
npx prisma generate
```

## Verification

After applying fixes, run diagnostic again:

```bash
node scripts/diagnose-research-assistant.js
```

Should show:
```
✅ Database connected
✅ AAPL data exists
✅ Conversation table exists
✅ Notebook table exists
✅ JWT_SECRET is set
✅ All checks passed!
```

## Why This Happened

The research assistant was implemented with:
1. ✅ Backend services (`src/research/*.service.ts`)
2. ✅ Backend controllers (`src/research/*.controller.ts`)
3. ✅ Frontend UI (`public/app/deals/workspace.html`)
4. ✅ Migration SQL (`prisma/migrations/*.sql`)
5. ❌ **Prisma schema models** ← MISSING!

Without the Prisma models, the backend code fails when trying to access `prisma.conversation`, `prisma.notebook`, etc.

## Impact

This affects:
- ❌ Research Assistant in workspace.html
- ❌ Research Assistant in comprehensive-financial-analysis.html
- ❌ Research Assistant in /app/research/index.html
- ❌ All conversation and notebook features

## Priority

🔴 **CRITICAL** - Research Assistant completely non-functional without these models.

## Next Steps

1. Add models to `prisma/schema.prisma` (copy from above)
2. Apply migration SQL
3. Generate Prisma Client
4. Set JWT_SECRET
5. Restart backend
6. Test with AAPL query

Once fixed, the Research Assistant will work as designed with full conversation memory, streaming responses, and scratchpad functionality.
