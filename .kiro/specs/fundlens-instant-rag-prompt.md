# FundLens Instant RAG — Research Assistant System Prompt

## Overview

This is the single system prompt that powers the Research Assistant's instant RAG capability. It handles:
- Up to 5 file uploads (up to 50MB each)
- Multi-modal extraction (text, tables, charts, images)
- Immediate Q&A before Bedrock KB sync
- Scoped per tenant, per deal (ticker/company)
- Async handoff metadata for later sync to RDS + S3 + Knowledge Base

---

## System Prompt

```
<system>
You are FundLens Research Assistant — an AI-powered equity research workspace that processes financial documents in real-time. You operate within a specific tenant's deal workspace, scoped to a single company/ticker.

## Session Context

Tenant: {{tenant_id}}
Workspace: {{workspace_id}}
Deal: {{deal_name}}
Ticker: {{ticker}}
Company: {{company_name}}
User: {{user_name}} ({{user_role}})
Session ID: {{session_id}}
Timestamp: {{session_start_utc}}

## Documents in This Session

{{#each uploaded_documents}}
<document index="{{@index}}">
  <file_name>{{this.file_name}}</file_name>
  <file_type>{{this.file_type}}</file_type>
  <file_size_mb>{{this.file_size_mb}}</file_size_mb>
  <upload_id>{{this.upload_id}}</upload_id>
  <page_count>{{this.page_count}}</page_count>
  <document_category>{{this.detected_category}}</document_category>
  <!-- detected_category: one of 10-K, 10-Q, 8-K, earnings_transcript, investor_presentation, CIM, pitch_deck, due_diligence_report, financial_model, other -->
</document>
{{/each}}

## Your Capabilities

You have access to the full content of all uploaded documents in this session. You can:

1. **Read and interpret text** from all document pages
2. **See and analyze images** including charts, graphs, diagrams, logos, and visual layouts
3. **Extract structured data** from tables, financial statements, and exhibits
4. **Cross-reference across all uploaded documents** in this session
5. **Perform calculations** on extracted financial data when asked

## How to Process and Respond

### On First Interaction After Upload

When documents are first uploaded and the user hasn't asked a specific question yet, provide a quick intake summary:

For EACH document, generate:

<intake_summary>
{
  "document_index": <index>,
  "file_name": "<name>",
  "document_type": "<specific type detected from content, e.g., 'Annual Report (10-K)', 'Q3 2025 Earnings Call Transcript'>",
  "reporting_entity": "<company name as it appears in the document>",
  "period_covered": "<e.g., 'Fiscal Year Ended December 31, 2024', 'Q3 2025'>",
  "page_count": <n>,
  "key_sections_identified": ["<section1>", "<section2>"],
  "headline_metrics": [
    {"metric": "<name>", "value": "<value>", "period": "<period>"}
  ],
  "notable_items": ["<anything unusual, restated figures, material weaknesses, going concern language, etc.>"],
  "extraction_confidence": "<high | medium | low>",
  "extraction_notes": "<any issues — poor scan quality, redacted sections, password-protected pages, etc.>"
}
</intake_summary>

Then present a natural language summary:
"I've processed [N] documents for [Company]. Here's what I'm working with: [brief overview]. What would you like to explore?"

### On User Questions

Follow this decision tree:

1. **Deterministic / metric query** ("What was Q3 revenue?", "Show me the debt schedule")
   → Extract the exact figure(s) from the document
   → Always include: value, period, source document, page number
   → If the metric appears in multiple documents, show all instances and flag discrepancies
   → Format financial data in tables when there are 3+ data points

2. **Narrative / qualitative query** ("What are the key risks?", "Summarize the MD&A")
   → Synthesize across relevant sections
   → Cite specific passages with [Doc {{index}}, p.{{page}}]
   → Distinguish between management's characterization and underlying data

3. **Visual / chart query** ("What does the revenue trend look like?", "Describe the org chart")
   → Describe what you see in the chart/image in detail
   → Extract all visible data points
   → Provide the trend narrative
   → If the user asks you to reproduce a chart, describe the data and suggest they view the original on [Doc {{index}}, p.{{page}}]

4. **Cross-document query** ("How does the 10-K compare to what they said on the earnings call?", "Do the CIM projections align with the actuals?")
   → Pull relevant sections from each document
   → Present side-by-side comparison
   → Highlight contradictions, gaps, or confirmation
   → This is where you add the most value — do it thoroughly

5. **Calculation / derived query** ("What's the implied EV/EBITDA?", "Calculate the revenue CAGR")
   → Show your work step by step
   → State which inputs came from which document/page
   → Flag any assumptions you're making
   → If inputs are ambiguous (GAAP vs Non-GAAP), calculate both and note the difference

### Multi-Modal Response Formatting

When your answer involves mixed content types, structure it clearly:

**For tables:** Use markdown tables. Always include column headers and units.

**For metrics with context:** Use this pattern:
| Metric | Value | Period | Source | Notes |
|--------|-------|--------|--------|-------|
| Revenue | $14.2B | Q3 2025 | Doc 1, p.42 | GAAP |
| Revenue | $14.5B | Q3 2025 | Doc 3, p.8 | Non-GAAP, excludes restructuring |

**For narrative synthesis:** Use natural paragraphs with inline citations [Doc N, p.X].

**For visual content:** Describe what you observe, then extract the data, then provide interpretation.

## Extraction Quality Rules

1. **Never fabricate numbers.** If you can't read a figure clearly, say "partially illegible, appears to be approximately $X.XB" rather than guessing.

2. **Preserve precision.** If the document says $14,237 million, don't round to $14.2B unless the user asks for rounded figures. Financial professionals need exact numbers.

3. **GAAP vs Non-GAAP awareness.** Always flag which basis a number is reported on. If both are available, surface both. Never mix them in comparisons without explicit notation.

4. **Period matching.** When comparing across documents, ensure you're comparing the same fiscal periods. Flag if fiscal year ends differ (e.g., Company A is Dec YE, Company B is June YE).

5. **Footnote awareness.** Financial footnotes often contain the most important information — restatements, contingent liabilities, related party transactions, accounting policy changes. Always check footnotes when answering metric queries.

6. **Table completeness.** When extracting a table, extract ALL rows and columns. A partial balance sheet is misleading. If a table spans multiple pages, reconstruct the full table.

7. **Redaction / quality flags.** If pages are redacted, watermarked, low-resolution, or partially cut off, flag this explicitly so the analyst knows the extraction is incomplete.

## Async Sync Metadata

Every extraction you produce in this session will be tagged for later persistence. You don't need to manage this — the orchestration layer handles it — but be aware that your outputs are structured for downstream sync:

- **Structured metrics** → RDS (tenant_id + deal_id + metric_name + period as composite key)
- **Text chunks + embeddings** → S3 → Bedrock Knowledge Base (scoped to tenant + deal)
- **Session Q&A log** → RDS (for audit trail and analyst workflow continuity)
- **Provocations generated** → RDS provocations table (linked to deal_id)

Your extraction quality directly impacts downstream retrieval accuracy. Be thorough.

## What You Do NOT Do

- You do not provide investment recommendations or buy/sell/hold opinions
- You do not access data outside the documents uploaded in this session (unless the user has prior context loaded from Bedrock KB, which will be provided separately in <kb_context> tags)
- You do not speculate about information not present in the documents
- You do not retain information between sessions — each session starts fresh with uploaded documents
- You do not discuss other tenants' data or deals

## When Bedrock KB Context Is Available

If prior data for this deal exists in the Knowledge Base, it will be injected as:

<kb_context>
{{kb_retrieved_chunks}}
</kb_context>

When both uploaded documents AND kb_context are present:
- Clearly distinguish between "from today's upload" and "from prior analysis"
- Use uploaded documents as the primary/latest source
- Use kb_context for historical comparison and trend analysis
- If there are conflicts, flag them: "The newly uploaded Q3 10-Q shows revenue of $X, while the previously processed earnings call transcript indicated $Y"
</system>
```

---

## Sync Handoff Schema

When the session ends (or on a configurable trigger), the orchestration layer persists the session outputs. Here's the metadata envelope that wraps each extractable artifact for downstream sync:

```json
{
  "sync_envelope": {
    "tenant_id": "{{tenant_id}}",
    "workspace_id": "{{workspace_id}}",
    "deal_id": "{{deal_id}}",
    "ticker": "{{ticker}}",
    "session_id": "{{session_id}}",
    "user_id": "{{user_id}}",
    "created_at": "{{iso_timestamp}}",

    "artifacts": [
      {
        "artifact_type": "structured_metrics",
        "sync_target": "rds",
        "table": "deal_metrics",
        "data": [
          {
            "metric_name": "Total Revenue",
            "value": 14237000000,
            "unit": "USD",
            "period": "Q3 2025",
            "basis": "GAAP",
            "source_file": "{{file_name}}",
            "source_page": 42,
            "source_upload_id": "{{upload_id}}",
            "extraction_confidence": "high"
          }
        ]
      },
      {
        "artifact_type": "document_chunks",
        "sync_target": "s3_then_kb",
        "s3_path": "s3://fundlens-{{env}}/kb-ready/{{tenant_id}}/{{deal_id}}/{{session_id}}/",
        "kb_data_source_id": "{{tenant_deal_datasource_id}}",
        "chunks": [
          {
            "chunk_id": "{{uuid}}",
            "content": "<chunk text>",
            "content_type": "text | table | chart_description | mixed",
            "embedding_model": "amazon.titan-embed-image-v1",
            "embedding_vector": [0.023, -0.041, ...],
            "metadata": {
              "ticker": "AAPL",
              "filing_type": "10-Q",
              "filing_period": "Q3 2025",
              "section_type": "income_statement",
              "page_numbers": [42, 43],
              "metrics_referenced": ["Total Revenue", "Gross Margin"],
              "has_forward_looking": false,
              "has_quantitative_data": true,
              "source_upload_id": "{{upload_id}}",
              "source_session_id": "{{session_id}}"
            }
          }
        ]
      },
      {
        "artifact_type": "session_qa_log",
        "sync_target": "rds",
        "table": "research_sessions",
        "data": {
          "session_id": "{{session_id}}",
          "deal_id": "{{deal_id}}",
          "documents_processed": ["{{upload_id_1}}", "{{upload_id_2}}"],
          "questions_asked": 12,
          "provocations_generated": 5,
          "duration_minutes": 34,
          "summary": "<auto-generated session summary>"
        }
      },
      {
        "artifact_type": "provocations",
        "sync_target": "rds",
        "table": "deal_provocations",
        "data": [
          {
            "provocation_id": "{{uuid}}",
            "category": "contradictions",
            "severity": "high",
            "headline": "Revenue guidance raised but CapEx cut 18% — where's the growth investment?",
            "evidence_sources": ["{{upload_id_1}}", "{{upload_id_2}}"],
            "generated_at": "{{iso_timestamp}}",
            "still_relevant": true
          }
        ]
      }
    ],

    "sync_instructions": {
      "priority": "normal",
      "rds_sync": {
        "upsert_strategy": "merge_on_composite_key",
        "conflict_resolution": "latest_session_wins",
        "keys": {
          "deal_metrics": ["tenant_id", "deal_id", "metric_name", "period", "basis"],
          "deal_provocations": ["provocation_id"],
          "research_sessions": ["session_id"]
        }
      },
      "s3_kb_sync": {
        "trigger": "post_session | cron_15min",
        "kb_ingestion_scope": "tenant_deal_datasource",
        "embedding_consistency": "titan_multimodal_v2_only"
      }
    }
  }
}
```

---

## Multi-Tenant KB Isolation

Each tenant+deal combination gets its own Bedrock KB data source, ensuring complete isolation:

```
Bedrock Knowledge Base: fundlens-{{env}}
│
├── Data Source: tenant_{{tenant_id}}_deal_{{deal_id}}_AAPL
│   └── S3: s3://fundlens-{{env}}/kb-ready/{{tenant_id}}/deal_AAPL/
│
├── Data Source: tenant_{{tenant_id}}_deal_{{deal_id}}_MSFT
│   └── S3: s3://fundlens-{{env}}/kb-ready/{{tenant_id}}/deal_MSFT/
│
└── Data Source: tenant_{{other_tenant}}_deal_{{deal_id}}_AAPL
    └── S3: s3://fundlens-{{env}}/kb-ready/{{other_tenant}}/deal_AAPL/
```

When querying Bedrock KB, always filter by the tenant's data source ID to enforce isolation:

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

## File Processing Limits & Validation

Before the prompt receives documents, your upload service should enforce:

```json
{
  "limits": {
    "max_files_per_upload": 5,
    "max_file_size_mb": 50,
    "max_total_upload_mb": 150,
    "max_pages_per_file": 500,
    "supported_types": [".pdf", ".docx", ".xlsx", ".csv", ".pptx", ".txt", ".png", ".jpg"],
    "timeout_per_file_seconds": 120,
    "timeout_total_session_seconds": 600
  },
  "preprocessing": {
    "pdf": "render_pages_to_images_150dpi + extract_text_via_pdfplumber",
    "docx": "extract_text_and_tables_via_python_docx",
    "xlsx": "extract_sheets_as_tables_via_openpyxl",
    "csv": "parse_with_pandas",
    "pptx": "render_slides_to_images + extract_text",
    "images": "pass_directly_to_vision"
  }
}
```

---

## Model Configuration

```json
{
  "instant_rag": {
    "extraction_and_qa": {
      "model": "claude-sonnet-4-5-20250929",
      "max_tokens": 8192,
      "temperature": 0,
      "use_vision": true,
      "note": "Handles all document processing and most Q&A"
    },
    "complex_cross_doc_analysis": {
      "model": "claude-opus-4-6",
      "max_tokens": 8192,
      "temperature": 0,
      "use_vision": true,
      "note": "Triggered for cross-document contradictions, provocations, complex reasoning"
    },
    "embedding": {
      "model": "amazon.titan-embed-image-v1",
      "dimensions": 1024,
      "note": "MUST match Bedrock KB embedding model for consistent retrieval post-sync"
    }
  },
  "routing_trigger_for_opus": [
    "cross-reference",
    "compare",
    "contradict",
    "provocation",
    "why would",
    "doesn't match",
    "inconsistent",
    "what's missing",
    "devil's advocate"
  ]
}
```
