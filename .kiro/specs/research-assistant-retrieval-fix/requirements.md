# Requirements Document

## Introduction

This document specifies the requirements for fixing the Research Assistant "No Data Available" bug. Users querying for financial metrics (e.g., "What is the latest Revenue for ABNB?") receive "No Data Available" responses despite the data existing in the database. The root cause is in the retrieval layer: (1) hardcoded ticker regex doesn't include all tickers, (2) type errors in structured-retriever.service.ts where MetricResolution objects are incorrectly treated as strings, and (3) metric name variations don't cover all database formats.

## Glossary

- **Intent_Detector**: The IntentDetectorService that parses natural language queries into structured QueryIntent objects
- **Structured_Retriever**: The StructuredRetrieverService that retrieves financial metrics from PostgreSQL
- **MetricResolution**: A typed object containing canonical_id, display_name, db_column, and confidence fields from the metric registry
- **CompanyTickerMapService**: A service that dynamically loads company-to-ticker mappings from the database and a base reference list
- **StructuredQuery**: The query object passed to the retriever containing tickers, metrics (as MetricResolution[]), period, and filing types

## Requirements

### Requirement 1: Dynamic Ticker Detection

**User Story:** As a financial analyst, I want to query any ticker symbol that exists in the database, so that I can retrieve financial data for companies beyond the hardcoded list.

#### Acceptance Criteria

1. WHEN a user queries for a ticker symbol, THE Intent_Detector SHALL use CompanyTickerMapService to resolve company names to ticker symbols
2. WHEN a ticker symbol is not in the hardcoded regex pattern, THE Intent_Detector SHALL fall back to CompanyTickerMapService.resolveAll() to detect tickers from company names
3. WHEN CompanyTickerMapService returns ticker matches, THE Intent_Detector SHALL include those tickers in the QueryIntent
4. THE Intent_Detector SHALL continue to use the existing regex pattern for fast-path detection of common tickers
5. WHEN neither regex nor CompanyTickerMapService finds a ticker, THE Intent_Detector SHALL delegate to the LLM layer for ticker detection

### Requirement 2: Fix MetricResolution Type Handling in Structured Retriever

**User Story:** As a system operator, I want the structured retriever to correctly handle MetricResolution objects, so that metric queries don't fail with type errors.

#### Acceptance Criteria

1. WHEN the Structured_Retriever receives a StructuredQuery with metrics, THE Structured_Retriever SHALL extract the metric name string from each MetricResolution object using db_column or canonical_id
2. WHEN a metric in the query is a MetricResolution object, THE Structured_Retriever SHALL NOT call string methods like toLowerCase() directly on the object
3. THE Structured_Retriever SHALL handle both string metrics (legacy) and MetricResolution objects (current) for backward compatibility
4. WHEN extracting metric names, THE Structured_Retriever SHALL prefer db_column over canonical_id when both are available

### Requirement 3: Expand Metric Name Variations

**User Story:** As a financial analyst, I want the system to find my requested metrics regardless of how they are stored in the database, so that I get accurate results.

#### Acceptance Criteria

1. WHEN searching for a metric, THE Structured_Retriever SHALL generate variations including: lowercase, PascalCase, total_prefixed (e.g., total_revenue), and UPPERCASE
2. WHEN the database stores metrics with prefixes like "total_", THE Structured_Retriever SHALL include those variations in the search
3. WHEN the database stores metrics with XBRL tag formats (e.g., us-gaap:Revenues), THE Structured_Retriever SHALL map those to canonical metric names
4. THE Structured_Retriever SHALL use case-insensitive matching for all metric name comparisons

### Requirement 4: Graceful Degradation

**User Story:** As a user, I want the system to provide helpful feedback when data cannot be found, so that I understand why and what alternatives exist.

#### Acceptance Criteria

1. WHEN no metrics are found for a valid ticker, THE Structured_Retriever SHALL log the attempted metric variations for debugging
2. WHEN a ticker exists but the requested metric doesn't, THE Structured_Retriever SHALL return available metrics for that ticker as suggestions
3. IF the retrieval fails due to type errors, THEN THE Structured_Retriever SHALL catch the error and return a meaningful error message instead of crashing
