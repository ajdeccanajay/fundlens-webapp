# Task 3.3: Error Handling & Edge Cases - Implementation Plan

**Date:** February 2, 2026  
**Task:** Phase 3, Task 3.3 - Error Handling & Edge Cases  
**Priority:** HIGH  
**Estimated Time:** 1.5 days

---

## Overview

Implement comprehensive error handling and edge case management for the Insights Tab to ensure a robust, production-ready user experience. This includes graceful degradation, helpful error messages, retry logic, and handling of all edge cases.

---

## Current State Analysis

### Existing Error Handling
- ✅ Basic try-catch blocks in services
- ✅ HTTP error responses (401, 404, 500)
- ✅ Loading states in frontend
- ⚠️ Limited error messages
- ⚠️ No retry logic
- ⚠️ Some edge cases not handled

### Gaps to Address
1. **Error Boundaries:** Sections can crash the entire page
2. **Error Messages:** Generic "Failed to load" messages
3. **Retry Logic:** No automatic retry for transient failures
4. **Edge Cases:** Missing data, single period, empty results
5. **Network Errors:** No offline detection or handling
6. **Validation:** Limited input validation

---

## Implementation Strategy

### 1. Backend Error Handling

#### A. Service-Level Error Handling

**Pattern: Try-Catch with Specific Error Types**

```typescript
// src/deals/anomaly-detection.service.ts

async detectAnomalies(dealId: string, types?: AnomalyType[]): Promise<Anomaly[]> {
  try {
    // Validate inputs
    if (!dealId) {
      throw new BadRequestException('Deal ID is required');
    }
    
    // Get deal
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
    });
    
    if (!deal) {
      throw new NotFoundException(`Deal ${dealId} not found`);
    }
    
    if (!deal.ticker) {
      throw new BadRequestException('Deal must have a ticker');
    }
    
    // Detect anomalies
    const anomalies = await this.performDetection(deal.ticker, types);
    
    // Handle empty results
    if (anomalies.length === 0) {
      this.logger.log(`No anomalies detected for ${deal.ticker}`);
      return [];
    }
    
    return anomalies;
    
  } catch (error) {
    // Log error with context
    this.logger.error(
      `Error detecting anomalies for deal ${dealId}:`,
      error.stack,
    );
    
    // Re-throw known errors
    if (error instanceof HttpException) {
      throw error;
    }
    
    // Wrap unknown errors
    throw new InternalServerErrorException(
      'Failed to detect anomalies. Please try again later.',
    );
  }
}
```

#### B. Controller-Level Error Handling

**Pattern: Global Exception Filter**

```typescript
// src/common/filters/http-exception.filter.ts

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        details = (exceptionResponse as any).details;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.stack);
    }

    // Log error
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
    );

    // Send response
    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

#### C. Database Error Handling

**Pattern: Prisma Error Handling**

```typescript
// src/common/utils/prisma-error-handler.ts

export function handlePrismaError(error: any): never {
  if (error.code === 'P2002') {
    throw new ConflictException('Record already exists');
  }
  
  if (error.code === 'P2025') {
    throw new NotFoundException('Record not found');
  }
  
  if (error.code === 'P2003') {
    throw new BadRequestException('Foreign key constraint failed');
  }
  
  // Generic database error
  throw new InternalServerErrorException('Database operation failed');
}
```

### 2. Frontend Error Handling

#### A. Error Boundaries for Sections

**Pattern: Section-Level Error Handling**

```javascript
// Add to dealWorkspace() function

// Error handling state
errors: {
  anomalies: null,
  compTable: null,
  changeTracker: null,
  hierarchy: null,
  global: null,
},

// Error handling methods
handleError(section, error) {
  console.error(`Error in ${section}:`, error);
  
  // Set section-specific error
  this.errors[section] = this.getErrorMessage(error);
  
  // Clear loading state
  if (this.loading[section] !== undefined) {
    this.loading[section] = false;
  }
  
  // Show toast notification
  this.showErrorToast(section, error);
},

getErrorMessage(error) {
  // Network errors
  if (!navigator.onLine) {
    return 'No internet connection. Please check your network.';
  }
  
  // HTTP errors
  if (error.status === 401) {
    return 'Session expired. Please log in again.';
  }
  
  if (error.status === 403) {
    return 'You don\'t have permission to access this data.';
  }
  
  if (error.status === 404) {
    return 'Data not found. Please try a different selection.';
  }
  
  if (error.status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  
  if (error.status >= 500) {
    return 'Server error. Our team has been notified. Please try again later.';
  }
  
  // Generic error
  return error.message || 'Something went wrong. Please try again.';
},

showErrorToast(section, error) {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = `${section}: ${this.getErrorMessage(error)}`;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 5000);
},

clearError(section) {
  this.errors[section] = null;
},
```

#### B. Retry Logic

**Pattern: Exponential Backoff**

```javascript
async fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        return response;
      }
      
      // Retry on server errors (5xx)
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }
      
      return response;
      
    } catch (error) {
      lastError = error;
      
      // Don't retry on last attempt
      if (attempt === maxRetries - 1) {
        break;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
},
```

#### C. Edge Case Handling

**Pattern: Defensive Programming**

```javascript
async loadAnomalies() {
  this.loading.anomalies = true;
  this.errors.anomalies = null;
  
  try {
    const headers = this.getAuthHeaders();
    if (!headers) {
      throw new Error('Not authenticated');
    }
    
    const dealId = localStorage.getItem(`dealId_${this.dealInfo.ticker}`);
    if (!dealId) {
      throw new Error('Deal not found');
    }
    
    const response = await this.fetchWithRetry(
      `/api/deals/${dealId}/insights/anomalies`,
      { headers }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // Handle empty results
    if (!data.data || data.data.anomalies.length === 0) {
      this.anomaliesData = {
        anomalies: [],
        summary: { total: 0, byType: {}, bySeverity: {} }
      };
      this.logger.log('No anomalies found');
      return;
    }
    
    this.anomaliesData = data.data;
    
  } catch (error) {
    this.handleError('anomalies', error);
  } finally {
    this.loading.anomalies = false;
  }
},
```

### 3. Edge Cases to Handle

#### A. Missing Data

**Scenarios:**
1. No financial metrics for ticker
2. No narrative chunks for period
3. No deals found
4. Empty comp table results
5. No changes detected

**Handling:**
```javascript
// Show empty state with helpful message
<div x-show="!loading.anomalies && (!anomaliesData || anomaliesData.anomalies.length === 0)">
  <div class="empty-state">
    <i class="fas fa-chart-line text-gray-400 text-6xl mb-4"></i>
    <h3 class="text-xl font-semibold mb-2">No Anomalies Detected</h3>
    <p class="text-gray-600 mb-4">
      We didn't find any unusual patterns in the data for this period.
      This could mean the company's metrics are stable and consistent.
    </p>
    <button @click="loadAnomalies()" class="btn-primary">
      <i class="fas fa-sync mr-2"></i>
      Refresh
    </button>
  </div>
</div>
```

#### B. Single Period

**Scenario:** User selects only one period (can't calculate YoY)

**Handling:**
```javascript
// Disable YoY features, show message
if (selectedPeriods.length < 2) {
  return {
    message: 'Select at least 2 periods to see year-over-year changes',
    showYoY: false,
  };
}
```

#### C. Network Offline

**Scenario:** User loses internet connection

**Handling:**
```javascript
// Detect offline status
window.addEventListener('offline', () => {
  this.errors.global = 'You are offline. Some features may not work.';
});

window.addEventListener('online', () => {
  this.errors.global = null;
  // Retry failed requests
  this.retryFailedRequests();
});
```

#### D. Invalid Input

**Scenario:** User enters invalid data

**Handling:**
```javascript
// Validate before API call
validateCompTableInput() {
  if (this.compTable.selectedCompanies.length === 0) {
    this.compTable.error = 'Please select at least one company';
    return false;
  }
  
  if (this.compTable.selectedMetrics.length === 0) {
    this.compTable.error = 'Please select at least one metric';
    return false;
  }
  
  if (this.compTable.selectedCompanies.length > 10) {
    this.compTable.error = 'Maximum 10 companies allowed';
    return false;
  }
  
  return true;
},
```

### 4. Error UI Components

#### A. Error Toast

```html
<!-- Error Toast -->
<div x-show="errors.global" 
     x-transition
     class="error-toast">
  <div class="flex items-center">
    <i class="fas fa-exclamation-circle text-red-500 mr-3"></i>
    <span x-text="errors.global"></span>
    <button @click="errors.global = null" class="ml-auto">
      <i class="fas fa-times"></i>
    </button>
  </div>
</div>
```

#### B. Section Error State

```html
<!-- Section Error -->
<div x-show="errors.anomalies" class="error-state">
  <div class="error-icon">
    <i class="fas fa-exclamation-triangle"></i>
  </div>
  <h3>Failed to Load Anomalies</h3>
  <p x-text="errors.anomalies"></p>
  <div class="error-actions">
    <button @click="loadAnomalies()" class="btn-primary">
      <i class="fas fa-sync mr-2"></i>
      Try Again
    </button>
    <button @click="clearError('anomalies')" class="btn-secondary">
      Dismiss
    </button>
  </div>
</div>
```

#### C. Empty State

```html
<!-- Empty State -->
<div x-show="!loading.compTable && compTable.data && compTable.data.rows.length === 0" 
     class="empty-state">
  <i class="fas fa-table text-gray-400 text-6xl mb-4"></i>
  <h3 class="text-xl font-semibold mb-2">No Data Available</h3>
  <p class="text-gray-600 mb-4">
    We couldn't find data for the selected companies and metrics.
    Try selecting different options.
  </p>
</div>
```

---

## Implementation Checklist

### Backend
- [ ] Add global exception filter
- [ ] Add Prisma error handler
- [ ] Add input validation to all endpoints
- [ ] Add specific error messages
- [ ] Add error logging with context
- [ ] Handle edge cases in services
- [ ] Add retry logic for external APIs

### Frontend
- [ ] Add error state to Alpine.js data
- [ ] Add error handling methods
- [ ] Add retry logic with exponential backoff
- [ ] Add offline detection
- [ ] Add input validation
- [ ] Add error toast component
- [ ] Add section error states
- [ ] Add empty states
- [ ] Add loading states

### Testing
- [ ] Write error scenario tests (backend)
- [ ] Write edge case tests (backend)
- [ ] Write error UI tests (frontend)
- [ ] Write offline tests (frontend)
- [ ] Write validation tests
- [ ] Test retry logic
- [ ] Test error recovery

---

## Testing Strategy

### Error Scenarios to Test

1. **Network Errors**
   - Offline
   - Timeout
   - Connection refused

2. **HTTP Errors**
   - 401 Unauthorized
   - 403 Forbidden
   - 404 Not Found
   - 429 Too Many Requests
   - 500 Internal Server Error
   - 503 Service Unavailable

3. **Data Errors**
   - Empty results
   - Missing required fields
   - Invalid data types
   - Null values

4. **Edge Cases**
   - Single period selected
   - No companies selected
   - Too many companies selected
   - Invalid ticker
   - Missing deal

5. **Validation Errors**
   - Invalid input
   - Out of range values
   - Malformed requests

---

## Acceptance Criteria

- [ ] Errors don't crash the page
- [ ] Error messages are user-friendly
- [ ] Retry logic works for transient failures
- [ ] Edge cases handled gracefully
- [ ] Empty states show helpful messages
- [ ] Offline detection works
- [ ] Input validation prevents bad requests
- [ ] All error scenarios tested
- [ ] Error logging captures context
- [ ] Users can recover from errors

---

## Files to Create/Modify

### Backend
- `src/common/filters/http-exception.filter.ts` (NEW)
- `src/common/utils/prisma-error-handler.ts` (NEW)
- `src/deals/anomaly-detection.service.ts` (enhance)
- `src/deals/comp-table.service.ts` (enhance)
- `src/deals/change-tracker.service.ts` (enhance)
- `src/deals/insights.controller.ts` (enhance)

### Frontend
- `public/app/deals/workspace.html` (enhance)
- `public/css/workspace-enhancements.css` (add error styles)

### Tests
- `test/e2e/insights-tab-errors.e2e-spec.ts` (NEW)
- `test/unit/error-handling.spec.ts` (NEW)

---

## Timeline

**Day 1 (4-5 hours):**
- Morning: Backend error handling
- Afternoon: Frontend error handling

**Day 2 (3-4 hours):**
- Morning: Edge case handling
- Afternoon: Testing and documentation

---

**Status:** Ready to implement  
**Next Step:** Create global exception filter
