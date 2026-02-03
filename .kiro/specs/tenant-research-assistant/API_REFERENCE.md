# Research Assistant API Reference

**Version**: 1.0
**Base URL**: `/api/research`
**Authentication**: Required (Bearer token)
**Authorization**: TenantGuard (all endpoints)

---

## Endpoints

### 1. Create Conversation

Create a new research conversation.

**Endpoint**: `POST /api/research/conversations`

**Request Body**:
```json
{
  "title": "Apple vs Microsoft Analysis" // optional, auto-generated if not provided
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "tenantId": "tenant-uuid",
    "userId": "user-uuid",
    "title": "Apple vs Microsoft Analysis",
    "createdAt": "2026-01-26T15:30:00.000Z",
    "updatedAt": "2026-01-26T15:30:00.000Z",
    "lastMessageAt": null,
    "isPinned": false,
    "isArchived": false,
    "messageCount": 0
  }
}
```

---

### 2. List Conversations

Get all conversations for the current user.

**Endpoint**: `GET /api/research/conversations`

**Query Parameters**:
- `archived` (boolean, optional): Filter by archived status
- `pinned` (boolean, optional): Filter by pinned status
- `limit` (number, optional): Max results (default: 50)
- `offset` (number, optional): Pagination offset (default: 0)

**Example**: `GET /api/research/conversations?limit=20&offset=0&archived=false`

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "conv-uuid-1",
      "title": "Apple Analysis",
      "createdAt": "2026-01-26T15:30:00.000Z",
      "updatedAt": "2026-01-26T16:45:00.000Z",
      "lastMessageAt": "2026-01-26T16:45:00.000Z",
      "isPinned": true,
      "isArchived": false,
      "messageCount": 12
    },
    {
      "id": "conv-uuid-2",
      "title": "Tech Sector Comparison",
      "createdAt": "2026-01-25T10:00:00.000Z",
      "updatedAt": "2026-01-25T11:30:00.000Z",
      "lastMessageAt": "2026-01-25T11:30:00.000Z",
      "isPinned": false,
      "isArchived": false,
      "messageCount": 8
    }
  ],
  "pagination": {
    "total": 45,
    "hasMore": true,
    "limit": 20,
    "offset": 0
  }
}
```

---

### 3. Get Conversation

Get a specific conversation with all messages.

**Endpoint**: `GET /api/research/conversations/:id`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "conversation": {
      "id": "conv-uuid",
      "title": "Apple Analysis",
      "createdAt": "2026-01-26T15:30:00.000Z",
      "updatedAt": "2026-01-26T16:45:00.000Z",
      "lastMessageAt": "2026-01-26T16:45:00.000Z",
      "isPinned": false,
      "isArchived": false,
      "messageCount": 3
    },
    "messages": [
      {
        "id": "msg-uuid-1",
        "conversationId": "conv-uuid",
        "role": "user",
        "content": "What is AAPL revenue?",
        "sources": [],
        "metadata": {},
        "tokensUsed": 0,
        "createdAt": "2026-01-26T15:31:00.000Z"
      },
      {
        "id": "msg-uuid-2",
        "conversationId": "conv-uuid",
        "role": "assistant",
        "content": "Apple's revenue for Q4 2024 was $383.3 billion...",
        "sources": [
          {
            "title": "AAPL 10-K FY2024",
            "type": "narrative",
            "metadata": {
              "ticker": "AAPL",
              "filingType": "10-K",
              "fiscalPeriod": "FY2024"
            }
          }
        ],
        "metadata": {
          "tickers": ["AAPL"],
          "queryType": "general"
        },
        "tokensUsed": 150,
        "createdAt": "2026-01-26T15:31:05.000Z"
      }
    ]
  }
}
```

**Error Response** (404 Not Found):
```json
{
  "statusCode": 404,
  "message": "Conversation not found"
}
```

---

### 4. Update Conversation

Update conversation properties.

**Endpoint**: `PATCH /api/research/conversations/:id`

**Request Body** (all fields optional):
```json
{
  "title": "Updated Title",
  "isPinned": true,
  "isArchived": false
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "conv-uuid",
    "title": "Updated Title",
    "isPinned": true,
    "isArchived": false,
    "updatedAt": "2026-01-26T17:00:00.000Z",
    ...
  }
}
```

---

### 5. Delete Conversation

Delete a conversation and all its messages.

**Endpoint**: `DELETE /api/research/conversations/:id`

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Conversation deleted successfully"
}
```

**Error Response** (404 Not Found):
```json
{
  "statusCode": 404,
  "message": "Conversation not found"
}
```

---

### 6. Send Message (Streaming)

Send a message and receive streaming AI response.

**Endpoint**: `POST /api/research/conversations/:id/messages`

**Content-Type**: `application/json`

**Request Body**:
```json
{
  "content": "Compare AAPL and MSFT revenue growth over the last 3 years",
  "context": {
    "tickers": ["AAPL", "MSFT"],
    "fiscalPeriod": "FY2024"
  }
}
```

**Response**: Server-Sent Events (SSE) stream

**Event Types**:

1. **source** - Source citation
```
event: source
data: {"title":"AAPL 10-K FY2024","type":"narrative","metadata":{"ticker":"AAPL","filingType":"10-K"}}
```

2. **token** - Text token from AI
```
event: token
data: {"text":"Apple's "}

event: token
data: {"text":"revenue "}

event: token
data: {"text":"grew "}
```

3. **done** - Stream complete
```
event: done
data: {"complete":true}
```

4. **error** - Error occurred
```
event: error
data: {"message":"Conversation not found"}
```

**Client Example** (JavaScript):
```javascript
const eventSource = new EventSource(
  '/api/research/conversations/conv-uuid/messages',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

eventSource.addEventListener('token', (event) => {
  const data = JSON.parse(event.data);
  appendText(data.text);
});

eventSource.addEventListener('source', (event) => {
  const data = JSON.parse(event.data);
  addSource(data);
});

eventSource.addEventListener('done', (event) => {
  eventSource.close();
  markComplete();
});

eventSource.addEventListener('error', (event) => {
  const data = JSON.parse(event.data);
  showError(data.message);
  eventSource.close();
});
```

---

### 7. Search Conversations

Search conversations by content (placeholder - not yet implemented).

**Endpoint**: `GET /api/research/conversations/search`

**Query Parameters**:
- `q` (string, required): Search query
- `limit` (number, optional): Max results
- `offset` (number, optional): Pagination offset

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "results": [],
    "total": 0
  }
}
```

---

## Authentication

All endpoints require authentication via Bearer token:

```
Authorization: Bearer <your-jwt-token>
```

The token must include:
- `tenantId` - Current tenant UUID
- `userId` - Current user UUID
- `userRole` - User role (analyst, admin, etc.)

---

## Authorization

All endpoints are protected by `TenantGuard`:
- Automatically filters data by `tenant_id`
- Ensures users only access their own tenant's data
- Returns 404 (not 403) for unauthorized access to prevent information leakage

---

## Error Responses

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Invalid request parameters",
  "error": "Bad Request"
}
```

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Conversation not found",
  "error": "Not Found"
}
```

### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

---

## Rate Limiting

Rate limits are enforced per tenant:
- **Conversation Creation**: 100 per hour
- **Message Sending**: 100 per hour
- **List/Get Operations**: 1000 per hour

Exceeding limits returns:
```json
{
  "statusCode": 429,
  "message": "Too many requests",
  "error": "Too Many Requests"
}
```

---

## Best Practices

### 1. Conversation Management
- Create separate conversations for different research topics
- Use descriptive titles for easy navigation
- Pin important conversations
- Archive completed research

### 2. Message Context
- Provide tickers in context for better results
- Specify fiscal periods when relevant
- Use clear, specific questions

### 3. Streaming
- Always handle all event types (token, source, done, error)
- Close EventSource on done/error
- Implement reconnection logic for network failures

### 4. Error Handling
- Check for 404 errors (conversation may have been deleted)
- Handle 429 rate limit errors with exponential backoff
- Display user-friendly error messages

### 5. Performance
- Use pagination for conversation lists
- Implement virtual scrolling for long message lists
- Cache conversation metadata locally

---

## Examples

### Complete Workflow

```javascript
// 1. Create conversation
const createResponse = await fetch('/api/research/conversations', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: 'Tech Sector Analysis'
  })
});
const { data: conversation } = await createResponse.json();

// 2. Send message with streaming
const eventSource = new EventSource(
  `/api/research/conversations/${conversation.id}/messages`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: 'Compare AAPL, MSFT, and GOOGL revenue',
      context: {
        tickers: ['AAPL', 'MSFT', 'GOOGL']
      }
    })
  }
);

let fullResponse = '';

eventSource.addEventListener('token', (event) => {
  const { text } = JSON.parse(event.data);
  fullResponse += text;
  updateUI(fullResponse);
});

eventSource.addEventListener('done', () => {
  eventSource.close();
  console.log('Response complete:', fullResponse);
});

// 3. Pin conversation
await fetch(`/api/research/conversations/${conversation.id}`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    isPinned: true
  })
});

// 4. List all conversations
const listResponse = await fetch('/api/research/conversations?limit=20', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { data: conversations } = await listResponse.json();
```

---

## Changelog

### Version 1.0 (January 26, 2026)
- Initial release
- Conversation CRUD operations
- Streaming message support
- Tenant isolation
- User isolation
- Source citations

---

## Support

For issues or questions:
- Check the test files for usage examples
- Review the service implementation for detailed behavior
- Contact the development team

---

**Last Updated**: January 26, 2026
**API Version**: 1.0
**Status**: Production Ready
