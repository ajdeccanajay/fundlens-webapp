# Requirements Document

## Introduction

This document specifies the requirements for achieving 100% accuracy in SEC 10-K income statement exports. The current Excel export feature produces outputs that don't match actual SEC 10-K filing structures because it uses a generic template with industry-specific metrics appended at the end. Different industries (media, banks, insurance, tech, retail, energy) have vastly different income statement structures that must be replicated exactly.

The goal is to ensure that when a user exports financial data for any company, the resulting Excel file matches the SEC 10-K filing structure line-by-line: same line items, same order, same hierarchy.

## Glossary

- **SEC_10K_Template**: An industry-specific income statement template that exactly mirrors the structure of SEC 10-K filings for that industry
- **Industry_Detector**: The component that automatically identifies a company's industry based on ticker, SIC code, or metric patterns
- **Statement_Mapper**: The component that maps normalized database metrics to SEC 10-K line items in the correct order
- **Metric_Alias_Resolver**: The component that handles metric name variations (e.g., net_sales = revenue, interest_expense_nonoperating = interest_expense)
- **Template_Registry**: The registry of all industry-specific SEC 10-K templates with their exact line item structures
- **Validation_Engine**: The component that compares export output against expected SEC 10-K structure for accuracy verification
- **Normalized_Metric**: A standardized metric name in the database (e.g., `programming_and_production`, `net_interest_income`)
- **SEC_Line_Item**: The exact label and position of a line item as it appears in an SEC 10-K filing

## Requirements

### Requirement 1: Industry-Specific Template System

**User Story:** As a financial analyst, I want Excel exports to use industry-specific templates that match SEC 10-K structures exactly, so that my exports are indistinguishable from the actual SEC filings.

#### Acceptance Criteria

1. THE Template_Registry SHALL maintain separate income statement templates for each industry: media, bank, insurance, tech, retail, energy, and generic
2. WHEN exporting for a media company (CMCSA, DIS, NFLX), THE Statement_Mapper SHALL use the media template with line items: Revenue, Programming and production, Marketing and promotion, Other operating and administrative, Depreciation, Amortization, Operating income, Interest expense, etc.
3. WHEN exporting for a bank (JPM, BAC, GS), THE Statement_Mapper SHALL use the bank template with line items: Net Interest Income, Provision for Credit Losses, Noninterest Income, Noninterest Expense, etc.
4. WHEN exporting for an insurance company (BRK, MET), THE Statement_Mapper SHALL use the insurance template with line items: Premiums Earned, Net Investment Income, Claims and Benefits, etc.
5. WHEN exporting for a tech company (AAPL, MSFT, GOOGL), THE Statement_Mapper SHALL use the tech template with line items: Net sales/Revenue, Cost of sales, Gross margin, R&D, SG&A, Operating income, etc.
6. WHEN exporting for a retail company (WMT, COST, TGT), THE Statement_Mapper SHALL use the retail template with line items: Net sales, Cost of sales, Operating expenses, Operating income, etc.
7. WHEN exporting for an energy company (XOM, CVX), THE Statement_Mapper SHALL use the energy template with line items: Revenues, Exploration costs, Production costs, etc.
8. THE Template_Registry SHALL store templates as ordered arrays of metric definitions with exact display names matching SEC filings

### Requirement 2: Automatic Industry Detection

**User Story:** As a financial analyst, I want the system to automatically detect a company's industry, so that the correct template is applied without manual selection.

#### Acceptance Criteria

1. WHEN an export is requested, THE Industry_Detector SHALL determine the company's industry using ticker lookup, SIC code, or metric pattern analysis
2. THE Industry_Detector SHALL maintain a ticker-to-industry mapping for known companies (CMCSA→media, JPM→bank, AAPL→tech, etc.)
3. WHEN a ticker is not in the known mapping, THE Industry_Detector SHALL analyze available metrics to infer industry (e.g., presence of `programming_and_production` indicates media)
4. WHEN industry cannot be determined, THE Industry_Detector SHALL fall back to the generic template
5. THE Industry_Detector SHALL support at least 50 tickers per industry category for accurate detection
6. WHEN a company's industry is detected, THE Industry_Detector SHALL log the detection method and confidence level

### Requirement 3: Metric Alias Resolution

**User Story:** As a financial analyst, I want the system to handle metric name variations correctly, so that all data appears in the right line items regardless of how it's stored in the database.

#### Acceptance Criteria

1. THE Metric_Alias_Resolver SHALL map `interest_expense_nonoperating` to the "Interest expense" line item
2. THE Metric_Alias_Resolver SHALL map `net_sales` to the "Revenue" line item when `revenue` is not available
3. THE Metric_Alias_Resolver SHALL map `cost_of_goods_sold` and `cost_of_sales` to "Cost of revenue" when `cost_of_revenue` is not available
4. THE Metric_Alias_Resolver SHALL map `income_from_operations` and `operating_profit` to "Operating income" when `operating_income` is not available
5. THE Metric_Alias_Resolver SHALL map `provision_for_income_taxes` and `income_tax_provision` to "Income tax expense"
6. THE Metric_Alias_Resolver SHALL prioritize the primary metric name over aliases when both exist
7. WHEN resolving aliases, THE Metric_Alias_Resolver SHALL NOT create duplicate line items for the same concept

### Requirement 4: Exact Line Item Ordering

**User Story:** As a financial analyst, I want line items to appear in the exact order they appear in SEC 10-K filings, so that my exports match the official documents.

#### Acceptance Criteria

1. WHEN generating a media company export, THE Statement_Mapper SHALL order line items exactly as: Revenue → Costs and Expenses (header) → Programming and production → Marketing and promotion → Other operating and administrative → Depreciation → Amortization → Total costs and expenses → Operating income → Interest expense → Other income/expense → Income before taxes → Income tax expense → Net income → EPS
2. WHEN generating a bank export, THE Statement_Mapper SHALL order line items exactly as: Net Interest Income → Interest Income components → Interest Expense components → Provision for Credit Losses → Noninterest Income → Noninterest Expense → Income before taxes → Income tax expense → Net income
3. THE Statement_Mapper SHALL NOT append industry-specific metrics at the end of a generic template
4. THE Statement_Mapper SHALL use the industry template as the primary structure, not as additions to a generic template
5. WHEN a metric in the template has no data, THE Statement_Mapper SHALL skip that line item (not show N/A)
6. THE Statement_Mapper SHALL preserve section headers (REVENUE, COSTS AND EXPENSES, etc.) in their correct positions

### Requirement 5: Data Availability Filtering

**User Story:** As a financial analyst, I want exports to only show metrics that actually exist in the database for that company, so that I don't see empty rows or irrelevant line items.

#### Acceptance Criteria

1. WHEN generating an export, THE Statement_Mapper SHALL only include line items for which data exists in the database
2. THE Statement_Mapper SHALL NOT display "N/A" for metrics that don't exist - instead, skip the line entirely
3. WHEN a section header has no child metrics with data, THE Statement_Mapper SHALL skip the section header
4. THE Statement_Mapper SHALL preserve the relative order of metrics that do have data
5. WHEN all metrics in a subsection are missing, THE Statement_Mapper SHALL collapse that subsection
6. THE Statement_Mapper SHALL log which metrics were skipped due to missing data for debugging

### Requirement 6: CMCSA Reference Implementation

**User Story:** As a developer, I want CMCSA (Comcast) exports to match SEC 10-K page 61 exactly, so that I have a validated reference implementation for media companies.

#### Acceptance Criteria

1. WHEN exporting CMCSA income statement, THE export SHALL match the structure on SEC 10-K page 61 exactly
2. THE CMCSA export SHALL show "Revenue" as the first line item (not "Total Revenue" or "Net Sales")
3. THE CMCSA export SHALL show "Programming and production" as the first cost item under "COSTS AND EXPENSES"
4. THE CMCSA export SHALL show "Marketing and promotion" as the second cost item
5. THE CMCSA export SHALL show "Other operating and administrative" as the third cost item
6. THE CMCSA export SHALL show "Depreciation" and "Amortization" as separate line items (not combined)
7. THE CMCSA export SHALL show "Interest expense" in the non-operating section (not under operating expenses)
8. THE CMCSA export SHALL show "Net income attributable to Comcast Corporation" as the final income line before EPS

### Requirement 7: Cross-Industry Validation

**User Story:** As a QA engineer, I want to validate exports across multiple industries, so that I can ensure 100% accuracy for all supported company types.

#### Acceptance Criteria

1. THE Validation_Engine SHALL support validation for at least 2 companies per industry (12+ total)
2. WHEN validating an export, THE Validation_Engine SHALL compare line item names against expected SEC 10-K structure
3. WHEN validating an export, THE Validation_Engine SHALL compare line item order against expected SEC 10-K structure
4. WHEN validating an export, THE Validation_Engine SHALL report any missing, extra, or out-of-order line items
5. THE Validation_Engine SHALL produce a validation report with pass/fail status and detailed discrepancies
6. THE Validation_Engine SHALL support automated testing via test fixtures containing expected structures

### Requirement 8: Template Extensibility

**User Story:** As a developer, I want to easily add new industry templates or modify existing ones, so that the system can adapt to new company types or SEC format changes.

#### Acceptance Criteria

1. THE Template_Registry SHALL store templates in a structured format that is easy to read and modify
2. WHEN adding a new industry template, THE developer SHALL only need to define the ordered list of metric definitions
3. THE Template_Registry SHALL support template versioning to handle SEC format changes over time
4. THE Template_Registry SHALL validate template structure on load to catch configuration errors
5. WHEN a template is invalid, THE Template_Registry SHALL log detailed error messages and fall back to generic template
6. THE Template_Registry SHALL support inheritance (e.g., tech template extends generic with modifications)

### Requirement 9: Display Name Accuracy

**User Story:** As a financial analyst, I want line item labels to match SEC 10-K filings exactly, so that my exports look professional and match official documents.

#### Acceptance Criteria

1. THE Statement_Mapper SHALL use exact SEC 10-K display names (e.g., "Programming and production" not "Programming & Production Costs")
2. THE Statement_Mapper SHALL preserve capitalization as it appears in SEC filings (e.g., "COSTS AND EXPENSES" for headers)
3. THE Statement_Mapper SHALL use company-specific terminology where applicable (e.g., "Net income attributable to Comcast Corporation")
4. WHEN a metric has multiple acceptable display names, THE Statement_Mapper SHALL use the one matching the company's SEC filing
5. THE Statement_Mapper SHALL NOT add suffixes like "(Net)" or "(Gross)" unless they appear in the SEC filing

### Requirement 10: Validation Test Suite

**User Story:** As a developer, I want automated tests that verify export accuracy against known SEC 10-K structures, so that regressions are caught immediately.

#### Acceptance Criteria

1. THE test suite SHALL include validation tests for at least one company per industry
2. WHEN a validation test runs, THE test SHALL compare the generated export structure against a fixture file containing the expected SEC 10-K structure
3. THE test SHALL fail if any line item is missing, extra, or out of order
4. THE test SHALL fail if any display name doesn't match the expected SEC 10-K label
5. THE test fixtures SHALL be derived from actual SEC 10-K filings and stored in version control
6. THE test suite SHALL run as part of CI/CD to prevent accuracy regressions


### Requirement 11: AI-Powered Completeness Validation

**User Story:** As a financial analyst, I want an AI system to validate that my exports capture all metrics from the original SEC filing, so that I can be confident no important financial data is missing.

#### Acceptance Criteria

1. THE AI_Validator SHALL use an LLM (Claude/GPT-4) to analyze SEC 10-K/10-Q/8-K filings and extract the expected income statement structure
2. WHEN validating an export, THE AI_Validator SHALL compare the export structure against the LLM-extracted structure
3. THE AI_Validator SHALL produce a completeness score (0-100%) indicating what percentage of expected line items are present
4. WHEN completeness score is below 95%, THE AI_Validator SHALL flag the export for review and list missing metrics
5. THE AI_Validator SHALL identify metrics that exist in the SEC filing but are not in our template
6. THE AI_Validator SHALL support batch validation of multiple exports for efficiency
7. THE AI_Validator SHALL cache LLM-extracted structures to avoid redundant API calls for the same filing

### Requirement 12: Automated Template Generation

**User Story:** As a developer, I want the system to automatically generate industry templates from multiple SEC filings, so that templates are comprehensive and accurate without manual creation.

#### Acceptance Criteria

1. THE Template_Generator SHALL analyze multiple SEC 10-K filings (minimum 3) for a given industry to identify common line items
2. THE Template_Generator SHALL use an LLM to extract line item names, order, and hierarchy from SEC filings
3. THE Template_Generator SHALL merge extracted structures to create a comprehensive template covering all common metrics
4. THE Template_Generator SHALL identify industry-specific metrics that appear in >50% of analyzed filings
5. THE Template_Generator SHALL output templates in the MetricDefinition[] format compatible with Statement_Mapper
6. WHEN generating a template, THE Template_Generator SHALL preserve exact SEC display names and ordering
7. THE Template_Generator SHALL flag metrics that appear inconsistently across filings for manual review

### Requirement 13: Continuous Learning Pipeline

**User Story:** As a platform operator, I want the system to learn from export discrepancies and improve templates over time, so that accuracy increases automatically.

#### Acceptance Criteria

1. THE Learning_Pipeline SHALL log all discrepancies between exports and AI-validated expected structures
2. THE Learning_Pipeline SHALL aggregate discrepancy logs to identify systematic template gaps
3. WHEN a metric is missing in >3 exports for the same industry, THE Learning_Pipeline SHALL flag it for template addition
4. THE Learning_Pipeline SHALL generate weekly reports of template improvement opportunities
5. THE Learning_Pipeline SHALL support manual approval workflow before template changes are applied
6. THE Learning_Pipeline SHALL track accuracy metrics over time (completeness score trends by industry)
7. THE Learning_Pipeline SHALL integrate with the Template_Registry to propose template updates
