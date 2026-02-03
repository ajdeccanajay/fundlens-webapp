# Requirements Document

## Introduction

This document specifies the requirements for the Complete Financial Statement Parsing feature, which addresses critical gaps in the current SEC filing parser. The current system is missing line items from financial statements (particularly sub-line items like cost breakdowns) and not properly capturing reporting units from SEC filings. This results in incomplete Excel exports that don't match the original SEC filings.

**Strategic Assessment Update (Jan 29, 2026):**
- Current system: 85-92% extraction accuracy with solid architecture
- Target: 95-98% accuracy (100% is theoretically impossible due to filing inconsistencies)
- Approach: Targeted improvements to edge cases, not architectural changes
- See `PARSING_SYSTEM_ASSESSMENT.md` for detailed analysis
- See `UPDATED_IMPLEMENTATION_PLAN.md` for phased implementation

The feature encompasses three assessment areas:
1. **Parsing Layer** (Python parser): Ensuring 95-98% extraction of all line items from financial tables
2. **Storage Layer** (RDS): Ensuring the schema supports all required fields including reporting units
3. **Export Layer** (Excel generator): Ensuring all data is output with proper units matching original filings

## Glossary

- **Hybrid_Parser**: The Python parser (`python_parser/hybrid_parser.py`) that extracts financial data from SEC filings using iXBRL tags and HTML table fallback
- **XBRL_Tag_Mapper**: The component (`python_parser/xbrl_tag_mapper.py`) that maps XBRL taxonomy tags to normalized metric names
- **Statement_Mapper**: The TypeScript component (`src/deals/statement-mapper.ts`) that maps database metrics to organized financial statement structures
- **XLSX_Generator**: The TypeScript component (`src/deals/xlsx-generator.ts`) that generates formatted Excel workbooks
- **Reporting_Unit**: The scale/unit specified in SEC filings (e.g., "In millions", "In thousands", "In billions")
- **Line_Item**: A single row in a financial statement (e.g., "Revenue", "Programming and production")
- **Sub_Line_Item**: A child line item that provides breakdown detail under a parent (e.g., "Programming and production" under "Cost and expenses")
- **Financial_Metrics_Table**: The PostgreSQL table (`financial_metrics`) storing normalized SEC filing data
- **iXBRL**: Inline eXtensible Business Reporting Language - the format used by SEC for tagged financial data
- **Normalized_Metric**: A standardized metric name (e.g., `programming_and_production`) used in the database

## Requirements

### Requirement 1: Reporting Unit Extraction

**User Story:** As a financial analyst, I need reporting units (millions, thousands, etc.) to be extracted from SEC filings and stored with each metric, so that I can understand the scale of values in my analysis.

#### Acceptance Criteria

1. WHEN the Hybrid_Parser parses an SEC filing, THE Hybrid_Parser SHALL extract the reporting unit from table headers or filing headers (e.g., "(In millions, except number of shares, which are reflected in thousands, and per-share amounts)")
2. WHEN a reporting unit is found in a table header, THE Hybrid_Parser SHALL associate that unit with all metrics extracted from that table
3. WHEN multiple reporting units are specified in a single header (e.g., "millions" for most values, "thousands" for shares), THE Hybrid_Parser SHALL correctly assign the appropriate unit to each metric type
4. WHEN no explicit reporting unit is found, THE Hybrid_Parser SHALL default to "units" (raw numbers)
5. WHEN extracting from iXBRL tags, THE Hybrid_Parser SHALL use the scale attribute to determine the reporting unit
6. THE Hybrid_Parser SHALL support the following reporting units: units, thousands, millions, billions

### Requirement 2: Reporting Unit Storage

**User Story:** As a system, I need to store reporting units with each financial metric in the database, so that downstream systems can access this information.

#### Acceptance Criteria

1. THE Financial_Metrics_Table SHALL have a `reporting_unit` column to store the original scale from SEC filings
2. WHEN a metric is stored, THE system SHALL persist the reporting_unit value alongside the metric value
3. THE reporting_unit column SHALL default to "units" for metrics without explicit unit information
4. WHEN querying metrics, THE system SHALL return the reporting_unit field with each metric record

### Requirement 3: Reporting Unit Display in Excel

**User Story:** As a financial analyst, I need reporting units to be clearly displayed in Excel exports exactly as shown in the original SEC filing, so that my exports match the source documents.

#### Acceptance Criteria

1. WHEN generating an Excel export, THE XLSX_Generator SHALL include a units header row indicating the reporting unit for the data
2. WHEN formatting currency values, THE XLSX_Generator SHALL use the actual reporting_unit from the database rather than inferring from value magnitude
3. WHEN the reporting_unit is "millions", THE XLSX_Generator SHALL format values with "M" suffix (e.g., "$383.3M")
4. WHEN the reporting_unit is "billions", THE XLSX_Generator SHALL format values with "B" suffix (e.g., "$383.3B")
5. WHEN the reporting_unit is "thousands", THE XLSX_Generator SHALL format values with "K" suffix (e.g., "$383.3K")
6. WHEN different metrics have different reporting units (e.g., shares in thousands, dollars in millions), THE XLSX_Generator SHALL apply the correct format to each metric

### Requirement 4: Complete Income Statement Line Item Extraction

**User Story:** As a financial analyst, I need ALL line items from SEC Income Statements to be captured exactly as they appear in the original filing, so that I have complete data for my analysis.

#### Acceptance Criteria

1. WHEN parsing an Income Statement, THE Hybrid_Parser SHALL extract all revenue line items including breakdowns (product revenue, service revenue, subscription revenue, etc.)
2. WHEN parsing an Income Statement, THE Hybrid_Parser SHALL extract all cost and expense sub-items including:
   - Programming and production
   - Marketing and promotion
   - Other operating and administrative
   - Depreciation
   - Amortization
   - Goodwill and long-lived asset impairments
3. WHEN parsing an Income Statement, THE Hybrid_Parser SHALL extract all operating expense line items (R&D, SG&A, restructuring, etc.)
4. WHEN parsing an Income Statement, THE Hybrid_Parser SHALL extract all non-operating items (interest income, interest expense, other income/expense)
5. WHEN parsing an Income Statement, THE Hybrid_Parser SHALL extract all per-share data (basic EPS, diluted EPS, weighted average shares)
6. THE XBRL_Tag_Mapper SHALL have mappings for all common Income Statement XBRL tags including company-specific extensions

### Requirement 5: Complete Balance Sheet Line Item Extraction

**User Story:** As a financial analyst, I need ALL line items from SEC Balance Sheets to be captured exactly as they appear in the original filing, so that I have complete data for my analysis.

#### Acceptance Criteria

1. WHEN parsing a Balance Sheet, THE Hybrid_Parser SHALL extract all current asset line items with sub-breakdowns
2. WHEN parsing a Balance Sheet, THE Hybrid_Parser SHALL extract all non-current asset line items including goodwill, intangibles, and PP&E components
3. WHEN parsing a Balance Sheet, THE Hybrid_Parser SHALL extract all current liability line items with sub-breakdowns
4. WHEN parsing a Balance Sheet, THE Hybrid_Parser SHALL extract all non-current liability line items including long-term debt components
5. WHEN parsing a Balance Sheet, THE Hybrid_Parser SHALL extract all stockholders' equity components (common stock, APIC, retained earnings, treasury stock, AOCI)
6. THE XBRL_Tag_Mapper SHALL have mappings for all common Balance Sheet XBRL tags

### Requirement 6: Complete Cash Flow Statement Line Item Extraction

**User Story:** As a financial analyst, I need ALL line items from SEC Cash Flow Statements to be captured exactly as they appear in the original filing, so that I have complete data for my analysis.

#### Acceptance Criteria

1. WHEN parsing a Cash Flow Statement, THE Hybrid_Parser SHALL extract all operating activities line items including reconciliation adjustments
2. WHEN parsing a Cash Flow Statement, THE Hybrid_Parser SHALL extract all investing activities line items (CapEx, acquisitions, divestitures, investment purchases/sales)
3. WHEN parsing a Cash Flow Statement, THE Hybrid_Parser SHALL extract all financing activities line items (debt issuance/repayment, stock issuance/repurchase, dividends)
4. WHEN parsing a Cash Flow Statement, THE Hybrid_Parser SHALL extract summary items (net change in cash, beginning/ending cash balances)
5. THE XBRL_Tag_Mapper SHALL have mappings for all common Cash Flow Statement XBRL tags

### Requirement 7: Hierarchical Line Item Preservation

**User Story:** As a financial analyst, I need sub-line items (like cost breakdowns) to be preserved with proper parent/child relationships, so that I can see the same hierarchy as in the original SEC filing.

#### Acceptance Criteria

1. WHEN a line item has sub-items in the SEC filing, THE Hybrid_Parser SHALL capture the hierarchical relationship
2. WHEN storing hierarchical metrics, THE system SHALL preserve the parent-child relationship through normalized metric naming conventions
3. WHEN exporting to Excel, THE Statement_Mapper SHALL display sub-items with appropriate indentation under their parent items
4. THE Statement_Mapper SHALL maintain the same ordering of line items as they appear in standard SEC filings

### Requirement 8: XBRL Tag Mapping Completeness

**User Story:** As a system, I need comprehensive XBRL tag mappings to ensure all SEC financial data is properly normalized, so that no data is lost during parsing.

#### Acceptance Criteria

1. THE XBRL_Tag_Mapper SHALL include mappings for all standard us-gaap taxonomy tags used in Income Statements
2. THE XBRL_Tag_Mapper SHALL include mappings for all standard us-gaap taxonomy tags used in Balance Sheets
3. THE XBRL_Tag_Mapper SHALL include mappings for all standard us-gaap taxonomy tags used in Cash Flow Statements
4. WHEN an unmapped XBRL tag is encountered, THE XBRL_Tag_Mapper SHALL convert it to a normalized slug and log it for future mapping
5. THE XBRL_Tag_Mapper SHALL support company-specific extension tags (e.g., cmcsa:ProgrammingAndProduction)
6. THE system SHALL provide a mechanism to add new tag mappings without code changes

### Requirement 9: Statement Mapper Completeness

**User Story:** As a system, I need the Statement Mapper to include all possible line items in its configuration, so that all extracted data appears in Excel exports.

#### Acceptance Criteria

1. THE Statement_Mapper SHALL include metric definitions for all Income Statement line items including sub-breakdowns
2. THE Statement_Mapper SHALL include metric definitions for all Balance Sheet line items including sub-breakdowns
3. THE Statement_Mapper SHALL include metric definitions for all Cash Flow Statement line items including sub-breakdowns
4. WHEN a metric exists in the database but not in the Statement_Mapper configuration, THE system SHALL still include it in exports (with a generic display name)
5. THE Statement_Mapper SHALL support dynamic metric discovery to handle company-specific line items

### Requirement 10: Parsing Audit and Gap Analysis

**User Story:** As a developer, I need tools to audit parsing completeness and identify gaps, so that I can ensure 100% data extraction.

#### Acceptance Criteria

1. THE system SHALL provide an audit script that compares extracted metrics against the original SEC filing
2. WHEN running an audit, THE system SHALL report any line items present in the SEC filing but missing from the database
3. WHEN running an audit, THE system SHALL report any XBRL tags that were not mapped to normalized metrics
4. THE audit script SHALL generate a report showing extraction completeness percentage per statement type
5. THE audit script SHALL identify specific missing line items by company and filing

### Requirement 11: HTML Table Fallback Completeness

**User Story:** As a system, I need the HTML table fallback parser to extract all line items when iXBRL tags are not available, so that pre-2019 filings and non-tagged tables are fully captured.

#### Acceptance Criteria

1. WHEN iXBRL tags are not present, THE Hybrid_Parser SHALL fall back to HTML table parsing
2. WHEN parsing HTML tables, THE Hybrid_Parser SHALL extract all visible line items including sub-items
3. WHEN parsing HTML tables, THE Hybrid_Parser SHALL detect and extract reporting units from table headers
4. WHEN parsing HTML tables, THE Hybrid_Parser SHALL preserve hierarchical relationships based on visual indentation
5. THE HTML table parser SHALL handle various SEC filing formats (different companies use different HTML structures)

### Requirement 12: Data Validation and Reconciliation

**User Story:** As a financial analyst, I need confidence that the extracted data matches the original SEC filing, so that I can trust the data for my analysis.

#### Acceptance Criteria

1. THE system SHALL validate that total line items equal the sum of their sub-items where applicable
2. WHEN a validation discrepancy is found, THE system SHALL log a warning but still store the data
3. THE system SHALL provide a reconciliation report comparing extracted totals against SEC filing totals
4. WHEN exporting to Excel, THE system SHALL include a data quality indicator showing extraction confidence

