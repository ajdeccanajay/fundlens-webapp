# Admin Tools Access Guide

## Quick Reference

### Admin Tools Landing Page
**URL**: https://app.fundlens.ai/internal/

This page provides access to all internal admin and testing tools.

---

## Available Tools

### 1. Platform Admin Dashboard
**URL**: https://app.fundlens.ai/internal/platform-admin.html

**Purpose**: Main administration console for managing tenants, users, and system configuration

**Authentication**: Requires platform admin API key

**How to Access**:
1. Navigate to the URL
2. Enter your admin API key when prompted
3. Click "Authenticate"

**Features**:
- View platform statistics
- Manage client tenants
- Create new clients
- Manage users
- View system health

---

### 2. RAG Query Tool
**URL**: https://app.fundlens.ai/internal/rag-query.html

**Purpose**: Test and debug the RAG (Retrieval-Augmented Generation) system

**Authentication**: Backend APIs require admin key

**Use Cases**:
- Test RAG queries
- Debug search results
- Verify citation extraction
- Test semantic retrieval

---

### 3. SSE Chat Test
**URL**: https://app.fundlens.ai/internal/test-sse-chat.html

**Purpose**: Test Server-Sent Events (SSE) streaming for chat

**Authentication**: Backend APIs require authentication

**Use Cases**:
- Test streaming responses
- Debug SSE connection issues
- Verify real-time updates
- Test chat functionality

---

### 4. Upload Test
**URL**: https://app.fundlens.ai/internal/upload.html

**Purpose**: Test document upload functionality

**Authentication**: Backend APIs require authentication

**Use Cases**:
- Test file uploads
- Debug S3 integration
- Verify document processing
- Test different file types

---

### 5. Ticker Display Test
**URL**: https://app.fundlens.ai/internal/test-ticker-display.html

**Purpose**: Test ticker display and financial data visualization

**Authentication**: Backend APIs require authentication

**Use Cases**:
- Test ticker UI components
- Debug data visualization
- Verify financial data display
- Test responsive design

---

### 6. Chat Test
**URL**: https://app.fundlens.ai/internal/test-chat.html

**Purpose**: Test basic chat interface

**Authentication**: Backend APIs require authentication

**Use Cases**:
- Test chat UI
- Debug messaging
- Verify conversation flow
- Test error handling

---

## Authentication

### Platform Admin API Key

**Required For**: Platform Admin Dashboard and all backend API calls

**How to Get Your Key**:
1. Contact your platform administrator
2. Keys are stored securely in AWS Secrets Manager
3. Never share your key or commit it to git

**How to Use**:
- **Platform Admin Dashboard**: Enter key in the authentication prompt
- **API Calls**: Include in `x-admin-key` header

**Example API Call**:
```bash
curl -H "x-admin-key: YOUR_KEY_HERE" \
     https://app.fundlens.ai/api/admin/stats
```

### User Authentication (JWT)

**Required For**: Most test tools (RAG, Upload, Chat, etc.)

**How to Get Token**:
1. Sign in through the main app
2. Token is automatically included in requests
3. Or use the authentication API:

```bash
curl -X POST https://app.fundlens.ai/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your-password"}'
```

---

## Security Best Practices

### 1. Protect Your Admin Key
- ✅ Store in password manager
- ✅ Never share via email/Slack
- ✅ Rotate every 90 days
- ❌ Never commit to git
- ❌ Never share publicly

### 2. Access Logging
- All admin access is logged
- IP addresses are recorded
- Failed attempts are monitored
- Suspicious activity triggers alerts

### 3. Secure Connections
- Always use HTTPS
- Never access from public WiFi without VPN
- Clear browser cache after use
- Log out when finished

### 4. Incident Response
- If key compromised: Contact admin immediately
- If suspicious access: Report to security team
- If breach detected: Follow incident response plan

---

## Troubleshooting

### "Invalid admin key" Error

**Cause**: API key is incorrect or expired

**Solution**:
1. Verify you're using the correct key
2. Check for extra spaces or characters
3. Contact admin for new key if expired
4. Check CloudWatch logs for details

### "401 Unauthorized" Error

**Cause**: Not authenticated or token expired

**Solution**:
1. Sign in again to get new token
2. Check token expiration
3. Verify you're using correct credentials
4. Clear browser cache and try again

### Page Loads But Features Don't Work

**Cause**: Backend API authentication failing

**Solution**:
1. Check browser console for errors
2. Verify API key is correct
3. Check network tab for failed requests
4. Verify backend is running

### Old URLs Still Work

**Cause**: CloudFront edge cache not cleared yet

**Solution**:
1. Wait 15-30 minutes for cache to clear
2. Use new /internal/ URLs instead
3. Clear browser cache
4. Try incognito/private browsing

---

## URL Migration

### Old URLs (Deprecated - Being Phased Out)
```
❌ https://app.fundlens.ai/rag-query.html
❌ https://app.fundlens.ai/test-chat.html
❌ https://app.fundlens.ai/test-sse-chat.html
❌ https://app.fundlens.ai/test-ticker-display.html
❌ https://app.fundlens.ai/upload.html
```

**Status**: Files deleted from S3, but may still be cached at CloudFront edge locations for up to 24 hours.

### New URLs (Current)
```
✅ https://app.fundlens.ai/internal/
✅ https://app.fundlens.ai/internal/platform-admin.html
✅ https://app.fundlens.ai/internal/rag-query.html
✅ https://app.fundlens.ai/internal/test-chat.html
✅ https://app.fundlens.ai/internal/test-sse-chat.html
✅ https://app.fundlens.ai/internal/test-ticker-display.html
✅ https://app.fundlens.ai/internal/upload.html
```

**Action Required**: Update any bookmarks or documentation to use new URLs.

---

## Monitoring & Logs

### CloudWatch Logs

**Backend Logs**:
- Log Group: `/ecs/fundlens-production`
- Filter: `[Security]` or `Admin access`
- View: https://console.aws.amazon.com/cloudwatch/

**What to Monitor**:
- Failed authentication attempts
- Unusual access patterns
- API errors
- Performance issues

### CloudFront Access Logs

**Location**: S3 bucket `fundlens-production-alb-logs`

**What's Logged**:
- All requests to /internal/ URLs
- IP addresses
- User agents
- Response codes
- Timestamps

**How to Access**:
```bash
aws s3 ls s3://fundlens-production-alb-logs/
aws s3 cp s3://fundlens-production-alb-logs/latest.log -
```

---

## Support

### Need Help?

**For Technical Issues**:
- Check CloudWatch logs
- Review error messages in browser console
- Contact development team

**For Access Issues**:
- Verify your admin key is correct
- Check if key has expired
- Contact platform administrator

**For Security Concerns**:
- Report immediately to security team
- Do not attempt to troubleshoot yourself
- Follow incident response procedures

---

## Change Log

### January 28, 2026
- ✅ Moved all test pages to /internal/ directory
- ✅ Created admin tools landing page
- ✅ Implemented multi-layer security
- ✅ Deployed to production
- ✅ Created documentation

---

**Last Updated**: January 28, 2026  
**Version**: 1.0  
**Status**: Active  
**Maintained By**: Platform Engineering Team

