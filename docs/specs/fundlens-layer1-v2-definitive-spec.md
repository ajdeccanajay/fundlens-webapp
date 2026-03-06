# FUNDLENS — Layer 1 v2: Document Intelligence Engine

**Definitive Architecture & Implementation Specification**
**February 24, 2026 | v2.0**

---

> **WHAT CHANGED FROM v1**
>
> v1 was pipeline-first. v2 is product-first. The critical review identified 10 problems — the most severe being that v1 made users wait 2-3 minutes before they could ask questions. v2 delivers queryable documents in 5 seconds.
>
> Key changes: Textract dropped as default (Vision LLM primary + deterministic verification). Three-layer cross-validation replaced with simpler two-layer verify. 6-table schema collapsed to 2 tables (JSONB). Progressive availability instead of binary "processing/ready." File management split into chat upload (1 file, instant) vs Deal Library (bulk, background). Multi-tenant architecture designed for 100s of clients from day 1.

> **⛔ WHY THE PREVIOUS BUILD FAILED (Still applies)**
>
> 1. Monolithic Lambda trying to do everything at once — timed out on large files
> 2. Embedding model mismatch between ephemeral path and Bedrock KB
> 3. No graceful degradation — any failure = user gets nothing
>
> v2 adds a fourth lesson learned:
> 4. **Pipeline completed before user could interact** — 2-3 minute wait killed UX

---

## Table of Contents

1. [Architecture Overview — The 5-Second Promise](#1-architecture-overview)
2. [Two Upload Paths: Chat vs Deal Library](#2-two-upload-paths)
3. [Chat Upload: Instant Intelligence Pipeline](#3-chat-upload-instant-intelligence-pipeline)
4. [Deal Library: Background Processing Pipeline](#4-deal-library-background-processing-pipeline)
5. [Extraction Engine: Vision LLM + Deterministic Verification](#5-extraction-engine)
6. [Integration with Existing Knowledge Base](#6-integration-with-existing-knowledge-base)
7. [Query Routing: The Unified Search Layer](#7-query-routing)
8. [Multi-Tenant Architecture at Scale](#8-multi-tenant-architecture)
9. [Database Schema (2 Tables)](#9-database-schema)
10. [Frontend Specification](#10-frontend-specification)
11. [Implementation Plan (4 Sessions, 8 Days)](#11-implementation-plan)
12. [Testing & Validation (25 Tests)](#12-testing-and-validation)

---

## 1. Architecture Overview — The 5-Second Promise

Every architectural decision in this spec serves one constraint: **the user can ask questions about an uploaded document within 5 seconds of dropping it.**

Quality improves over the next 60-120 seconds as background extraction completes, but the user is never blocked. This is a progressive availability model, not a pipeline-completion model.

### 1.1 The Four Data Sources

When a user asks a question in FundLens, the answer can come from four places:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         QUERY ROUTER                                 │
│  Receives user query + context (tenant, deal, chat session)          │
│  Decides which sources to search, merges results, sends to LLM      │
├──────────┬──────────────┬────────────────┬──────────────────────────┤
│ SOURCE 1 │  SOURCE 2    │   SOURCE 3     │    SOURCE 4              │
│          │              │                │                          │
│ Extracted│  OpenSearch   │  Bedrock KB    │  Long-Context            │
│ Metrics  │  (ephemeral)  │  (persistent)  │  Fallback                │
│ (RDS)    │              │                │                          │
│          │              │                │                          │
│ Determin-│  Uploaded doc │  SEC filings + │  Raw doc text            │
│ istic DB │  chunks from  │  synced uploads │  sent directly           │
│ lookup   │  recent       │  from Deal     │  to Claude 200K          │
│          │  chat upload  │  Library        │  context window          │
│          │              │                │                          │
│ Speed:   │  Speed:      │  Speed:        │  Speed:                  │
│ < 50ms   │  < 500ms     │  < 2s          │  3-8s                    │
│          │              │                │                          │
│ For:     │  For:        │  For:          │  For:                    │
│ "What is │  "What does  │  "What did the │  Anything, when          │
│ the price│  this report │  10-K say      │  other sources           │
│ target?" │  say about   │  about revenue │  fail or don't           │
│          │  margins?"   │  growth?"      │  exist yet               │
└──────────┴──────────────┴────────────────┴──────────────────────────┘
```

**Source 1 (Extracted Metrics)** is checked FIRST for any numeric/factual query. If the answer exists as a structured extraction, it's returned deterministically — no LLM reasoning needed. This is the "deterministic when you can" principle.

**Source 2 (OpenSearch ephemeral)** holds chunks from recently uploaded documents in the chat. These are embedded with Titan V2 and indexed in a tenant-scoped OpenSearch index. Available within 30-60 seconds of upload.

**Source 3 (Bedrock KB)** is the persistent, authoritative knowledge base. Contains SEC filings (EDGAR pipeline) and Deal Library documents that have completed async sync. This is the existing RAG pipeline — we don't touch it.

**Source 4 (Long-Context Fallback)** is the safety net. If a document was just uploaded (< 30 seconds ago) and hasn't been chunked/embedded yet, the query router sends the raw text directly to Claude's 200K context window. The user always gets an answer.

### 1.2 Progressive Availability Timeline

```
T+0s:    User drops file in chat
T+2s:    S3 upload complete
T+3s:    Raw text parsed (pdf-parse). Document classified (Haiku, 1s).
T+5s:    ✅ QUERYABLE — Long-context fallback active
         Status pill: "Ready for questions"
         Instant Intelligence: headline metrics shown proactively
T+30s:   Background: Vision extraction on key pages complete
T+45s:   Background: Structured metrics persisted to RDS
T+60s:   Background: Chunks embedded, OpenSearch indexed
         Quality upgrade: vector search now supplements long-context
T+90s:   Background: Full extraction complete
         All metrics, comp tables, narratives stored
T+15min: Cron: Bedrock KB sync triggered (if document in Deal Library)
T+30min: Bedrock KB sync complete → document available via persistent RAG
```

The status pill shows "Ready for questions" at T+5s. Everything after that is invisible quality improvement.

---

## 2. Two Upload Paths: Chat vs Deal Library

### 2.1 Why Two Paths

| Dimension | Chat Upload | Deal Library |
|-----------|------------|--------------|
| **User intent** | "I want to ask about this RIGHT NOW" | "I'm building the knowledge base for this deal" |
| **Latency expectation** | Instant (< 5s to queryable) | Background (minutes is fine) |
| **Volume** | 1 file at a time | Bulk (10s of files) |
| **Persistence** | Session-scoped + async sync to KB | Permanent from the start |
| **Where it lives** | Research chat interface | Deal Library page |
| **Processing priority** | HIGH — user is waiting | NORMAL — background queue |
| **KB sync** | Eventually (async, after session) | Always (primary purpose) |

### 2.2 What Goes Where

| Document Type | Chat Upload | Deal Library | Reason |
|---|---|---|---|
| Sell-side report (just received, need quick analysis) | ✅ Primary | Also good | Analyst wants answers NOW |
| CIM (100+ pages, deal reference) | ❌ Too large | ✅ Primary | Background processing appropriate |
| Earnings transcript (checking a specific quote) | ✅ Primary | Also good | Quick lookup |
| 20 sample IC memos (style training) | ❌ Wrong place | ✅ Tenant-level setting | One-time setup, not per-query |
| Fund mandate / IPS | ❌ Wrong place | ✅ Tenant-level setting | Applies to all deals |
| Excel model (comp table) | ✅ Fine | Also good | Either path works |

### 2.3 Chat Upload Restrictions

```
Max files per message:     1  (was 5 in v1 — reduced for latency guarantee)
Max file size:             50 MB
Supported types:           PDF, DOCX, XLSX, CSV, TXT, PNG, JPG
Processing priority:       HIGH (jumps background queue)
Queryable guarantee:       5 seconds (long-context fallback)
```

> **⛔ WHY ONLY 1 FILE IN CHAT**
>
> The 5-second queryable promise is hard to keep with multiple files. Each file needs: S3 upload (2s), text parse (2s), LLM classification (1s), instant intelligence extraction (3s). With 5 files, that's 40 seconds before all files are queryable — and the user's first question might reference any of them. One file keeps the promise tight.
>
> If the analyst needs to compare multiple reports: upload them to Deal Library first, then query across them in chat. Deal Library documents are pre-processed and available immediately via Bedrock KB.

---

## 3. Chat Upload: Instant Intelligence Pipeline

This is the critical path. Every millisecond matters.

### 3.1 Phase A: Instant Intelligence (0-5 seconds, BLOCKING)

The user WAITS for this phase. It must complete in < 5 seconds.

```typescript
// instant-intelligence.service.ts
// This is the HOT PATH. No external services except S3 + one LLM call.

async processInstantIntelligence(
  documentId: string,
  s3Key: string,
  fileType: string,
): Promise<InstantIntelligenceResult> {

  // Step 1: Parse raw text (< 2 seconds)
  // Uses pdf-parse for PDFs, mammoth for DOCX, xlsx for spreadsheets
  // NO external API calls — all local processing
  const rawText = await this.parser.extractText(s3Key, fileType);
  const hasTextLayer = rawText.length > 100;

  // Step 2: First-page classification + headline extraction (< 3 seconds)
  // ONE LLM call combining classification AND headline metrics
  const firstPages = rawText.substring(0, 8000); // ~first 2-3 pages
  const headline = await this.llm.invoke({
    model: 'anthropic.claude-sonnet-4-5-20250929',
    temperature: 0,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: INSTANT_INTELLIGENCE_PROMPT.replace('{{FIRST_PAGES}}', firstPages)
    }]
  });

  // Step 3: Store raw text for long-context fallback
  await this.documentService.update(documentId, {
    status: 'queryable',
    processingMode: 'long-context-fallback', // Will upgrade as background completes
    documentType: headline.documentType,
    rawTextS3Key: await this.storeRawText(documentId, rawText),
    companyTicker: headline.ticker,
    companyName: headline.companyName,
  });

  // Step 4: Persist headline metrics immediately
  if (headline.metrics?.length > 0) {
    await this.extractionService.persistHeadlineMetrics(
      documentId, headline.metrics
    );
  }

  return {
    documentType: headline.documentType,
    companyName: headline.companyName,
    ticker: headline.ticker,
    summary: headline.summary,
    headlineMetrics: headline.metrics,
    suggestedQuestions: headline.suggestedQuestions,
  };
}
```

### 3.2 Instant Intelligence Prompt

This single prompt does document classification, headline extraction, and question suggestion in one LLM call:

```
You are a financial document classifier and headline extractor.
Given the first 2-3 pages of a document, return a JSON response with:

1. documentType: one of [sell-side-report, ic-memo, pe-cim, earnings-transcript,
   sec-10k, sec-10q, sec-8k, sec-proxy, fund-mandate, spreadsheet, presentation, generic]
2. companyName: the primary company this document is about
3. ticker: the stock ticker if identifiable
4. summary: a 1-sentence description (e.g., "Goldman Sachs initiating coverage on Apple Inc.")
5. metrics: array of headline metrics visible on the first pages. For each:
   - metric_key: canonical name (price_target, rating, revenue, ebitda, etc.)
   - raw_value: as displayed ("$275", "Overweight", "$391.0B")
   - numeric_value: parsed number or null
   - period: if identifiable (FY2024E, Q3 2024, LTM, etc.)
   - is_estimate: true if analyst estimate, false if reported actual
6. suggestedQuestions: 3 questions an analyst would likely ask about this document

Respond with ONLY valid JSON. No markdown, no explanation.

Document text:
{{FIRST_PAGES}}
```

### 3.3 What the User Sees at T+5s

```
📄 Goldman_AAPL_Report.pdf  ✅ Ready for questions

I see a Goldman Sachs research report on Apple Inc. (AAPL).

  Rating: Overweight
  Price Target: $275
  Revenue (FY2025E): $412.5B
  EPS (FY2025E): $7.83

You might want to ask:
  → What's the comp table look like?
  → What are the key risks Goldman identifies?
  → How does this compare to AAPL's actual reported numbers?
```

This proactive display is the product moment. The analyst didn't ask anything yet — the system already did what they would have done first (look at page 1 for the rating and price target).

### 3.4 Phase B: Background Enrichment (5-120 seconds, NON-BLOCKING)

Fires asynchronously after Phase A completes. The user is already querying.

```typescript
// background-enrichment.service.ts
// Runs in SQS consumer or Bull queue — NOT in the request path

async enrichDocument(documentId: string): Promise<void> {
  const doc = await this.documentService.getDocument(documentId);

  // ── Step 1: Vision Extraction on Key Pages (30-60s) ──
  // Identify pages with tables, charts, or complex layouts
  const rawText = await this.s3.getObject(doc.rawTextS3Key);
  const pageImages = await this.renderPagesToImages(doc.s3Key, {
    dpi: 200,
    pages: this.identifyKeyPages(rawText, doc.documentType),
  });

  const visionResults = await Promise.all(
    pageImages.map(img => this.extractWithVision(img, doc.documentType))
  );
  // Parallelized — 10 pages × 5s each = ~15s with 4 parallel calls

  // ── Step 2: Deterministic Verification ──
  // Every number from vision extraction is verified against raw text
  const verifiedExtractions = this.verifyAgainstRawText(
    visionResults, rawText
  );

  // ── Step 3: Persist Structured Extractions ──
  await this.extractionService.persistExtractions(documentId, {
    metrics: verifiedExtractions.metrics,
    tables: verifiedExtractions.tables,
    narratives: verifiedExtractions.narratives,
    footnotes: verifiedExtractions.footnotes,
    entities: verifiedExtractions.entities,
  });

  // ── Step 4: Chunk + Embed + Index ──
  const chunks = await this.chunker.chunk(rawText, visionResults, {
    maxTokens: 600,
    overlap: 100,
    preserveTables: true,
    documentType: doc.documentType,
    extractedMetrics: verifiedExtractions.metrics,
  });

  const embeddings = await this.embedder.embedBatch(
    chunks.map(c => c.text),
    'amazon.titan-embed-text-v2:0' // ⛔ MUST match Bedrock KB
  );

  const indexName = `fundlens-uploads-${doc.tenantId}`;
  await this.searchIndex.bulkIndex(indexName, chunks, embeddings);

  // ── Step 5: Upgrade document status ──
  await this.documentService.update(documentId, {
    processingMode: 'fully-indexed',
    chunkCount: chunks.length,
    metricCount: verifiedExtractions.metrics.length,
  });

  // ── Step 6: Queue for Bedrock KB sync (if also in Deal Library) ──
  if (doc.dealLibraryId) {
    await this.kbSyncQueue.enqueue({
      documentId,
      chunks,
      priority: 'normal',
    });
  }
}
```

### 3.5 Phase B Extraction: Vision LLM + Deterministic Verification

This replaces the three-layer cross-validation from v1.

```
Layer 1: VISION LLM (Claude Sonnet 4.5) — PRIMARY EXTRACTOR
   Sends page images → structured JSON output
   Understands: metric names, periods, estimates vs actuals,
                table structure, footnote references, chart data
   Accuracy: ~97% on digital PDFs
   Cost: ~$0.005/page
   Speed: 3-5s/page (parallelizable)

Layer 2: DETERMINISTIC VERIFICATION — CHECKS THE LLM
   For every number the LLM extracted:
     Search for that number (or scaled variant) in raw text
     If found → CONFIRMED (confidence: 1.0)
     If not found → FLAGGED (confidence: 0.7)
   Cost: $0 (string matching)
   Speed: < 100ms total
```

Why this is better than three-layer cross-validation:

1. **No false disagreements.** Cross-validation failed when layers produced `$391,035` vs `$391.0B` — same number, different format. Verification against raw text doesn't have this problem because the raw text IS the ground truth for what's printed on the page.

2. **Cheaper.** One vision call + free string matching vs. three extraction layers.

3. **Faster.** No Textract async queue. Vision LLM is called directly and responds in 3-5s.

4. **Smarter.** Claude understands "EV/EBITDA (NTM)" as a forward valuation multiple. Textract sees it as text in a cell. This semantic understanding is critical for table classification and metric identification.

```typescript
// verification.service.ts

function verifyExtractedNumber(
  extracted: { value: number; rawDisplay: string },
  rawText: string,
  tableUnits?: string, // 'millions', 'billions', etc.
): VerificationResult {

  // Generate all plausible text representations
  const candidates = generateNumberCandidates(extracted.value, tableUnits);

  // Search raw text for any matching representation
  for (const candidate of candidates) {
    const index = rawText.indexOf(candidate);
    if (index !== -1) {
      return {
        verified: true,
        confidence: 1.0,
        foundAt: index,
        matchedRepresentation: candidate,
      };
    }
  }

  // Not found in raw text — could be LLM hallucination
  return {
    verified: false,
    confidence: 0.7,
    flag: 'NUMBER_NOT_IN_RAW_TEXT',
  };
}

function generateNumberCandidates(
  value: number, units?: string
): string[] {
  const candidates: string[] = [];
  const abs = Math.abs(value);

  // Raw number formats
  const formats = [
    abs.toFixed(0),                         // 391000
    abs.toLocaleString('en-US'),            // 391,000
    abs.toFixed(1),                         // 391000.0
    abs.toFixed(2),                         // 391000.00
  ];

  // Scaled representations (in millions, billions, etc.)
  if (units === 'millions' || abs >= 1_000_000) {
    const inM = abs / 1_000_000;
    formats.push(inM.toFixed(0), inM.toFixed(1), inM.toLocaleString('en-US'));
  }
  if (units === 'billions' || abs >= 1_000_000_000) {
    const inB = abs / 1_000_000_000;
    formats.push(inB.toFixed(0), inB.toFixed(1), inB.toLocaleString('en-US'));
  }
  if (units === 'thousands' || abs >= 1_000) {
    const inK = abs / 1_000;
    formats.push(inK.toFixed(0), inK.toFixed(1), inK.toLocaleString('en-US'));
  }

  // With currency and negative indicators
  for (const fmt of formats) {
    candidates.push(fmt);
    candidates.push(`$${fmt}`);
    candidates.push(`(${fmt})`);      // Negative in parens
    candidates.push(`($${fmt})`);
    candidates.push(`-${fmt}`);
    candidates.push(`-$${fmt}`);
    candidates.push(`${fmt}%`);
    candidates.push(`${fmt}x`);       // Multiples: 12.3x
  }

  return candidates;
}
```

### 3.6 When to Use Textract (Exception, Not Default)

Textract is NOT in the default pipeline. It activates ONLY when:

```typescript
const needsTextract =
  // Document has no text layer (scanned/photographed)
  !doc.hasTextLayer &&
  // AND it's a PDF or image (not DOCX/XLSX which always have text)
  ['application/pdf', 'image/png', 'image/jpeg'].includes(doc.fileType);
```

For the ~5-10% of uploads that are scanned documents, Textract provides the OCR text layer that Vision LLM and deterministic verification need. For the 90%+ that are digital-native PDFs, Textract adds cost and latency with no accuracy benefit.

---

## 4. Deal Library: Background Processing Pipeline

The Deal Library is a persistent document management area within each deal. Documents uploaded here are processed in the background and synced to Bedrock KB for permanent availability across all chat sessions.

### 4.1 Deal Library ≠ VDR

This is NOT a virtual data room. It's an internal deal document library:

| VDR (what we are NOT) | Deal Library (what we ARE) |
|---|---|
| External sharing with counterparties | Internal research team only |
| Watermarked, view-only documents | Full extraction and analysis |
| Activity tracking (who viewed what) | Processing status tracking |
| Permission tiers per document | Tenant-level access control |
| Competing with Datasite/Intralinks | Complementing existing VDR |

### 4.2 Deal Library UI Structure

```
Deal: Apple Inc. (AAPL) — Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 All Documents (12 files)
   Filter: [All] [Sell-Side] [Filings] [Transcripts] [CIMs] [Memos] [Other]
   Sort:   [Date ↓] [Name] [Type] [Status]

   📄 Goldman_AAPL_Report.pdf        Sell-Side    ✅ Ready    Jan 15
   📄 MS_AAPL_Initiation.pdf         Sell-Side    ✅ Ready    Jan 12
   📄 AAPL_10K_2024.pdf              10-K Filing  ✅ Ready    Dec 20
   📄 AAPL_Q4_Transcript.pdf         Transcript   🔄 Processing (pg 12/30)  Jan 30
   📄 BofA_AAPL_Update.pdf           Sell-Side    ⏳ Queued   Jan 31
   📄 AAPL_Comp_Model.xlsx           Spreadsheet  ✅ Ready    Jan 10
   ...

   [+ Upload Files]  [+ Import from SEC Filings]
```

Key points:
- **One flat list with filters** — system classifies document type automatically via LLM
- **No user-sorted folders** — analyst uploads, system categorizes
- **Status shows page-level progress** — "Processing (pg 12/30)" not "Chunking..."
- **Batch upload supported** — drag 10 files, all queued for background processing

### 4.3 Background Processing Pipeline

```typescript
// deal-library-processor.service.ts
// SQS consumer — processes documents from Deal Library queue
// Lower priority than chat uploads. Can run on cheaper compute.

async processDealLibraryDocument(documentId: string): Promise<void> {
  const doc = await this.documentService.getDocument(documentId);
  const docProfile = await this.classifyDocument(doc);

  try {
    // Step 1: Full text extraction
    const rawText = await this.parser.extractText(doc.s3Key, doc.fileType);

    // Step 2: Vision extraction on all key pages
    // (More aggressive than chat — we have time)
    const keyPages = this.identifyAllKeyPages(rawText, docProfile);
    const visionResults = await this.extractWithVisionBatch(
      doc.s3Key, keyPages, docProfile,
      { parallelism: 4, retries: 2 } // More retries for background
    );

    // Step 3: Verify + persist extractions
    const verified = this.verifyAgainstRawText(visionResults, rawText);
    await this.extractionService.persistExtractions(documentId, verified);

    // Step 4: Chunk + embed + index in OpenSearch
    const chunks = await this.chunker.chunk(rawText, visionResults, {
      maxTokens: 600, overlap: 100,
      preserveTables: true,
      documentType: docProfile.type,
    });

    const embeddings = await this.embedder.embedBatch(
      chunks.map(c => c.text)
    );

    await this.searchIndex.bulkIndex(
      `fundlens-uploads-${doc.tenantId}`, chunks, embeddings
    );

    await this.documentService.update(documentId, {
      status: 'queryable',
      processingMode: 'fully-indexed',
    });

    // Step 5: Prepare for Bedrock KB sync
    await this.prepareKBChunks(documentId, chunks);
    await this.documentService.update(documentId, {
      kbSyncStatus: 'prepared',
    });

    // Actual KB sync happens via cron (see Section 6)

  } catch (err) {
    // Deal Library docs get retried (unlike chat uploads which fallback)
    if (doc.retryCount < 3) {
      await this.requeueWithBackoff(documentId, doc.retryCount + 1);
    } else {
      await this.documentService.update(documentId, {
        status: 'error',
        error: err.message,
      });
    }
  }
}
```

### 4.4 Tenant-Level Configuration (NOT per-deal)

Two document types belong at the tenant level, not in individual deals:

#### Fund Mandate / IPS

```
Settings → Fund Profile
━━━━━━━━━━━━━━━━━━━━━━━

Investment Style:     Deep Value
Target Return:        15%+ IRR
Sector Preferences:   Industrials, Energy, Financials
Sector Exclusions:    Tobacco, Weapons
Valuation Criteria:   Entry below 10x normalized EV/EBITDA
                      Discount to intrinsic value > 30%
Red Flags:            Customer concentration > 25%
                      Negative FCF > 2 consecutive years

[Upload IPS Document for Auto-Extraction]  [Edit Manually]
```

This is STRUCTURED DATA extracted once from an uploaded IPS, then stored as a tenant configuration. It grounds every deal's provocations and analysis without being re-uploaded per deal.

#### Sample IC Memos

```
Settings → Memo Style
━━━━━━━━━━━━━━━━━━━━━━

📄 TAVF_AAPL_Memo_2024.docx     ✅ Analyzed
📄 TAVF_XOM_Memo_2023.docx      ✅ Analyzed
📄 TAVF_JPM_Memo_2024.docx      ✅ Analyzed

Style Profile: Extracted ✅
  Sections: [Thesis] [Variant Perception] [Valuation] [Risks] [Catalysts]
  Tone: Formal, evidence-driven, contrarian emphasis
  Typical length: 8-12 pages

[+ Upload More Memos]
```

Uploaded once, applies to all deals' memo generation.

---

## 5. Extraction Engine: Vision LLM + Deterministic Verification

See Section 3.5 for the core architecture. This section covers document-type-specific extraction.

### 5.1 Document Type Profiles

Each document type has different extraction priorities:

| Document Type | Headline Metrics (Phase A) | Full Extraction (Phase B) | Key Tables |
|---|---|---|---|
| **Sell-Side Report** | Rating, price target, ticker | EPS/revenue estimates, comp table, DCF, risks | Comp table, valuation summary |
| **IC Memo** | Recommendation, target price, conviction | Bull/bear/base cases, variant perception, key assumptions | Comp table, historical financials |
| **PE CIM** | Revenue, EBITDA, growth rate | Adjusted EBITDA + add-backs, customer concentration, cap table | Income statement, segment breakdown |
| **Earnings Transcript** | Guidance numbers | Q&A themes, management tone, new disclosures | Guidance table (if any) |
| **SEC 10-K** | Revenue, net income, EPS | All 3 financial statements, segment data, risk factors | Income stmt, balance sheet, cash flow |
| **Spreadsheet** | Column headers + first row | All data, formulas, sheet structure | Entire file IS the table |

### 5.2 Vision Extraction Prompt

```
You are a financial document extraction engine. Extract ALL structured data
from this page image with 100% fidelity to what is printed.

RULES:
1. Extract EVERY number exactly as displayed. No rounding, no inference.
2. Parentheses (123) = negative. Note the sign.
3. Capture UNITS: "$M", "$B", "$K", "%", "x" (multiple), "bps".
4. Mark estimates: look for "E", "est.", italics, shading, consensus.
5. Capture footnote references (superscript markers).
6. Identify the TIME PERIOD per column: FY2023, Q3 2024, LTM, NTM, FY2025E.
7. For comp tables: capture company name/ticker AND metric in each cell.
8. For charts: extract title, axis labels, and approximate data point values.

Document type: {{DOCUMENT_TYPE}}
Page number: {{PAGE_NUMBER}}

Return ONLY valid JSON:
{
  "tables": [{
    "tableType": "<income-statement|balance-sheet|comp-table|valuation-summary|...>",
    "title": "<visible title>",
    "currency": "<USD|EUR|...>",
    "units": "<millions|billions|thousands|percentage>",
    "headers": [{"cells": [...], "rowIndex": 0}],
    "rows": [{
      "label": "<row label>",
      "cells": [{
        "value": "<raw display>",
        "numericValue": <number|null>,
        "isNegative": <bool>,
        "isEstimate": <bool>,
        "period": "<FY2024|Q3 2024E|LTM|NTM>"
      }],
      "footnoteRefs": ["1", "a"]
    }]
  }],
  "charts": [{
    "chartType": "<bar|line|pie|waterfall|...>",
    "title": "<title>",
    "dataPoints": [{"label": "<x>", "value": <y>, "series": "<name>"}]
  }],
  "narratives": [{
    "type": "<heading|paragraph|bullet|callout>",
    "text": "<exact text>"
  }],
  "footnotes": [{"marker": "<1|a|*>", "text": "<footnote text>"}],
  "entities": {
    "companies": ["<names and tickers>"],
    "dates": ["<dates>"],
    "metrics": ["<metric names>"]
  }
}
```

### 5.3 Comp Table Rendering with Edit Capability

When a comp table is extracted, show it inline in the chat:

```
📊 I extracted a comparable companies table from page 8 (15 companies, 6 metrics):

| Company    | EV/EBITDA (NTM) | P/E (NTM) | Rev Growth | EBITDA Margin |
|------------|-----------------|-----------|------------|---------------|
| Paychex    | 22.3x           | 31.2x     | 7.1%       | 42.3%         |
| ADP        | 19.8x           | 27.5x     | 8.3%       | 28.1%         |
| Paycom     | 25.1x           | 35.4x     | 11.2%      | 38.7%         |
| Median     | 21.5x           | 29.8x     | 8.7%       | 35.4%         |

[View full table · Source: Goldman Sachs, p.8]

Anything look off, or want me to compare against SEC filings?
```

The analyst validates in 3 seconds by scanning the table. This builds trust and catches the 3% of extraction errors that Vision LLM produces. No engineering needed for "cross-validation" — the human IS the cross-validator.

---

## 6. Integration with Existing Knowledge Base

This is the critical integration. FundLens already has:
- SEC filings processed via EDGAR pipeline → Bedrock KB
- Structured metrics in RDS via custom Python extraction
- Intent detection → metric resolution → structured retrieval

Uploaded documents must integrate seamlessly.

### 6.1 The Golden Rule

> **⛔ EMBEDDING MODEL MUST MATCH**
>
> The existing Bedrock KB uses `amazon.titan-embed-text-v2:0` with 1024 dimensions.
> Every ephemeral OpenSearch index for uploaded documents MUST use the same model
> and dimensions. If these diverge, queries that search both sources will return
> inconsistent relevance rankings. This was a failure point in the previous build.

### 6.2 How Uploaded Documents Reach Bedrock KB

```
CHAT UPLOAD PATH:
  Upload → instant intelligence (5s) → background enrichment (60s)
    → OpenSearch index (ephemeral, per-tenant) ← queries hit this
    → IF document also in Deal Library:
        → Prepare KB chunks → S3 kb-ready/ prefix
        → Cron sync to Bedrock KB (every 15 min)
        → Once synced: queries prefer Bedrock KB

DEAL LIBRARY PATH:
  Upload → background processing (2-5 min)
    → OpenSearch index (ephemeral, per-tenant) ← queries hit this immediately
    → Prepare KB chunks → S3 kb-ready/ prefix
    → Cron sync to Bedrock KB (every 15 min)
    → Once synced: authoritative source
```

### 6.3 Bedrock KB Sync Cron (Existing Architecture)

This already exists in the codebase. The only change is: uploaded documents now also write to the `kb-ready/` S3 prefix alongside SEC filings.

```
S3 Bucket Structure:
s3://fundlens-{env}/
├── kb-ready/                     # Bedrock KB ingestion source
│   └── {tenant_id}/
│       └── {deal_id}/
│           ├── sec-filings/      # ← Existing EDGAR pipeline writes here
│           │   ├── AAPL_10K_2024_chunk_001.json
│           │   └── ...
│           └── uploads/          # ← NEW: processed uploads write here
│               ├── goldman_report_chunk_001.json
│               └── ...
├── raw-uploads/                  # Original uploaded files
│   └── {tenant_id}/
│       └── {deal_id}/
│           └── {document_id}/
│               └── original_file.pdf
└── extracted/                    # Structured extraction output
    └── {tenant_id}/
        └── {deal_id}/
            └── {document_id}/
                └── extraction.json
```

Bedrock KB data source points to `s3://fundlens-{env}/kb-ready/{tenant_id}/{deal_id}/`. Both SEC filings and uploaded documents land in the same prefix. KB sync picks up everything.

### 6.4 Metadata Filtering for Tenant + Deal Isolation

Every chunk stored in Bedrock KB includes metadata for filtering:

```json
{
  "metadataAttributes": {
    "tenant_id": "uuid-...",
    "deal_id": "uuid-...",
    "document_id": "uuid-...",
    "document_type": "sell-side-report",
    "source": "upload",           // or "sec-filing" or "earnings-transcript"
    "company_ticker": "AAPL",
    "file_name": "Goldman_AAPL_Report.pdf",
    "is_estimate": "true",        // For sell-side estimates
    "section_type": "comp-table", // or "risk-factors", "mda", etc.
    "period": "FY2025E"
  }
}
```

Query-time filtering ALWAYS includes `tenant_id` + `deal_id`:

```python
bedrock.retrieve(
    knowledgeBaseId=KB_ID,
    retrievalQuery={"text": user_query},
    retrievalConfiguration={
        "vectorSearchConfiguration": {
            "filter": {
                "andAll": [
                    {"equals": {"key": "tenant_id", "value": tenant_id}},
                    {"equals": {"key": "deal_id", "value": deal_id}}
                ]
            }
        }
    }
)
```

---

## 7. Query Routing: The Unified Search Layer

When a user asks a question in the chat, the query router searches all relevant sources and merges results.

### 7.1 Routing Decision Tree

```typescript
async routeQuery(
  query: string,
  context: { tenantId: string; dealId: string; chatSessionId: string }
): Promise<MergedRetrievalResult> {

  const results: RetrievalResult[] = [];

  // ── SOURCE 1: Extracted Metrics (deterministic, < 50ms) ──
  // ALWAYS check first for any numeric/factual query
  const intentResult = await this.intentDetector.classify(query);

  if (intentResult.hasMetrics) {
    // Check existing SEC filing metrics (RDS)
    const secMetrics = await this.structuredRetriever.retrieve(
      intentResult.metrics, context
    );

    // Check uploaded document metrics (RDS document_extractions table)
    const uploadMetrics = await this.extractionService.queryMetrics(
      intentResult.metrics, context
    );

    if (secMetrics.length > 0) results.push({ source: 'sec-structured', data: secMetrics });
    if (uploadMetrics.length > 0) results.push({ source: 'upload-structured', data: uploadMetrics });
  }

  // ── SOURCE 2: OpenSearch Ephemeral (uploaded doc chunks, < 500ms) ──
  const uploadedDocs = await this.documentService.getDocsByDeal(
    context.dealId, ['queryable']
  );

  if (uploadedDocs.some(d => d.processingMode === 'fully-indexed')) {
    const osResults = await this.openSearch.knnSearch({
      index: `fundlens-uploads-${context.tenantId}`,
      query: query,
      k: 10,
      filter: { dealId: context.dealId },
    });
    if (osResults.length > 0) results.push({ source: 'upload-vector', data: osResults });
  }

  // ── SOURCE 3: Bedrock KB (SEC filings + synced uploads, < 2s) ──
  const kbResults = await this.bedrockKB.retrieve(query, {
    tenantId: context.tenantId,
    dealId: context.dealId,
    k: 10,
  });
  if (kbResults.length > 0) results.push({ source: 'bedrock-kb', data: kbResults });

  // ── SOURCE 4: Long-Context Fallback ──
  const longContextDocs = uploadedDocs.filter(
    d => d.processingMode === 'long-context-fallback'
  );
  if (longContextDocs.length > 0) {
    // These are recently uploaded docs not yet chunked
    // Send raw text directly to LLM
    const rawTexts = await Promise.all(
      longContextDocs.map(d => this.s3.getObject(d.rawTextS3Key))
    );
    results.push({ source: 'long-context', data: rawTexts });
  }

  // ── MERGE + DEDUPLICATE ──
  return this.mergeResults(results, query, context);
}
```

### 7.2 Source Precedence for Conflicting Data

When the same metric appears from multiple sources:

```typescript
function resolveConflict(
  secValue: MetricResult | null,
  uploadValue: MetricResult | null,
): ResolvedMetric {

  // Both exist → SHOW BOTH with attribution
  if (secValue && uploadValue) {
    return {
      displayMode: 'comparison',
      values: [
        {
          value: secValue.numericValue,
          source: `${secValue.filingType} filing (${secValue.period})`,
          nature: 'reported-actual',
        },
        {
          value: uploadValue.numericValue,
          source: `${uploadValue.fileName} (${uploadValue.period})`,
          nature: uploadValue.isEstimate ? 'analyst-estimate' : 'reported-actual',
        },
      ],
    };
  }

  // Only one exists → return it with clear attribution
  return {
    displayMode: 'single',
    values: [(secValue || uploadValue)],
  };
}
```

Response format when conflicts exist:

```
AAPL Revenue:
• $383.3B (FY2024 actual) — 10-K filing, p.47
• $391.0B (FY2024E est.) — Goldman Sachs report, p.3
• $412.5B (FY2025E est.) — Goldman Sachs report, p.3
```

---

## 8. Multi-Tenant Architecture at Scale

Designed for 100s of clients from day 1.

### 8.1 Isolation Model

```
┌─────────────────────────────────────────────────────────────┐
│ TENANT A (Third Avenue)                                       │
│                                                               │
│  Fund Profile: { style: "deep value", ... }                  │
│  Memo Style:   { sections: [...], tone: "formal", ... }      │
│                                                               │
│  ├── Deal: AAPL                                              │
│  │   ├── OpenSearch index: fundlens-uploads-{tenantA}        │
│  │   ├── S3: kb-ready/{tenantA}/{dealAAPL}/                  │
│  │   ├── Bedrock KB filter: tenant_id={tenantA}, deal=AAPL   │
│  │   └── RDS: WHERE tenant_id = {tenantA} AND deal_id = ... │
│  │                                                            │
│  └── Deal: XOM                                               │
│      ├── Same OpenSearch index (filtered by deal_id)         │
│      ├── S3: kb-ready/{tenantA}/{dealXOM}/                   │
│      └── ...                                                  │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ TENANT B (Different Fund)                                     │
│                                                               │
│  Fund Profile: { style: "growth equity", ... }               │
│  Memo Style:   { ... different style ... }                   │
│                                                               │
│  ├── Deal: AAPL   (same company, completely isolated data)   │
│  │   ├── OpenSearch index: fundlens-uploads-{tenantB}        │
│  │   ├── S3: kb-ready/{tenantB}/{dealAAPL}/                  │
│  │   └── ... ZERO overlap with Tenant A's AAPL data         │
│  └── ...                                                      │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Scaling Strategy

| Component | Strategy for 100s of Clients | Cost Consideration |
|---|---|---|
| **OpenSearch** | One index per tenant (`fundlens-uploads-{tenantId}`). Filter by `deal_id` within index. Max ~500 indexes on a 3-node cluster. | ~$0.50/month/tenant for storage. Compute shared. |
| **Bedrock KB** | Single KB, single data source. Tenant+deal isolation via S3 prefix + metadata filtering. | KB charges per retrieval, not per tenant. Scales linearly. |
| **S3** | Prefix isolation: `{tenant_id}/{deal_id}/`. Lifecycle rules archive old deals. | Negligible at document scale. |
| **RDS** | Single database, `tenant_id` column on every table. Row-level security optional. | Standard Aurora pricing. |
| **SQS Processing Queue** | Single queue with priority attribute. Chat uploads = high priority, Deal Library = normal. | Negligible. |
| **Embedding API (Titan V2)** | Shared. Rate limit: 10 req/sec default. Request increase for production. | ~$0.0001 per 1K tokens. |
| **Vision LLM (Sonnet)** | Shared. Rate limit per Bedrock account. | ~$0.005/page. Budget: $2/document average. |

### 8.3 Per-Document Cost Model

| Operation | Cost per Page | 30-page Report | 200-page 10-K |
|---|---|---|---|
| S3 storage | negligible | negligible | negligible |
| Text parsing (pdf-parse) | $0 (local) | $0 | $0 |
| Instant Intelligence (Sonnet, first 2 pages) | ~$0.005 | $0.005 | $0.005 |
| Vision extraction (Sonnet, key pages only) | ~$0.005/page | ~$0.05 (10 pages) | ~$0.15 (30 pages) |
| Titan V2 embedding | ~$0.0001/chunk | ~$0.003 | ~$0.020 |
| OpenSearch indexing | negligible | negligible | negligible |
| **Total per document** | — | **~$0.06** | **~$0.18** |
| With Textract (if scanned) | +$0.065/page | +$1.95 | +$13.00 |

Key insight: Vision LLM extraction is 10-20x cheaper than Textract for digital PDFs and more accurate on financial tables. Textract only adds cost for scanned documents.

---

## 9. Database Schema (2 Tables)

### 9.1 Documents Table (RDS)

```sql
CREATE TABLE documents (
  document_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  deal_id           UUID NOT NULL,
  chat_session_id   UUID,                    -- NULL for Deal Library uploads
  deal_library_id   UUID,                    -- NULL for chat-only uploads

  -- File metadata
  file_name         VARCHAR(500) NOT NULL,
  file_type         VARCHAR(100) NOT NULL,
  file_size         BIGINT NOT NULL,
  s3_key            VARCHAR(1000) NOT NULL,
  raw_text_s3_key   VARCHAR(1000),           -- Parsed raw text for fallback

  -- Classification
  document_type     VARCHAR(50),             -- sell-side-report, ic-memo, etc.
  company_ticker    VARCHAR(20),
  company_name      VARCHAR(200),

  -- Processing state
  status            VARCHAR(20) NOT NULL DEFAULT 'uploading',
                    -- uploading | queryable | fully-indexed | error
  processing_mode   VARCHAR(30),
                    -- long-context-fallback | fully-indexed
  upload_source     VARCHAR(20) NOT NULL,
                    -- 'chat' | 'deal-library'

  -- Counts
  page_count        INT,
  chunk_count        INT,
  metric_count       INT,

  -- KB sync
  kb_sync_status    VARCHAR(20) DEFAULT 'pending',
                    -- pending | prepared | syncing | synced | failed
  kb_ingestion_job_id VARCHAR(200),

  -- Error handling
  error             TEXT,
  retry_count       INT DEFAULT 0,

  -- Timestamps
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_docs_tenant_deal ON documents(tenant_id, deal_id);
CREATE INDEX idx_docs_session ON documents(chat_session_id);
CREATE INDEX idx_docs_status ON documents(status);
CREATE INDEX idx_docs_kb_sync ON documents(kb_sync_status);
```

### 9.2 Document Extractions Table (RDS — JSONB)

```sql
CREATE TABLE document_extractions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES documents(document_id),
  tenant_id         UUID NOT NULL,
  deal_id           UUID NOT NULL,

  -- What was extracted
  extraction_type   VARCHAR(30) NOT NULL,
                    -- 'headline' | 'metric' | 'table' | 'narrative' | 'footnote' | 'entity' | 'chart'
  data              JSONB NOT NULL,          -- The actual extraction payload

  -- Location
  page_number       INT,
  section           VARCHAR(100),            -- 'financial-statements', 'comp-table', etc.

  -- Quality
  confidence        DECIMAL(3,2),            -- 0.00 to 1.00
  verified          BOOLEAN DEFAULT false,   -- Passed deterministic verification
  source_layer      VARCHAR(20),             -- 'headline' | 'vision' | 'text'

  created_at        TIMESTAMP DEFAULT NOW()
);

-- Fast lookup: "give me the price target for this document"
CREATE INDEX idx_extr_doc_type ON document_extractions(document_id, extraction_type);

-- Fast lookup: "give me all price targets across all documents for AAPL"
CREATE INDEX idx_extr_tenant_deal ON document_extractions(tenant_id, deal_id, extraction_type);

-- Search within JSONB: data->>'metric_key' = 'price_target'
CREATE INDEX idx_extr_data ON document_extractions USING GIN(data);

-- Cross-document comparison queries
CREATE INDEX idx_extr_metric_key ON document_extractions(tenant_id, deal_id)
  WHERE extraction_type = 'metric';
```

### 9.3 Example Queries

```sql
-- Get price target from a specific document
SELECT data->>'raw_value' as price_target,
       data->>'is_estimate' as is_estimate,
       confidence
FROM document_extractions
WHERE document_id = $1
  AND extraction_type = 'metric'
  AND data->>'metric_key' = 'price_target';

-- Compare price targets across ALL uploaded reports for AAPL
SELECT d.file_name as source,
       e.data->>'raw_value' as price_target,
       e.data->>'period' as period,
       e.confidence
FROM document_extractions e
JOIN documents d ON e.document_id = d.document_id
WHERE e.tenant_id = $1
  AND e.deal_id = $2
  AND e.extraction_type = 'metric'
  AND e.data->>'metric_key' = 'price_target'
ORDER BY e.confidence DESC;

-- Get full comp table
SELECT data
FROM document_extractions
WHERE document_id = $1
  AND extraction_type = 'table'
  AND data->>'tableType' = 'comp-table';
```

---

## 10. Frontend Specification

### 10.1 Chat Upload (research.html — Alpine.js)

Minimal addition to existing chat. One file at a time.

```javascript
// Add to existing Alpine.js x-data
chatUpload: {
  file: null,          // { id, name, size, type, status, documentId }
  dragOver: false,

  async uploadFile(file) {
    if (this.chatUpload.file?.status === 'processing') {
      alert('Please wait for current file to finish processing.');
      return;
    }

    const fileEntry = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'uploading',
      documentId: null,
    };
    this.chatUpload.file = fileEntry;

    // 1. Get presigned URL
    const { uploadUrl, documentId } = await fetch('/api/documents/upload-url', {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name, fileType: file.type, fileSize: file.size,
        dealId: this.currentDealId, chatSessionId: this.chatSessionId,
        uploadSource: 'chat',
      }),
    }).then(r => r.json());

    fileEntry.documentId = documentId;

    // 2. Upload to S3
    await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

    // 3. Trigger processing — returns instant intelligence in < 5s
    fileEntry.status = 'processing';
    const intel = await fetch(`/api/documents/${documentId}/upload-complete`, {
      method: 'POST',
      headers: this.authHeaders(),
    }).then(r => r.json());

    // 4. Show instant intelligence
    fileEntry.status = 'ready';
    this.messages.push({
      role: 'assistant',
      content: this.formatInstantIntelligence(intel),
    });
  },

  formatInstantIntelligence(intel) {
    let msg = `📄 **${intel.fileName}** — ${intel.summary}\n\n`;
    if (intel.headlineMetrics?.length) {
      for (const m of intel.headlineMetrics) {
        msg += `  ${m.metric_key}: **${m.raw_value}**`;
        if (m.is_estimate) msg += ' (est.)';
        if (m.period) msg += ` [${m.period}]`;
        msg += '\n';
      }
    }
    if (intel.suggestedQuestions?.length) {
      msg += '\nYou might want to ask:\n';
      for (const q of intel.suggestedQuestions) {
        msg += `  → ${q}\n`;
      }
    }
    return msg;
  },
},
```

### 10.2 Status Pill (CSS)

```css
.chat-upload-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 20px; font-size: 13px;
  transition: all 200ms ease;
}
.chat-upload-pill--uploading { background: #EFF6FF; border: 1px solid #93C5FD; }
.chat-upload-pill--processing { background: #FFFBEB; border: 1px solid #FCD34D; }
.chat-upload-pill--ready { background: #F0FDF4; border: 1px solid #86EFAC; }
.chat-upload-pill--error { background: #FEF2F2; border: 1px solid #FCA5A5; }
```

### 10.3 Deal Library Page (deals/{dealId}/documents)

Standard file management page. Bulk upload, system-classified, with filters.

```html
<!-- deal-documents.html — Alpine.js component -->
<div x-data="dealDocuments()">

  <!-- Upload zone -->
  <div class="upload-zone"
       @dragover.prevent="dragOver = true"
       @dragleave="dragOver = false"
       @drop.prevent="handleDrop($event)"
       :class="{ 'upload-zone--active': dragOver }">
    <p>Drag files here or <button @click="$refs.fileInput.click()">browse</button></p>
    <input type="file" x-ref="fileInput" multiple @change="handleFiles($event)" hidden>
  </div>

  <!-- Filter bar -->
  <div class="filter-bar">
    <button @click="filter = 'all'" :class="{ active: filter === 'all' }">All</button>
    <button @click="filter = 'sell-side'" :class="...">Sell-Side</button>
    <button @click="filter = 'filings'" :class="...">Filings</button>
    <button @click="filter = 'transcripts'" :class="...">Transcripts</button>
    <button @click="filter = 'cims'" :class="...">CIMs</button>
    <button @click="filter = 'other'" :class="...">Other</button>
  </div>

  <!-- Document list -->
  <table>
    <thead>
      <tr><th>Name</th><th>Type</th><th>Status</th><th>Date</th></tr>
    </thead>
    <tbody>
      <template x-for="doc in filteredDocuments" :key="doc.id">
        <tr>
          <td x-text="doc.fileName"></td>
          <td><span class="type-badge" x-text="doc.documentType"></span></td>
          <td>
            <span x-show="doc.status === 'queryable' || doc.status === 'fully-indexed'">✅ Ready</span>
            <span x-show="doc.status === 'processing'">
              🔄 Processing (<span x-text="doc.progress"></span>)
            </span>
            <span x-show="doc.status === 'error'">❌ Failed</span>
          </td>
          <td x-text="doc.createdAt"></td>
        </tr>
      </template>
    </tbody>
  </table>
</div>
```

---

## 11. Implementation Plan (4 Sessions, 8 Days)

| # | Session | Days | Deliverable | Verification |
|---|---------|------|-------------|-------------|
| **1** | **Upload + Instant Intelligence** | 2 | S3 presigned upload. pdf-parse text extraction. Haiku classification. Sonnet headline extraction. Long-context fallback active. Status pill. `documents` + `document_extractions` tables. | Upload a Goldman report. Within 5s: see document type, rating, price target displayed. Ask "What are the key risks?" → get answer from raw text. |
| **2** | **Vision Extraction + Verification** | 2 | Page-to-image rendering. Vision extraction prompt (Sonnet). Deterministic verification against raw text. Persist metrics/tables/narratives to `document_extractions`. Comp table inline rendering. | Upload a sell-side report. Within 60s: comp table rendered in chat. Price target in `document_extractions` with confidence 1.0. Verify every extracted number exists in raw text. |
| **3** | **Chunking + OpenSearch + Query Routing** | 2 | Financial-aware chunking. Titan V2 embedding. Tenant-scoped OpenSearch indexing. Unified query router (4 sources). Source attribution on every answer. | Upload a report + have SEC filings loaded. Ask cross-source question. Both sources contribute with clear attribution. Estimate vs actual clearly labeled. |
| **4** | **Deal Library + KB Sync + Polish** | 2 | Deal Library page (bulk upload, filters, status). Background processing queue. KB sync prep (S3 kb-ready/ prefix). SSE status for processing progress. End-to-end testing across document types. | Upload 5 files via Deal Library. All process in background. All appear in chat queries. Verify tenant isolation. Verify KB sync prepares chunks correctly. |

### What's explicitly DEFERRED to Phase 2:

- Textract integration (for scanned docs — add when a client needs it)
- Bedrock KB data source creation per tenant (use existing single KB with metadata filtering)
- Footnote cross-reference linking (extract footnotes, don't link them yet)
- Narrative sentiment analysis
- Fund Profile settings page
- Memo Style settings page
- Multi-document differential analysis UI (the "Magic Wand" — queries work, dedicated UI is later)

---

## 12. Testing & Validation (25 Tests)

### Upload + Instant Intelligence
1. Upload 30-page sell-side PDF. Verify "Ready" in < 5 seconds.
2. Upload same file. Ask question immediately. Verify answer from long-context.
3. Verify instant intelligence shows: document type, ticker, rating, price target.
4. Upload DOCX IC memo. Verify classification as "ic-memo" (not generic).
5. Upload file with no obvious name clues ("doc_v3.pdf"). Verify LLM classification works.

### Extraction Accuracy
6. Upload sell-side report. Verify price target in `document_extractions` matches actual value.
7. Upload report with comp table (15+ companies). Verify ALL companies extracted.
8. Upload 10-K. Verify revenue, net income, EPS extracted from financial statements.
9. Verify every extracted number passes deterministic verification (exists in raw text).
10. Verify numbers with confidence < 0.7 are flagged, not silently stored.

### Query Routing
11. Ask "What is the price target?" → answer from extracted metrics (Source 1), not LLM.
12. Ask "What are the key risks?" → answer from vector search (Source 2/3).
13. Upload new doc, ask immediately (before chunking) → answer from long-context (Source 4).
14. Have SEC filing + uploaded report for same company. Ask "revenue" → both values shown with attribution.
15. Verify estimates labeled as estimates. Actuals labeled as actuals.

### Multi-Tenant Isolation
16. Upload doc as Tenant A. Query as Tenant B. Verify Tenant B sees NOTHING.
17. Verify S3 keys include tenant_id prefix.
18. Verify OpenSearch index is tenant-scoped.
19. Verify RDS queries always include tenant_id in WHERE clause.
20. Verify Bedrock KB queries include tenant_id filter.

### Deal Library
21. Upload 5 files via Deal Library. Verify all process in background.
22. Verify status shows page-level progress ("Processing pg 12/30").
23. Verify documents appear as queryable in chat once processing completes.
24. Verify failed documents retry up to 3 times.
25. Verify KB sync prep writes chunks to correct S3 prefix.

---

*CONFIDENTIAL | FundLens — AI-Powered Financial Intelligence Platform | February 2026*
