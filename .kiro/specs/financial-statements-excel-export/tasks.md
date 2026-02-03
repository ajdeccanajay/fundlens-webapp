# Implementation Plan: Financial Statements Excel Export

## Overview

This implementation plan covers the Financial Statements Excel Export feature for FundLens, enabling PE/IB/HF quality exports of 10-K, 10-Q, and 8-K financial data to professionally formatted XLSX files.

## Tasks

- [-] 1. Set up project structure and core interfaces
  - [x] 1.1 Create export module structure in src/deals/
    - Create `export.controller.ts`, `export.service.ts`, `statement-mapper.ts`, `xlsx-generator.ts`
    - Define TypeScript interfaces for ExportRequest, ExportOptions, StatementData, MetricRow
    - Define enums for StatementType, FilingType, ExportMode
    - _Requirements: 9.1, 9.3_
  
  - [x] 1.2 Install and configure exceljs library
    - Add exceljs to package.json dependencies
    - Create XLSXGenerator class with basic workbook creation methods
    - _Requirements: 5.1_
  
  - [ ] 1.3 Write unit tests for interface validation
    - Test ExportRequest validation (required fields, valid values)
    - Test StatementType and FilingType enum handling
    - _Requirements: 9.6_

- [ ] 2. Implement Statement Mapper with comprehensive metric configurations
  - [ ] 2.1 Create Income Statement metric configuration
    - Define all 45+ income statement line items in correct order
    - Include revenue breakdown, operating expenses detail, EBITDA, per share data
    - Map normalized_metric names to display names and formats
    - _Requirements: 6.1, 10.1, 10.4_
  
  - [ ] 2.2 Create Balance Sheet metric configuration
    - Define all 70+ balance sheet line items in correct order
    - Include current/non-current assets, liabilities, equity sections
    - Include key ratios (current ratio, quick ratio, D/E)
    - _Requirements: 6.2, 10.2, 10.4_
  
  - [ ] 2.3 Create Cash Flow Statement metric configuration
    - Define all 50+ cash flow line items in correct order
    - Include operating reconciliation, investing, financing sections
    - Include FCF, levered/unlevered FCF, cash conversion metrics
    - _Requirements: 6.3, 10.3, 10.4_
  
  - [ ] 2.4 Implement metric mapping logic
    - Create mapMetricsToStatement() method
    - Handle metric ordering based on configuration
    - Resolve display names from metric_mappings table
    - _Requirements: 10.4, 10.5, 10.6_
  
  - [ ] 2.5 Write property test for statement metric mapping
    - **Property 8: Statement Metric Grouping**
    - **Validates: Requirements 6.3, 10.1, 10.2, 10.3**

- [ ] 3. Checkpoint - Verify statement mapper
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement XLSX Generator with professional formatting
  - [ ] 4.1 Implement workbook creation with multiple worksheets
    - Create generateWorkbook() method accepting worksheet options
    - Add worksheets for each selected statement type
    - Set worksheet names correctly ("Income Statement", "Balance Sheet", "Cash Flow")
    - _Requirements: 5.1, 5.8_
  
  - [ ] 4.2 Implement header section formatting
    - Add company name and ticker in header row
    - Add filing type indicator (10-K Annual / 10-Q Quarterly)
    - Add statement title row
    - Apply bold formatting to headers
    - _Requirements: 5.2, 5.6_
  
  - [ ] 4.3 Implement data row formatting
    - Format metric labels in first column with indentation support
    - Format period columns (FY2024, Q1 2024, etc.)
    - Apply currency formatting to monetary values
    - Apply percentage formatting to ratio/margin values
    - Apply EPS formatting (2 decimal places)
    - Handle N/A for missing values
    - _Requirements: 5.3, 5.4, 5.5, 6.4_
  
  - [ ] 4.4 Implement column auto-sizing and styling
    - Auto-size columns to fit content
    - Apply section header styling (bold, background color)
    - Add borders and alignment
    - _Requirements: 5.7_
  
  - [ ] 4.5 Write property tests for XLSX generation
    - **Property 1: Worksheet-Statement Type Correspondence**
    - **Property 2: Cell Formatting Consistency**
    - **Validates: Requirements 5.1, 5.4, 5.5, 5.6, 5.8**

- [ ] 5. Implement Export Service with data retrieval
  - [ ] 5.1 Implement getAvailablePeriods() method
    - Query distinct fiscal_period values from financial_metrics for ticker
    - Separate annual (10-K) and quarterly (10-Q) periods
    - Check for 8-K filing availability
    - Return structured AvailablePeriodsResponse
    - _Requirements: 3.1, 3.3, 9.8_
  
  - [ ] 5.2 Implement fetchMetricsForStatements() method
    - Query financial_metrics table with ticker, filing_type, periods filter
    - Group results by statement_type
    - Handle duplicate metrics (use most recent filing_date)
    - Normalize metric values (handle scale differences)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  
  - [ ] 5.3 Implement generateAnnualExport() for 10-K exports
    - Fetch 10-K metrics for selected years
    - Map metrics to statements using StatementMapper
    - Generate workbook using XLSXGenerator
    - Return Buffer for download
    - _Requirements: 6.5, 7.2_
  
  - [ ] 5.4 Implement generateQuarterlyExport() for 10-Q exports
    - Fetch 10-Q metrics for selected year and quarters
    - Include YTD column calculation where applicable
    - Map metrics to statements
    - Generate workbook
    - _Requirements: 5.9, 6.6, 7.3_
  
  - [ ] 5.5 Implement generateCombinedExport() for combined view
    - Fetch both 10-K and 10-Q data
    - Create separate worksheets for annual and quarterly views
    - _Requirements: 5.10_
  
  - [ ] 5.6 Implement calculated metrics generation
    - Calculate margins (gross, operating, EBITDA, net)
    - Calculate ratios (current, quick, D/E, cash conversion)
    - Calculate growth rates (YoY revenue, net income)
    - _Requirements: 6.7_
  
  - [ ] 5.7 Write property tests for data retrieval
    - **Property 6: Data Source Integrity**
    - **Property 7: Duplicate Metric Resolution**
    - **Validates: Requirements 6.5, 7.4, 7.5**

- [ ] 6. Checkpoint - Verify export service
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement Export Controller with API endpoints
  - [ ] 7.1 Implement POST /api/deals/:id/export/excel endpoint
    - Validate request body (filingType, exportMode, years, statements)
    - Verify deal exists and belongs to current tenant
    - Call appropriate ExportService method based on exportMode
    - Return XLSX binary with correct headers
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [ ] 7.2 Implement GET /api/deals/:id/export/available-periods endpoint
    - Call ExportService.getAvailablePeriods()
    - Return structured response with annual, quarterly, 8-K availability
    - _Requirements: 9.8_
  
  - [ ] 7.3 Implement error handling
    - Return 404 for invalid deal or wrong tenant
    - Return 400 for invalid request body
    - Return 500 with user-friendly message for server errors
    - _Requirements: 9.5, 9.6, 11.1, 11.2, 11.3_
  
  - [ ] 7.4 Write property tests for API endpoints
    - **Property 15: Tenant Isolation**
    - **Property 16: Request Validation**
    - **Property 17: Response Headers**
    - **Validates: Requirements 9.2, 9.4, 9.5, 9.6**

- [ ] 8. Implement 8-K Export functionality
  - [ ] 8.1 Implement POST /api/deals/:id/export/8k endpoint
    - Accept date range in request body
    - Query filing_metadata for 8-K filings in range
    - _Requirements: 9.7, 12.1_
  
  - [ ] 8.2 Implement generate8KExport() method
    - Create summary worksheet with filing list
    - Extract financial data from earnings 8-Ks when available
    - Handle case when no 8-K filings exist
    - _Requirements: 12.2, 12.3, 12.5_
  
  - [ ] 8.3 Write unit tests for 8-K export
    - Test empty date range handling
    - Test earnings announcement data extraction
    - _Requirements: 11.5, 12.4_

- [ ] 9. Checkpoint - Verify backend implementation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement Frontend Export Modal
  - [ ] 10.1 Add Export Button to financial-analysis.html
    - Add button in header/action area
    - Show only when deal status is "ready"
    - Style consistent with existing FundLens UI
    - _Requirements: 1.1, 1.3, 1.4_
  
  - [ ] 10.2 Create Export Modal component
    - Add modal HTML structure with Alpine.js bindings
    - Implement filing type selector (10-K, 10-Q, 8-K tabs)
    - Implement year/quarter selection UI
    - Implement statement selection checkboxes
    - Add "Include calculated metrics" option
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4, 4.5_
  
  - [ ] 10.3 Implement modal state management
    - Add Alpine.js data properties for modal state
    - Implement openExportModal() to load available periods
    - Implement filing type switching logic
    - Implement selection toggle methods
    - Implement validation (canExport())
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 3.2, 3.3, 3.4, 3.5, 3.6_
  
  - [ ] 10.4 Implement export execution
    - Implement executeExport() method
    - Show loading indicator during export
    - Disable button during export
    - Handle file download on success
    - Display error messages on failure
    - Close modal on successful download
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 11.4_
  
  - [ ] 10.5 Write property tests for frontend validation
    - **Property 12: Selection Validation**
    - **Property 13: Default Year Selection**
    - **Property 14: Period Checkbox Rendering**
    - **Validates: Requirements 2.6, 2.8, 3.4, 3.5, 3.6**

- [ ] 11. Integration and wiring
  - [ ] 11.1 Register export module in NestJS
    - Add ExportController and ExportService to deals module
    - Ensure TenantGuard is applied to all endpoints
    - _Requirements: 9.2_
  
  - [ ] 11.2 Wire frontend to backend API
    - Connect modal to /api/deals/:id/export/available-periods
    - Connect export button to /api/deals/:id/export/excel
    - Handle binary response and trigger download
    - _Requirements: 8.3_
  
  - [ ] 11.3 Write integration tests
    - Test full export flow from API request to file download
    - Test with sample AAPL, MSFT, AMZN data
    - Verify Excel file opens correctly
    - _Requirements: All_

- [ ] 12. Final checkpoint - Full system verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify exports match SEC filing data
  - Test with multiple companies

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The exceljs library is already installed in the project (package.json shows "xlsx": "^0.18.5")
