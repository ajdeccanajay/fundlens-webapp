# Research Assistant Improvement - Comprehensive Plan

## Current Problems

1. **401 Unauthorized Error** - Research API requires tenant authentication but frontend isn't sending proper auth headers
2. **No Conversation Memory** - Current implementation doesn't maintain chat history or context
3. **No Session Management** - Each query is independent, no ChatGPT-style conversation
4. **Scratchpad Issues** - Saving null/empty responses, no validation
5. **No RAG Integration** - Not properly querying the knowledge base with context

## Solution Architecture

### 1. Authentication Layer

**Problem**: TenantGuard requires JWT token with tenant context

**Solution**: 
- Use existing auth token from localStorage
- Send proper Authorization header with all requests
- Handle token expiration gracefully

```typescript
// Frontend
getAuthHeaders() {
    const token = localStorage.getItem('fundlens_token') || localStorage.getItem('authToken');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}
```

### 2. Conversation Management

**Backend**: Use existing Research Assistant Service with conversations

**Flow**:
```
1. Create Conversation (once per session)
   POST /api/research/conversations
   Body: { title: "AAPL Research Session" }
   Returns: { id: "conv-123" }

2. Send Messages (with full history)
   POST /api/research/conversations/:id/messages
   Body: { 
     content: "What are the key risks?",
     context: { tickers: ["AAPL"] }
   }
   Returns: SSE stream with tokens

3. Conversation persists in database
   - All messages stored
   - Context maintained
   - Can resume later
```

### 3. ChatGPT-Style Implementation

**Features**:
- ✅ Conversation history maintained
- ✅ Context from previous messages
- ✅ Streaming responses (SSE)
- ✅ Multi-turn conversations
- ✅ Cross-company queries
- ✅ Follow-up questions work

**Frontend State**:
```javascript
{
    conversationId: null,           // Current conversation
    messages: [],                   // All messages in conversation
    isTyping: false,               // Show typing indicator
    currentTicker: 'AAPL',         // Context for queries
    conversationHistory: []         // For resuming sessions
}
```

### 4. RAG Integration with Memory

**Backend Flow**:
```
User Query → Research Assistant Service
    ↓
Conversation Context (previous messages)
    ↓
RAG Service (with context)
    ↓
    ├─ Intent Detection (quantitative vs qualitative)
    ├─ Structured Retrieval (metrics, financials)
    ├─ Semantic Search (narrative, qualitative)
    └─ Bedrock LLM (with conversation history)
    ↓
Streaming Response
```

**Key Features**:
- Previous messages sent as context
- LLM remembers conversation
- Can reference earlier answers
- Follow-up questions work naturally

### 5. Scratchpad Integration

**Validation Rules**:
```javascript
canSaveToScratchpad(message) {
    // Only save assistant messages
    if (message.role !== 'assistant') return false;
    
    // Must have content
    if (!message.content || message.content.trim().length === 0) return false;
    
    // Not error messages
    if (message.content.includes('Sorry, I encountered an error')) return false;
    if (message.content.includes('No response received')) return false;
    
    // Minimum length (avoid "N/A", "Unknown", etc.)
    if (message.content.trim().length < 20) return false;
    
    return true;
}
```

**Save Flow**:
```
1. User clicks "Save to Scratchpad"
2. Validate message content
3. Show modal for user notes
4. POST /api/research/notebooks/:id/insights
   Body: {
     messageId: message.id,
     content: message.content,
     userNotes: "My analysis...",
     tags: ["risk-analysis", "AAPL"]
   }
5. Update scratchpad count
6. Show success notification
```

## Implementation Plan

### Phase 1: Fix Authentication (CRITICAL)

**Files to Update**:
- `public/app/deals/workspace.html`
- `public/comprehensive-financial-analysis.html`

**Changes**:
```javascript
// Ensure getAuthHeaders() is called for ALL API requests
async createConversation() {
    const headers = this.getAuthHeaders();
    if (!headers) {
        window.location.href = '/login.html';
        return null;
    }
    
    const response = await fetch('/api/research/conversations', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            title: `${this.ticker} Research ${new Date().toLocaleDateString()}`
        })
    });
    
    if (response.status === 401) {
        localStorage.removeItem('fundlens_token');
        window.location.href = '/login.html';
        return null;
    }
    
    const data = await response.json();
    return data.data.id;
}
```

### Phase 2: Implement Conversation Management

**Create Conversation on First Message**:
```javascript
async sendMessage(userMessage) {
    // Create conversation if needed
    if (!this.conversationId) {
        this.conversationId = await this.createConversation();
        if (!this.conversationId) return; // Auth failed
    }
    
    // Add user message to UI
    this.messages.push({
        id: Date.now(),
        role: 'user',
        content: userMessage,
        timestamp: new Date()
    });
    
    // Send to backend with conversation context
    await this.streamResponse(userMessage);
}
```

**Stream Response with SSE**:
```javascript
async streamResponse(userMessage) {
    this.isTyping = true;
    
    const headers = this.getAuthHeaders();
    
    // Create placeholder for assistant message
    const assistantMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: '',
        sources: [],
        timestamp: new Date()
    };
    this.messages.push(assistantMessage);
    
    try {
        const response = await fetch(
            `/api/research/conversations/${this.conversationId}/messages`,
            {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    content: userMessage,
                    context: {
                        tickers: [this.currentTicker]
                    }
                })
            }
        );
        
        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.substring(6));
                    
                    if (data.text) {
                        assistantMessage.content += data.text;
                        this.scrollToBottom();
                    } else if (data.title) {
                        assistantMessage.sources.push(data);
                    } else if (data.complete) {
                        this.isTyping = false;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Streaming error:', error);
        assistantMessage.content = 'Sorry, I encountered an error. Please try again.';
        this.isTyping = false;
    }
}
```

### Phase 3: Enhanced Scratchpad with Validation

**Add Validation**:
```javascript
saveToScratchpad(message) {
    // Validate before showing modal
    if (!this.canSaveToScratchpad(message)) {
        alert('This message cannot be saved (empty or error response)');
        return;
    }
    
    this.selectedMessage = message;
    this.showSaveModal = true;
}

canSaveToScratchpad(message) {
    if (message.role !== 'assistant') return false;
    if (!message.content || message.content.trim().length < 20) return false;
    if (message.content.includes('Sorry, I encountered an error')) return false;
    if (message.content.includes('No response received')) return false;
    return true;
}

async confirmSave() {
    const headers = this.getAuthHeaders();
    
    // Ensure notebook exists
    if (!this.notebookId) {
        await this.createNotebook();
    }
    
    const response = await fetch(
        `/api/research/notebooks/${this.notebookId}/insights`,
        {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                messageId: this.selectedMessage.id,
                content: this.selectedMessage.content,
                userNotes: this.saveNotes,
                tags: [this.currentTicker, 'research']
            })
        }
    );
    
    if (response.ok) {
        await this.loadScratchpad();
        this.showSaveModal = false;
        this.saveNotes = '';
        // Show success notification
        this.showNotification('Saved to scratchpad!', 'success');
    }
}
```

### Phase 4: UI Improvements

**Show Conversation Context**:
```html
<!-- Conversation Header -->
<div class="conversation-header">
    <div class="conversation-info">
        <span class="conversation-ticker">{{ currentTicker }}</span>
        <span class="message-count">{{ messages.length }} messages</span>
    </div>
    <button @click="clearConversation()">New Conversation</button>
</div>

<!-- Messages with Metadata -->
<div class="message" :class="message.role">
    <div class="message-content" x-html="renderMarkdown(message.content)"></div>
    
    <!-- Sources -->
    <div class="message-sources" x-show="message.sources?.length > 0">
        <template x-for="source in message.sources">
            <span class="source-chip">{{ source.title }}</span>
        </template>
    </div>
    
    <!-- Actions -->
    <div class="message-actions" x-show="message.role === 'assistant'">
        <button @click="saveToScratchpad(message)" 
                :disabled="!canSaveToScratchpad(message)"
                :class="{ 'disabled': !canSaveToScratchpad(message) }">
            <i class="fas fa-bookmark"></i> Save
        </button>
        <button @click="copyToClipboard(message.content)">
            <i class="fas fa-copy"></i> Copy
        </button>
    </div>
    
    <div class="message-timestamp">{{ formatTime(message.timestamp) }}</div>
</div>
```

## Testing Plan

### Unit Tests

```javascript
describe('Research Assistant', () => {
    it('should create conversation on first message', async () => {
        const assistant = new ResearchAssistant();
        await assistant.sendMessage('What are the key risks?');
        expect(assistant.conversationId).toBeTruthy();
    });
    
    it('should reuse conversation for subsequent messages', async () => {
        const assistant = new ResearchAssistant();
        await assistant.sendMessage('First question');
        const firstConvId = assistant.conversationId;
        await assistant.sendMessage('Follow-up question');
        expect(assistant.conversationId).toBe(firstConvId);
    });
    
    it('should validate messages before saving', () => {
        const assistant = new ResearchAssistant();
        expect(assistant.canSaveToScratchpad({ role: 'user', content: 'test' })).toBe(false);
        expect(assistant.canSaveToScratchpad({ role: 'assistant', content: '' })).toBe(false);
        expect(assistant.canSaveToScratchpad({ role: 'assistant', content: 'N/A' })).toBe(false);
        expect(assistant.canSaveToScratchpad({ 
            role: 'assistant', 
            content: 'This is a valid response with enough content' 
        })).toBe(true);
    });
});
```

### E2E Tests

```javascript
describe('Research Assistant E2E', () => {
    it('should maintain conversation context', async () => {
        await page.goto('/app/deals/workspace.html?ticker=AAPL');
        
        // First message
        await page.fill('[data-testid="research-input"]', 'What is the revenue?');
        await page.click('[data-testid="send-button"]');
        await page.waitForSelector('[data-testid="assistant-message"]');
        
        // Follow-up that requires context
        await page.fill('[data-testid="research-input"]', 'How does that compare to last year?');
        await page.click('[data-testid="send-button"]');
        await page.waitForSelector('[data-testid="assistant-message"]:nth-child(4)');
        
        // Should have context from first message
        const response = await page.textContent('[data-testid="assistant-message"]:nth-child(4)');
        expect(response).toContain('revenue'); // Should reference previous context
    });
    
    it('should only allow saving valid responses', async () => {
        // ... test scratchpad validation
    });
});
```

## Success Criteria

✅ **Authentication**: No 401 errors, proper token handling
✅ **Conversation Memory**: Follow-up questions work, context maintained
✅ **ChatGPT Experience**: Streaming responses, natural conversation flow
✅ **RAG Integration**: Queries both quantitative and qualitative data
✅ **Cross-Company**: Can compare multiple tickers in same conversation
✅ **Scratchpad**: Only saves valid responses, no nulls/errors
✅ **Session Persistence**: Can resume conversations later
✅ **Error Handling**: Graceful failures, retry logic
✅ **Performance**: Responses within 3-5 seconds
✅ **UX**: Typing indicators, smooth scrolling, clear feedback

## Next Steps

1. **Immediate**: Fix authentication (Phase 1)
2. **Short-term**: Implement conversation management (Phase 2)
3. **Medium-term**: Add scratchpad validation (Phase 3)
4. **Long-term**: UI polish and advanced features (Phase 4)
