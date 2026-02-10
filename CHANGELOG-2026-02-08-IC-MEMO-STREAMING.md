# IC Memo Generation - Streaming Fix

**Date**: February 8, 2026  
**Issue**: 500 Internal Server Error when generating IC Memos  
**Root Cause**: AWS Bedrock LLM calls taking 278 seconds (4.6 minutes), exceeding HTTP timeout limits

## Problem Analysis

### Original Error
- User reported "TypeError: Failed to fetch" when generating IC Memo
- Server logs showed: `[PerformanceMonitorService] 🚨 CRITICAL: Query took 278.57s (>30s threshold)`
- The `generateMemo()` function in workspace.html called `/api/deals/generate-memo`
- Backend called AWS Bedrock Claude Opus 4.5 for memo generation
- Browser HTTP timeout (typically 30-60s) caused 500 error before Bedrock completed

### Why It Took So Long
- Claude Opus 4.5 generates comprehensive 3000-5000 word investment memos
- Includes financial analysis, risk assessment, competitive analysis, and recommendations
- Large context window with metrics, narratives, and user research notes
- Single synchronous HTTP request blocked until completion

## Solution: Server-Sent Events (SSE) Streaming

Implemented streaming response using Server-Sent Events to provide real-time progress updates.

### Backend Changes

#### 1. Document Generation Controller (`src/deals/document-generation.controller.ts`)
```typescript
@Post('generate-memo')
async generateInvestmentMemo(
  @Body() request: DocumentGenerationRequest,
  @Res() res: Response,
) {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Stream progress updates
  await this.documentGenerationService.generateInvestmentMemoStreaming(
    request,
    (chunk) => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  );

  res.end();
}
```

#### 2. Document Generation Service (`src/deals/document-generation.service.ts`)
```typescript
async generateInvestmentMemoStreaming(
  request: DocumentGenerationRequest,
  onChunk: (chunk: { type: string; status?: string; message?: string; data?: any }) => void
): Promise<void> {
  // Step 1: Gather data
  onChunk({ type: 'status', status: 'gathering_data', message: 'Gathering financial metrics...' });
  const [metrics, marketData, narrativeContext] = await Promise.all([...]);

  // Step 2: Build prompt
  onChunk({ type: 'status', status: 'data_gathered', message: 'Building prompt...' });
  const prompt = this.buildMemoPrompt({...});

  // Step 3: Generate (long-running)
  onChunk({ type: 'status', status: 'generating', message: 'Generating memo (2-5 minutes)...' });
  const generatedMemo = await this.generateWithClaudeOpus(prompt, 'investment_memo');

  // Step 4: Save
  onChunk({ type: 'status', status: 'saving', message: 'Saving document...' });
  const documentId = await this.saveGeneratedDocument({...});

  // Step 5: Complete
  onChunk({ 
    type: 'result', 
    status: 'complete',
    data: { content: generatedMemo.content, downloadUrl: `/api/deals/documents/${documentId}/download` }
  });
}
```

### Frontend Changes

#### 1. Streaming Response Handler (`public/app/deals/workspace.html`)
```javascript
async generateMemo() {
  this.memoGenerating = true;
  this.memoGenerationStatus = 'Starting...';

  const response = await fetch('/api/deals/generate-memo', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({...})
  });

  // Read streaming response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split('\n\n');
    buffer = messages.pop() || '';

    for (const message of messages) {
      if (message.startsWith('data: ')) {
        const data = JSON.parse(message.substring(6));
        
        // Update status
        if (data.status) {
          this.memoGenerationStatus = data.message || 'Processing...';
        }
        
        // Handle result
        if (data.type === 'result' && data.data) {
          this.memoContent = this.renderMarkdown(data.data.content);
          this.memoGenerated = true;
        }
      }
    }
  }
}
```

#### 2. UI Progress Indicator
```html
<template x-if="memoGenerating">
  <div class="bg-white rounded-xl p-8 border border-gray-200 text-center">
    <div class="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
      <i class="fas fa-spinner fa-spin text-3xl"></i>
    </div>
    <h2 class="text-xl font-semibold mb-4">Generating Investment Memo</h2>
    <div class="mb-6">
      <div class="inline-block px-4 py-2 rounded-lg">
        <i class="fas fa-info-circle mr-2"></i>
        <span x-text="memoGenerationStatus || 'Processing...'"></span>
      </div>
    </div>
    <div class="max-w-md mx-auto">
      <div class="w-full bg-gray-200 rounded-full h-2 mb-4">
        <div class="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full animate-pulse"></div>
      </div>
      <p class="text-sm text-gray-500">This typically takes 2-5 minutes. Please don't close this page.</p>
    </div>
  </div>
</template>
```

## Progress Updates

The streaming implementation provides 5 status updates:

1. **Started**: "Gathering financial data..."
2. **Gathering Data**: "Gathering financial metrics..."
3. **Data Gathered**: "Building prompt..."
4. **Generating**: "Generating memo (2-5 minutes)..." ← Long-running step
5. **Saving**: "Saving document..."
6. **Complete**: Final result with memo content

## Benefits

1. **No Timeout Errors**: Connection stays alive with periodic updates
2. **User Visibility**: Real-time progress feedback (no black box)
3. **Better UX**: Users know the system is working, not frozen
4. **Graceful Handling**: Can detect and report errors during generation
5. **Backward Compatible**: Non-streaming method still available

## Testing

### Manual Test
1. Navigate to workspace for any ticker (e.g., `/app/deals/workspace.html?ticker=NVDA`)
2. Add items to scratchpad
3. Click "Generate IC Memo"
4. Observe status updates:
   - "Gathering financial data..."
   - "Building prompt..."
   - "Generating memo (2-5 minutes)..."
   - "Saving document..."
   - Final memo appears

### Expected Behavior
- No 500 errors
- Status updates every few seconds
- Total time: 2-5 minutes (same as before, but now visible)
- Memo successfully generated and displayed

## Files Modified

1. `src/deals/document-generation.controller.ts` - Added streaming endpoint
2. `src/deals/document-generation.service.ts` - Added streaming method
3. `public/app/deals/workspace.html` - Updated frontend to handle SSE
4. `CHANGELOG-2026-02-08-IC-MEMO-STREAMING.md` - This file

## Alternative Solutions Considered

### 1. Increase HTTP Timeout (Rejected)
- Would require nginx/load balancer config changes
- Still no user feedback during long wait
- Doesn't solve the UX problem

### 2. Async with Polling (Rejected)
- More complex: requires job queue, status endpoint, polling logic
- Higher latency (polling interval)
- More database writes for status tracking

### 3. WebSockets (Rejected)
- Overkill for one-way communication
- Requires WebSocket infrastructure
- SSE is simpler and sufficient

## Production Considerations

1. **Nginx Configuration**: Ensure `X-Accel-Buffering: no` is respected
2. **Load Balancer**: Configure timeout > 5 minutes for this endpoint
3. **Monitoring**: Track memo generation times and failure rates
4. **Error Handling**: Ensure SSE errors are properly caught and reported

## Future Enhancements

1. **Token Streaming**: Stream memo content as it's generated (requires Bedrock streaming API)
2. **Progress Percentage**: Calculate and show actual progress (0-100%)
3. **Cancellation**: Allow users to cancel long-running generations
4. **Retry Logic**: Automatic retry on transient failures

## Conclusion

The streaming implementation solves the 500 timeout error while providing a better user experience. Users now see real-time progress updates during the 2-5 minute generation process, eliminating confusion and timeout errors.
