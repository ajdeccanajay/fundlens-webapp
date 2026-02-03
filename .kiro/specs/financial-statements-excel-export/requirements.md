# Requirements Document

## Introduction

This document specifies the requirements for the Financial Statements Excel Export feature in the FundLens financial analysis platform. The feature enables users to export financial statement data (Balance Sheet, Income Statement, Cash Flow Statement) from the financial-analysis.html screen to professionally formatted XLSX files. The export must be comprehensive, including all metrics from the database for selected fiscal years, with proper formatting and organization.

## Glossary

- **Export_Service**: The NestJS backend service responsible for generating XLSX files from financial metrics data
- **Export_Controller**: The NestJS controller handling HTTP requests for Excel export operations
- **Export_Modal**: The Alpine.js UI component for selecting export options (years, statements)
- **XLSX_Generator**: The component using exceljs library to create properly formatted Excel workbooks
- **Financial_Metrics_Table**: The PostgreSQL table (`financial_metrics`) containing normalized SEC filing data
- **Statement_Mapper**: The component that maps normalized metrics to their respective financial statements
- **Fiscal_Period**: A time period identifier (e.g., FY2024, FY2023) representing a company's fiscal year
- **Normalized_Metric**: A standardized metric name (e.g., `revenue`, `net_income`) from the database

## Requirements

### Requirement 1: Export Button Integration

**User Story:** As a financial analyst, I want to see an "Export to Excel" button on the financial analysis page, so that I can easily initiate the export process.

#### Acceptance Criteria

1. WHEN the financial-analysis.html page loads with a deal in "ready" status, THE Export_Modal SHALL display an "Export to Excel" button in the page header or action area
2. WHEN a user clicks the "Export to Excel" button, THE Export_Modal SHALL open a dialog for export configuration
3. WHILE the deal status is not "ready", THE Export_Modal SHALL disable or hide the export button
4. THE Export_Modal SHALL display the button with appropriate styling consistent with the existing FundLens UI design

### Requirement 2: Filing Type Selection

**User Story:** As a financial analyst, I want to choose between annual (10-K), quarterly (10-Q), or event (8-K) filings, so that I can export the appropriate level of detail for my analysis.

#### Acceptance Criteria

1. WHEN the export modal opens, THE Export_Modal SHALL display filing type options: 10-K (Annual), 10-Q (Quarterly), and 8-K (Events)
2. WHEN a user selects 10-K, THE Export_Modal SHALL show available fiscal years for annual data
3. WHEN a user selects 10-Q, THE Export_Modal SHALL show a year selector and available quarters for that year
4. WHEN a user selects 8-K, THE Export_Modal SHALL show a date range picker for event filings
5. THE Export_Modal SHALL default to 10-K (Annual) filing type
6. WHEN switching filing types, THE Export_Modal SHALL reset period selections appropriately

### Requirement 3: Year and Period Selection

**User Story:** As a financial analyst, I want to select which fiscal years or quarters to include in my export, so that I can customize the report to my analysis needs.

#### Acceptance Criteria

1. WHEN the export modal opens with 10-K selected, THE Export_Modal SHALL query available fiscal years from the database for the current ticker
2. WHEN fiscal years are retrieved, THE Export_Modal SHALL display checkboxes for each available fiscal year
3. WHEN 10-Q is selected, THE Export_Modal SHALL display a dropdown to select a year and checkboxes for available quarters
4. WHEN no fiscal periods are available, THE Export_Modal SHALL display an appropriate message and disable the export action
5. THE Export_Modal SHALL pre-select the most recent 3 fiscal years by default for 10-K exports
6. THE Export_Modal SHALL pre-select all available quarters by default for 10-Q exports
7. WHEN a user selects or deselects periods, THE Export_Modal SHALL update the selection state immediately
8. THE Export_Modal SHALL require at least one period to be selected before allowing export

### Requirement 4: Statement Selection

**User Story:** As a financial analyst, I want to choose which financial statements to export, so that I can generate focused reports for specific analysis needs.

#### Acceptance Criteria

1. WHEN the export modal opens, THE Export_Modal SHALL display options for: Balance Sheet, Income Statement, Cash Flow Statement, and "All Statements"
2. WHEN a user selects "All Statements", THE Export_Modal SHALL automatically select all three individual statement options
3. WHEN a user deselects any individual statement while "All Statements" is selected, THE Export_Modal SHALL deselect the "All Statements" option
4. THE Export_Modal SHALL require at least one statement type to be selected before allowing export
5. THE Export_Modal SHALL default to "All Statements" selected
6. WHEN 8-K filing type is selected, THE Export_Modal SHALL hide statement selection and show 8-K specific options

### Requirement 5: XLSX File Generation

**User Story:** As a financial analyst, I want the exported Excel file to be professionally formatted, so that I can use it directly in my analysis and presentations.

#### Acceptance Criteria

1. WHEN an export is requested, THE XLSX_Generator SHALL create a workbook with separate worksheets for each selected statement type
2. WHEN generating worksheets, THE XLSX_Generator SHALL include a header row with company name, ticker symbol, and filing type (10-K/10-Q)
3. WHEN generating worksheets, THE XLSX_Generator SHALL format the first column as metric labels and subsequent columns as period values
4. WHEN generating worksheets, THE XLSX_Generator SHALL apply currency formatting to monetary values (e.g., $1,234,567,890)
5. WHEN generating worksheets, THE XLSX_Generator SHALL apply percentage formatting to ratio/margin values
6. WHEN generating worksheets, THE XLSX_Generator SHALL apply bold formatting to header rows and section headers
7. WHEN generating worksheets, THE XLSX_Generator SHALL auto-size columns to fit content
8. THE XLSX_Generator SHALL name worksheets appropriately: "Income Statement", "Balance Sheet", "Cash Flow"
9. WHEN exporting 10-Q data, THE XLSX_Generator SHALL include a YTD (Year-to-Date) column where applicable
10. WHEN exporting combined data, THE XLSX_Generator SHALL create separate worksheets for annual and quarterly views

### Requirement 6: Complete Data Export

**User Story:** As a financial analyst, I want all available metrics exported without any missing data, so that I have a complete picture for my analysis.

#### Acceptance Criteria

1. WHEN exporting the Income Statement, THE Statement_Mapper SHALL include all income statement metrics: Revenue (with breakdown), Cost of Revenue, Gross Profit, Operating Expenses (R&D, SG&A, etc.), Operating Income, EBITDA, Interest Income/Expense, Income Before Tax, Tax Expense, Net Income, and EPS (Basic/Diluted)
2. WHEN exporting the Balance Sheet, THE Statement_Mapper SHALL include all balance sheet metrics: Current Assets (Cash, Receivables, Inventory, etc.), Non-Current Assets (PP&E, Goodwill, Intangibles), Current Liabilities, Non-Current Liabilities, and Stockholders Equity with all components
3. WHEN exporting the Cash Flow Statement, THE Statement_Mapper SHALL include all cash flow metrics: Operating Activities (with reconciliation items), Investing Activities (CapEx, Acquisitions, Investments), Financing Activities (Debt, Equity, Dividends), and Summary metrics (FCF, Cash Conversion)
4. WHEN a metric value is not available for a fiscal period, THE XLSX_Generator SHALL display "N/A" or leave the cell empty
5. FOR ALL exported metrics, THE Export_Service SHALL retrieve data directly from the financial_metrics table to ensure completeness
6. WHEN exporting 10-Q data, THE Statement_Mapper SHALL include the same metrics as 10-K with quarterly granularity
7. THE Export_Service SHALL include calculated metrics (margins, ratios, growth rates) when the option is enabled

### Requirement 7: Data Retrieval

**User Story:** As a system, I need to efficiently retrieve financial metrics from the database, so that exports are fast and accurate.

#### Acceptance Criteria

1. WHEN an export is requested, THE Export_Service SHALL query the financial_metrics table filtered by ticker, filing_type, and selected periods
2. WHEN querying 10-K metrics, THE Export_Service SHALL filter by filing_type = '10-K' for annual data
3. WHEN querying 10-Q metrics, THE Export_Service SHALL filter by filing_type = '10-Q' for quarterly data
4. WHEN querying metrics, THE Export_Service SHALL group metrics by statement_type for proper worksheet assignment
5. WHEN multiple values exist for the same metric and period, THE Export_Service SHALL use the most recent filing_date value
6. THE Export_Service SHALL handle metrics with different scales (thousands, millions, billions) by normalizing to actual values
7. WHEN exporting 8-K data, THE Export_Service SHALL query filing_metadata and available metrics within the specified date range

### Requirement 8: Export Execution

**User Story:** As a financial analyst, I want the export process to be smooth with clear feedback, so that I know when my file is ready.

#### Acceptance Criteria

1. WHEN a user clicks the export button in the modal, THE Export_Modal SHALL display a loading indicator
2. WHEN the export is in progress, THE Export_Modal SHALL disable the export button to prevent duplicate requests
3. WHEN the export completes successfully, THE Export_Modal SHALL trigger a file download with filename format: "{TICKER}_{FilingType}_Statements_{YYYY-MM-DD}.xlsx"
4. IF an error occurs during export, THEN THE Export_Modal SHALL display an error message and re-enable the export button
5. WHEN the download is triggered, THE Export_Modal SHALL close automatically
6. WHEN exporting 10-Q data, THE filename SHALL include the year: "{TICKER}_10Q_{YEAR}_Statements_{YYYY-MM-DD}.xlsx"
7. WHEN exporting 8-K data, THE filename SHALL include the date range: "{TICKER}_8K_{StartDate}_to_{EndDate}.xlsx"

### Requirement 9: API Endpoint

**User Story:** As a developer, I need a well-defined API endpoint for the export functionality, so that the frontend can request exports reliably.

#### Acceptance Criteria

1. THE Export_Controller SHALL expose a POST endpoint at `/api/deals/:dealId/export/excel`
2. WHEN receiving an export request, THE Export_Controller SHALL validate that the deal exists and belongs to the current tenant
3. WHEN receiving an export request, THE Export_Controller SHALL accept a JSON body with: `{ filingType: string, exportMode: string, years: string[], quarters?: string[], statements: string[], includeCalculatedMetrics?: boolean }`
4. WHEN the request is valid, THE Export_Controller SHALL return the XLSX file as a binary response with appropriate Content-Type and Content-Disposition headers
5. IF the deal is not found or unauthorized, THEN THE Export_Controller SHALL return a 404 status
6. IF the request body is invalid, THEN THE Export_Controller SHALL return a 400 status with error details
7. THE Export_Controller SHALL expose a separate POST endpoint at `/api/deals/:dealId/export/8k` for 8-K specific exports
8. THE Export_Controller SHALL expose a GET endpoint at `/api/deals/:dealId/export/available-periods` returning available annual periods, quarterly periods by year, and 8-K filing availability

### Requirement 10: Statement Metric Mapping

**User Story:** As a system, I need to correctly map database metrics to their respective financial statements, so that exports are organized correctly.

#### Acceptance Criteria

1. THE Statement_Mapper SHALL map metrics with statement_type = 'income_statement' to the Income Statement worksheet
2. THE Statement_Mapper SHALL map metrics with statement_type = 'balance_sheet' to the Balance Sheet worksheet
3. THE Statement_Mapper SHALL map metrics with statement_type = 'cash_flow' to the Cash Flow Statement worksheet
4. THE Statement_Mapper SHALL order metrics within each statement in standard financial statement order (e.g., Revenue before Gross Profit before Operating Income)
5. THE Statement_Mapper SHALL use display_name from metric_mappings table for user-friendly labels when available
6. THE Statement_Mapper SHALL maintain consistent metric ordering between 10-K and 10-Q exports for easy comparison

### Requirement 11: Error Handling

**User Story:** As a financial analyst, I want clear error messages when something goes wrong, so that I can understand and resolve issues.

#### Acceptance Criteria

1. IF no metrics are found for the selected ticker and periods, THEN THE Export_Service SHALL return an error indicating no data available
2. IF the XLSX generation fails, THEN THE Export_Service SHALL log the error and return a user-friendly error message
3. IF the database query times out, THEN THE Export_Service SHALL return an appropriate timeout error
4. WHEN an error occurs, THE Export_Modal SHALL display the error message without exposing technical details to the user
5. IF 8-K filings are requested but none exist in the date range, THEN THE Export_Service SHALL return an appropriate message

### Requirement 12: 8-K Filing Export

**User Story:** As a financial analyst, I want to export 8-K event filings, so that I can review material events and disclosures.

#### Acceptance Criteria

1. WHEN 8-K export is requested, THE Export_Service SHALL retrieve all 8-K filings within the specified date range
2. WHEN generating 8-K export, THE XLSX_Generator SHALL create a summary worksheet listing all filings with dates and descriptions
3. WHEN 8-K filings contain financial data (e.g., earnings announcements), THE Export_Service SHALL extract and include that data
4. THE Export_Modal SHALL display a note explaining that 8-K filings contain event disclosures, not full financial statements
5. WHEN no 8-K filings exist in the date range, THE Export_Service SHALL return an appropriate message
