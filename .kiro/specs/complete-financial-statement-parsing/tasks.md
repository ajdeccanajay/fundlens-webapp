# Implementation Plan: Complete Financial Statement Parsing

## Overview

This implementation plan addresses critical gaps in the SEC filing parser to ensure 100% extraction of financial statement line items and proper handling of reporting units. The implementation spans three layers: Python parser enhancements, database verification, and TypeScript export layer updates.

## Tasks

- [x] 1. Implement ReportingUnitExtractor component
  - [x] 1.1 Create ReportingUnitExtractor class in python_parser/
    - Create `reporting_unit_extractor.py` with ReportingUnitInfo dataclass
    - Implement regex patterns for common SEC unit headers
    - Handle patterns like "(In millions, except shares in thousands, and per-share amounts)"
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [x] 1.2 Implement extract_from_filing() method
    - Search filing header and first few tables for unit patterns
    - Return ReportingUnitInfo with default_unit, share_unit, per_share_unit
    - _Requirements: 1.1, 1.4_
  
  - [x] 1.3 Implement get_unit_for_metric() method
    - Map metric types to appropriate units (shares vs dollars vs per-share)
    - Handle EPS, weighted average shares, dividends per share specially
    - _Requirements: 1.3_
  
  - [ ]* 1.4 Write property test for reporting unit extraction
    - **Property 1: Reporting Unit Extraction Consistency**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**

- [x] 2. Enhance XBRLTagMapper with complete mappings
  - [x] 2.1 Add media company mappings (CMCSA-style)
    - Add programming_and_production mapping with cmcsa: and us-gaap: tags
    - Add marketing_and_promotion mapping
    - Add other_operating_and_administrative mapping
    - Add separate depreciation and amortization mappings
    - Add goodwill_and_long_lived_asset_impairments mapping
    - _Requirements: 4.2, 8.5_
  
  - [x] 2.2 Add comprehensive Income Statement tag mappings
    - Add all revenue breakdown tags (product, service, subscription, advertising)
    - Add all operating expense tags (R&D, SG&A, restructuring)
    - Add all non-operating tags (interest, other income/expense)
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 8.1_
  
  - [x] 2.3 Add comprehensive Balance Sheet tag mappings
    - Add all current asset tags with sub-breakdowns
    - Add all non-current asset tags (goodwill, intangibles, PP&E components)
    - Add all liability tags with sub-breakdowns
    - Add all equity component tags
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.2_
  
  - [x] 2.4 Add comprehensive Cash Flow tag mappings
    - Add all operating activities tags including reconciliation items
    - Add all investing activities tags
    - Add all financing activities tags
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.3_
  
  - [x] 2.5 Implement unmapped tag tracking
    - Add unmapped_tags set to track unknown tags
    - Implement register_unmapped_tag() method
    - Implement get_unmapped_tags_report() method
    - _Requirements: 8.4_
  
  - [ ]* 2.6 Write property test for XBRL tag fallback
    - **Property 8: XBRL Tag Fallback Handling**
    - **Validates: Requirements 8.4, 8.5**

- [x] 3. Checkpoint - Verify tag mapper completeness
  - Ensure all tests pass, ask the user if questions arise.
  - Run mapper against sample CMCSA, AAPL, MSFT filings to verify coverage

- [x] 4. Enhance HybridSECParser with reporting unit integration
  - [x] 4.1 Integrate ReportingUnitExtractor into parse_filing()
    - Extract reporting units at start of parsing
    - Pass unit_info to metric conversion methods
    - Include unit_info in metadata output
    - _Requirements: 1.1, 1.5_
  
  - [x] 4.2 Update _convert_ixbrl_to_metrics() to use reporting units
    - Call get_unit_for_metric() for each metric
    - Set reporting_unit field on ExtractedMetric
    - Handle iXBRL scale attribute as fallback
    - _Requirements: 1.2, 1.5_
  
  - [x] 4.3 Update _extract_html_table_metrics() for reporting units
    - Extract units from table headers
    - Apply units to all metrics from that table
    - _Requirements: 11.3_
  
  - [ ]* 4.4 Write property test for Income Statement completeness
    - **Property 4: Income Statement Extraction Completeness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
  
  - [ ]* 4.5 Write property test for Balance Sheet completeness
    - **Property 5: Balance Sheet Extraction Completeness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
  
  - [ ]* 4.6 Write property test for Cash Flow completeness
    - **Property 6: Cash Flow Statement Extraction Completeness**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 5. Enhance HTML table fallback parser
  - [x] 5.1 Improve table header unit detection
    - Add patterns for "$in millions", "Dollars in thousands", etc.
    - Handle unit headers in different table positions
    - _Requirements: 11.3_
  
  - [x] 5.2 Implement hierarchical relationship detection
    - Detect indentation from CSS/HTML structure
    - Detect parent-child from row grouping
    - Set parent_metric field on ExtractedMetric
    - _Requirements: 7.1, 11.4_
  
  - [x] 5.3 Improve line item extraction completeness
    - Handle various SEC HTML table formats
    - Extract all visible text rows as potential metrics
    - _Requirements: 11.2, 11.5_
  
  - [ ]* 5.4 Write property test for HTML fallback completeness
    - **Property 11: HTML Fallback Completeness**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**

- [x] 6. Checkpoint - Verify parser enhancements
  - Ensure all tests pass, ask the user if questions arise.
  - Test with pre-2019 filings to verify HTML fallback

- [x] 7. Verify and enhance database storage
  - [x] 7.1 Verify reporting_unit column exists and is populated
    - Check schema has reporting_unit with default 'units'
    - Verify existing data has reporting_unit values
    - _Requirements: 2.1, 2.3_
  
  - [x] 7.2 Create backfill script for existing metrics
    - Query metrics with reporting_unit = 'units' or NULL
    - Re-parse original filings to extract correct units
    - Update metrics with correct reporting_unit values
    - _Requirements: 2.2_
  
  - [ ]* 7.3 Write property test for storage round-trip
    - **Property 2: Reporting Unit Storage Round-Trip**
    - **Validates: Requirements 2.2, 2.4**

- [x] 8. Enhance StatementMapper with dynamic discovery
  - [x] 8.1 Add media company metric definitions
    - Add MEDIA_INCOME_STATEMENT_ADDITIONS to configuration
    - Include programming_and_production, marketing_and_promotion, etc.
    - Set appropriate indentation for sub-items
    - _Requirements: 9.1_
  
  - [x] 8.2 Implement dynamic metric discovery
    - After processing configured metrics, scan for unmapped database metrics
    - Create MetricRow for each unmapped metric with humanized display name
    - Log warnings for dynamically discovered metrics
    - _Requirements: 9.4, 9.5_
  
  - [x] 8.3 Implement humanizeMetricName() helper
    - Convert snake_case to Title Case
    - Handle common abbreviations (eps, sg_and_a, etc.)
    - _Requirements: 9.4_
  
  - [ ]* 8.4 Write property test for dynamic metric discovery
    - **Property 9: Dynamic Metric Discovery**
    - **Validates: Requirements 9.4, 9.5**

- [x] 9. Enhance XLSXGenerator with reporting unit display
  - [x] 9.1 Update addCompanyHeader() for reporting unit display
    - Accept ReportingUnitInfo parameter
    - Format header to match SEC filing style
    - Display exceptions for shares and per-share amounts
    - _Requirements: 3.1_
  
  - [x] 9.2 Update formatValueCell() to use actual reporting units
    - Use reporting_unit from metric instead of inferring from magnitude
    - Apply correct format string based on unit type
    - _Requirements: 3.2, 3.3, 3.4, 3.5_
  
  - [x] 9.3 Handle mixed reporting units in single export
    - Track reporting unit per metric row
    - Apply correct format to each cell individually
    - _Requirements: 3.6_
  
  - [ ]* 9.4 Write property test for Excel formatting
    - **Property 3: Excel Formatting with Reporting Units**
    - **Validates: Requirements 3.1, 3.2, 3.6**

- [x] 10. Checkpoint - Verify export layer
  - Ensure all tests pass, ask the user if questions arise.
  - Generate sample exports and verify formatting matches SEC filings

- [x] 11. Implement hierarchical line item preservation
  - [x] 11.1 Update ExtractedMetric with parent_metric field
    - Add optional parent_metric field to dataclass
    - Populate during parsing based on hierarchy detection
    - _Requirements: 7.1_
  
  - [x] 11.2 Update StatementMapper for hierarchical display
    - Order metrics to keep children after parents
    - Set indent based on hierarchy depth
    - _Requirements: 7.3, 7.4_
  
  - [ ]* 11.3 Write property test for hierarchical preservation
    - **Property 7: Hierarchical Line Item Preservation**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 12. Implement parsing audit script
  - [x] 12.1 Create ParsingAuditScript class
    - Create `python_parser/audit_script.py`
    - Implement audit_filing() method
    - Compare extracted metrics against original filing
    - _Requirements: 10.1_
  
  - [x] 12.2 Implement gap detection
    - Identify line items in SEC filing but missing from database
    - Identify unmapped XBRL tags
    - Calculate completeness percentage per statement type
    - _Requirements: 10.2, 10.3, 10.4_
  
  - [x] 12.3 Implement generate_gap_report() method
    - Aggregate results across multiple tickers
    - Generate recommendations for missing mappings
    - Output report in JSON and human-readable formats
    - _Requirements: 10.5_
  
  - [ ]* 12.4 Write property test for audit completeness
    - **Property 10: Audit Completeness Reporting**
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5**

- [x] 13. Implement comprehensive data validation (Trustworthiness Layer)
  - [x] 13.1 Add mathematical validation logic
    - Validate Total Assets = Current Assets + Non-Current Assets
    - Validate Total Liabilities = Current + Non-Current Liabilities
    - Validate Total Liabilities & Equity = Total Assets
    - Validate Gross Profit = Revenue - Cost of Revenue
    - Validate Operating Income = Gross Profit - Operating Expenses
    - _Requirements: 12.1_
  
  - [x] 13.2 Add cross-statement validation
    - Validate Net Income on Income Statement matches Cash Flow starting point
    - Validate ending cash on Cash Flow matches Balance Sheet cash
    - Validate retained earnings change matches Net Income - Dividends
    - _Requirements: 12.1_
  
  - [x] 13.3 Implement validation logging and audit trail
    - Log all validation checks with pass/fail status
    - Store validation results in database for audit
    - Generate validation report per filing
    - _Requirements: 12.2_
  
  - [x] 13.4 Add confidence scoring system
    - Calculate extraction confidence: (mapped_tags / total_tags) * 100
    - Calculate validation confidence: (passed_checks / total_checks) * 100
    - Overall confidence = min(extraction, validation) confidence
    - Display confidence in Excel export header
    - _Requirements: 12.4_
  
  - [ ]* 13.5 Write property test for data validation
    - **Property 12: Data Validation and Reconciliation**
    - **Validates: Requirements 12.1, 12.2, 12.4**

- [x] 14. Implement human-in-the-loop workflow for edge cases
  - [x] 14.1 Create unmapped tag review queue
    - Store unmapped XBRL tags with context (ticker, filing, count)
    - Create admin endpoint to list unmapped tags by frequency
    - Allow manual mapping addition through admin interface
    - _Requirements: 8.4, 8.6_
  
  - [x] 14.2 Create validation failure review queue
    - Store validation failures with details
    - Create admin endpoint to review and resolve failures
    - Allow manual override with audit trail
    - _Requirements: 12.2_
  
  - [x] 14.3 Implement mapping update workflow
    - When new mapping is added, re-process affected filings
    - Track mapping version for reproducibility
    - _Requirements: 8.6_

- [x] 15. Checkpoint - Verify validation and review workflows
  - Ensure all tests pass, ask the user if questions arise.
  - Run audit on CMCSA, AAPL, MSFT to identify remaining gaps

- [x] 16. Integration testing and gap closure
  - [x] 16.1 Run full extraction on CMCSA 10-K
    - Verify all cost breakdown items are extracted
    - Verify reporting units are correct
    - Compare Excel export against original SEC filing
    - Verify confidence score is > 95%
    - _Requirements: All_
  
  - [x] 16.2 Run full extraction on sample of 10 companies
    - Include tech (AAPL, MSFT), media (CMCSA, DIS), banks (JPM, BAC)
    - Generate audit reports for each
    - Document any remaining gaps
    - Target: > 98% extraction completeness across all companies
    - _Requirements: All_
  
  - [x] 16.3 Address identified gaps
    - Add missing tag mappings discovered during testing
    - Update StatementMapper configurations as needed
    - Re-run tests to verify fixes
    - _Requirements: All_
  
  - [x] 16.4 Create accuracy benchmark report
    - Document extraction accuracy per company
    - Document validation pass rate
    - Create baseline for ongoing monitoring
    - _Requirements: All_

- [x] 17. Final checkpoint - Full system verification
  - Ensure all tests pass, ask the user if questions arise.
  - Verify Excel exports match SEC filings for all test companies
  - Verify confidence scores are accurate
  - Document any known limitations

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The existing database schema already supports reporting_unit - focus is on ensuring it's populated correctly
- Python components use pytest with hypothesis for property testing
- TypeScript components use jest with fast-check for property testing
- **Trustworthiness Focus**: This implementation prioritizes deterministic, auditable extraction over AI-assisted approaches to ensure financial firms can trust the data
- **Human-in-the-Loop**: Edge cases and unmapped tags are flagged for manual review rather than auto-resolved

