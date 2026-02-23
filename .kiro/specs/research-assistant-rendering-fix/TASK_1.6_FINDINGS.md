# Task 1.6 Findings: Scratchpad Endpoint 500 Error Bug Condition

## Test Execution Summary

**Test File**: `test/properties/scratchpad-endpoint-500-bugfix.property.spec.ts`

**Execution Date**: Task 1.6 completed

**Test Status**: ✅ **FAILED AS EXPECTED** (confirms bug exists)

## Counterexamples Found

The bug condition exploration test successfully surfaced the following counterexamples that demonstrate the bug exists in the unfixed code:

### Counterexample 1: Database Connection Errors Return HTTP 500

**Test**: `Property 1: Endpoint handles database errors gracefully without 500 error`

**Ticker**: "AAPL"

**Expected Behavior**: GET `/api/research/scratchpad/{ticker}` should handle database errors gracefully and NOT return HTTP 500

**Actual Behavior on Unfixed Code**:
```
Expected: not 500
Received: 500 (INTERNAL_SERVER_ERROR)
```

**Error Log**:
```
[ExceptionsHandler] Error: Database connection failed
```

**Root Cause**: The `ScratchpadItemService.getItems()` method does NOT have try/catch error handling. When Prisma throws a database connection error, the exception propagates unhandled to NestJS's global exception handler, which returns HTTP 500.

### Counterexample 2: Prisma Query Errors Return HTTP 500

**Test**: `Property 2: Endpoint handles Prisma query errors without 500 error`

**Ticker**: "A"

**Expected Behavior**: GET `/api/research/scratchpad/{ticker}` should handle Prisma query errors gracefully and NOT return HTTP 500

**Actual Behavior on Unfixed Code**:
```
Expected: not 500
Received: 500 (INTERNAL_SERVER_ERROR)
```

**Error Log**:
```
[ExceptionsHandler] Error: Invalid query: column does not exist
```

**Root Cause**: The service lacks error handling for Prisma-specific errors (invalid queries, constraint violations, etc.). These exceptions are not caught and result in HTTP 500 responses.

### Counterexample 3: Query Timeout Errors Return HTTP 500

**Test**: `Property 3: Endpoint handles timeout errors gracefully without 500 error`

**Ticker**: "AAPL"

**Expected Behavior**: GET `/api/research/scratchpad/{ticker}` should handle query timeout errors gracefully and NOT return HTTP 500

**Actual Behavior on Unfixed Code**:
```
Expected: not 500
Received: 500 (INTERNAL_SERVER_ERROR)
```

**Error Log**:
```
[ExceptionsHandler] Error: Query timeout exceeded
```

**Root Cause**: The service does not handle timeout errors. When database queries exceed timeout limits, unhandled exceptions result in HTTP 500 responses.

## Tests That Passed (Expected Behavior)

### Test: Valid Data Returns Proper Response Structure

**Status**: ✅ PASSED

**Behavior**: When valid scratchpad data exists, the endpoint returns HTTP 200 with proper response structure: `{ items: [], totalCount: number }`

### Test: Missing Data Returns Empty Array

**Status**: ✅ PASSED

**Behavior**: When no scratchpad data exists for a ticker, the endpoint returns HTTP 200 with empty items array and totalCount of 0

## Bug Confirmation

✅ **BUG CONFIRMED**: The `ScratchpadItemService.getItems()` method lacks error handling, causing unhandled exceptions to propagate as HTTP 500 errors.

### Evidence

1. **Service Analysis**: Inspection of `src/deals/scratchpad-item.service.ts` shows the `getItems()` method (lines 24-41) has NO try/catch error handling:

```typescript
async getItems(workspaceId: string): Promise<ScratchpadItem[]> {
  const items = await this.prisma.scratchpadItem.findMany({
    where: { workspaceId },
    orderBy: { savedAt: 'desc' },
  });

  return items.map((item) => ({
    id: item.id,
    workspaceId: item.workspaceId,
    type: item.type as ItemType,
    content: item.content as any,
    sources: (item.sources as any) || [],
    savedAt: item.savedAt.toISOString(),
    savedFrom: (item.savedFrom as any) || {},
    metadata: (item.metadata as any) || {},
  }));
}
```

2. **Missing Error Handling**: When `prisma.scratchpadItem.findMany()` throws an error (database connection failure, query timeout, invalid query, etc.), the exception is NOT caught and propagates to the controller.

3. **Controller Impact**: The `ScratchpadItemController.getItems()` method (lines 33-42) also lacks error handling, so exceptions propagate to NestJS's global exception handler, which returns HTTP 500.

4. **Frontend Impact**: The frontend pages (`ic-memo.html`, `scratchpad.html`, `provocations.html`) call `GET /api/research/scratchpad/{ticker}` and may receive HTTP 500 errors when database issues occur, breaking the scratchpad functionality.

## Required Fix

To fix this bug, the following changes are required:

### 1. Add Error Handling to Service Method

**File**: `src/deals/scratchpad-item.service.ts`

**Modify `getItems()` method**:
```typescript
async getItems(workspaceId: string): Promise<ScratchpadItem[]> {
  try {
    const items = await this.prisma.scratchpadItem.findMany({
      where: { workspaceId },
      orderBy: { savedAt: 'desc' },
    });

    return items.map((item) => ({
      id: item.id,
      workspaceId: item.workspaceId,
      type: item.type as ItemType,
      content: item.content as any,
      sources: (item.sources as any) || [],
      savedAt: item.savedAt.toISOString(),
      savedFrom: (item.savedFrom as any) || {},
      metadata: (item.metadata as any) || {},
    }));
  } catch (error) {
    // Log error internally for debugging
    console.error(`Error fetching scratchpad items for workspace ${workspaceId}:`, error);
    
    // Return empty array instead of throwing exception (graceful degradation)
    return [];
  }
}
```

### 2. Alternative: Add Error Handling to Controller

**File**: `src/deals/scratchpad-item.controller.ts`

**Modify `getItems()` endpoint**:
```typescript
@Get(':workspaceId')
async getItems(
  @Param('workspaceId') workspaceId: string,
): Promise<GetItemsResponse> {
  try {
    const items = await this.scratchpadItemService.getItems(workspaceId);
    return {
      items,
      totalCount: items.length,
    };
  } catch (error) {
    // Log error internally
    console.error(`Error in scratchpad getItems endpoint:`, error);
    
    // Return empty response instead of 500 error (graceful degradation)
    return {
      items: [],
      totalCount: 0,
    };
  }
}
```

### 3. Best Practice: Add Error Handling at Both Levels

For production-grade error handling, add try/catch at BOTH the service and controller levels:
- **Service level**: Catch database-specific errors, log them, and return empty arrays (graceful degradation)
- **Controller level**: Catch any remaining errors, log them, and return appropriate HTTP responses

## Test Validation

After implementing the fix, the SAME test file (`test/properties/scratchpad-endpoint-500-bugfix.property.spec.ts`) should be re-run. The expected outcome is:

- ✅ All 5 tests should PASS
- ✅ Property 1: Database errors handled gracefully (no 500 error)
- ✅ Property 2: Prisma query errors handled gracefully (no 500 error)
- ✅ Property 3: Timeout errors handled gracefully (no 500 error)
- ✅ Property 4: Valid data returns proper response structure
- ✅ Property 5: Missing data returns empty array

## Conclusion

The bug condition exploration test successfully confirmed that the scratchpad endpoint lacks error handling, causing HTTP 500 errors when database exceptions occur. The test failures provide clear counterexamples:

1. **Database connection errors** → HTTP 500 (ticker: "AAPL")
2. **Prisma query errors** → HTTP 500 (ticker: "A")
3. **Query timeout errors** → HTTP 500 (ticker: "AAPL")

The root cause is the absence of try/catch error handling in the `ScratchpadItemService.getItems()` method. The fix requires wrapping the Prisma query in a try/catch block and returning an empty array on errors (graceful degradation) instead of allowing exceptions to propagate as HTTP 500 responses.

**Next Step**: Proceed to Phase 3 (Task 3.6) to implement the fix by adding error handling to the service method.
