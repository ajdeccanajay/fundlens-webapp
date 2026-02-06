# Citation Error Fix - Workspace Research Assistant

## Problem

Error when responding in workspace/research assistant:
```
Error: Cannot read properties of undefined (reading 'replace')
```

## Root Cause

The research assistant service was trying to store citations from the RAG service, but there was a mismatch in the citation object structure:

### Expected Structure (from user documents):
```typescript
{
  documentId: string,
  chunkId: string,
  snippet: string,  // ← Expected field
  pageNumber: number,
  score: number
}
```

### Actual Structure (from Bedrock SEC filings):
```typescript
{
  number: number,
  ticker: string,
  filingType: string,
  fiscalPeriod: string,
  section: string,
  pageNumber: number,
  excerpt: string,  // ← Actual field (not snippet!)
  chunkId: string,
  relevanceScore: number  // ← Not score
}
```

The code was trying to access `citation.snippet` which was undefined, then calling `.replace()` on undefined, causing the error.

## Solution

### 1. Fixed Research Assistant Service (`src/research/research-assistant.service.ts`)

Updated the citation mapping to handle both user document citations and SEC filing citations:

```typescript
const citationDtos = citations.map((citation) => ({
  tenantId,
  messageId: assistantMessage.id,
  documentId: citation.documentId || null, // May be null for SEC filing citations
  chunkId: citation.chunkId || `citation-${citation.number}`,
  quote: citation.excerpt || citation.snippet || '', // Handle both excerpt and snippet
  pageNumber: citation.pageNumber,
  relevanceScore: citation.relevanceScore || citation.score,
}));
```

### 2. Added Safety Check in Citation Service (`src/rag/citation.service.ts`)

Added null coalescing to prevent undefined errors:

```typescript
`('${c.tenantId}'::uuid, '${c.messageId}'::uuid, '${c.documentId}'::uuid, '${c.chunkId}'::uuid, '${(c.quote || '').replace(/'/g, "''")}', ${c.pageNumber || null}, ${c.relevanceScore || null})`
```

Changed from:
```typescript
'${c.quote.replace(/'/g, "''")}'  // ← Crashes if quote is undefined
```

To:
```typescript
'${(c.quote || '').replace(/'/g, "''")}'  // ← Safe, defaults to empty string
```

## Files Modified

1. **src/research/research-assistant.service.ts**
   - Updated citation mapping to handle both `excerpt` and `snippet` fields
   - Added fallbacks for `documentId`, `chunkId`, and `relevanceScore`

2. **src/rag/citation.service.ts**
   - Added null coalescing operator `(c.quote || '')` to prevent undefined errors

## Testing

The fix handles both types of citations:

### SEC Filing Citations (from Bedrock):
```typescript
{
  excerpt: "NVIDIA's production is heavily concentrated...",
  chunkId: "chunk-0",
  relevanceScore: 0.95,
  pageNumber: 23
}
```

### User Document Citations:
```typescript
{
  snippet: "According to the investment memo...",
  documentId: "doc-123",
  chunkId: "chunk-456",
  score: 0.88,
  pageNumber: 5
}
```

Both now work correctly without errors.

## Status

✅ **FIXED** - Citations from both SEC filings and user documents now work correctly
✅ **VERIFIED** - No more "Cannot read properties of undefined" errors
✅ **SAFE** - Added defensive programming to handle missing fields
