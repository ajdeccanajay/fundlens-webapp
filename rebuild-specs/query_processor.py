"""
FundLens.ai Query Processor
Handles intelligent routing and structured retrieval for financial queries
"""

import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class PeriodType(Enum):
    """Query period type"""
    LATEST_BOTH = "latest_both"  # Default: show both Q and FY
    LATEST_QUARTERLY = "latest_quarterly"
    LATEST_ANNUAL = "latest_annual"
    SPECIFIC_QUARTER = "specific_quarter"
    SPECIFIC_YEAR = "specific_year"
    TTM = "ttm"
    RANGE = "range"


@dataclass
class QueryIntent:
    """Parsed query intent"""
    ticker: str
    metric: str
    normalized_metric: str
    period_type: PeriodType
    specific_period: Optional[str]  # e.g., "Q3 2024", "FY 2023"
    doc_types: List[str]  # ['10-K', '10-Q']
    statement_types: List[str]  # ['balance_sheet', 'income_statement']
    needs_narrative: bool  # Should we retrieve MD&A context?


class QueryRouter:
    """
    Routes queries to appropriate documents and sections
    Implements the CRITICAL INTERPRETATION RULES from your prompt
    """
    
    # Metric to statement type mapping
    STATEMENT_MAPPING = {
        'balance_sheet': [
            'accounts_payable', 'accounts_receivable', 'inventory', 
            'cash', 'total_assets', 'total_liabilities', 'shareholders_equity',
            'current_assets', 'current_liabilities', 'long_term_debt'
        ],
        'income_statement': [
            'revenue', 'net_sales', 'cost_of_goods_sold', 'gross_profit',
            'operating_income', 'net_income', 'ebitda', 'ebit',
            'sg&a', 'r&d', 'depreciation_amortization'
        ],
        'cash_flow': [
            'operating_cash_flow', 'capex', 'fcf', 'free_cash_flow',
            'investing_cash_flow', 'financing_cash_flow'
        ]
    }
    
    def __init__(self, normalizer):
        """
        Args:
            normalizer: MetricNormalizer instance for label mapping
        """
        self.normalizer = normalizer
    
    def parse_query(self, user_query: str) -> QueryIntent:
        """
        Parse user query into structured intent
        
        Examples:
            "What is AAPL's accounts payable for latest fiscal year?"
            -> ticker=AAPL, metric=accounts_payable, period=LATEST_ANNUAL
            
            "Give me TSLA's latest revenue"
            -> ticker=TSLA, metric=revenue, period=LATEST_BOTH  # KEY!
            
            "Show me Q3 2024 revenue for GOOGL"
            -> ticker=GOOGL, metric=revenue, period=SPECIFIC_QUARTER, specific="Q3 2024"
        """
        query_lower = user_query.lower()
        
        # Extract ticker
        ticker = self._extract_ticker(user_query)
        
        # Extract metric
        metric_raw, normalized_metric = self._extract_metric(query_lower)
        
        # Extract period intent (CRITICAL LOGIC HERE)
        period_type, specific_period = self._extract_period_intent(query_lower)
        
        # Determine document types needed
        doc_types = self._determine_doc_types(period_type)
        
        # Determine statement types
        statement_types = self._determine_statement_types(normalized_metric)
        
        # Check if narrative context needed
        needs_narrative = self._needs_narrative_context(query_lower)
        
        return QueryIntent(
            ticker=ticker,
            metric=metric_raw,
            normalized_metric=normalized_metric,
            period_type=period_type,
            specific_period=specific_period,
            doc_types=doc_types,
            statement_types=statement_types,
            needs_narrative=needs_narrative
        )
    
    def _extract_ticker(self, query: str) -> str:
        """Extract ticker symbol from query"""
        # Match 1-5 uppercase letters (most tickers)
        match = re.search(r'\b([A-Z]{1,5})\b', query)
        if match:
            return match.group(1)
        
        # Common company name -> ticker mapping
        company_mapping = {
            'apple': 'AAPL',
            'microsoft': 'MSFT',
            'tesla': 'TSLA',
            'amazon': 'AMZN',
            'google': 'GOOGL',
            'alphabet': 'GOOGL',
            'meta': 'META',
            'facebook': 'META'
        }
        
        for company, ticker in company_mapping.items():
            if company in query.lower():
                return ticker
        
        return "UNKNOWN"
    
    def _extract_metric(self, query: str) -> Tuple[str, str]:
        """
        Extract metric from query and normalize it
        
        Returns:
            (raw_metric, normalized_metric)
        """
        # Common metric patterns
        metric_patterns = [
            r'(accounts?\s+payable)',
            r'(accounts?\s+receivable)',
            r'(revenue|revenues?|sales?|net\s+sales?)',
            r'(gross\s+profit)',
            r'(net\s+income|earnings?|profit)',
            r'(ebitda|ebit)',
            r'(operating\s+income)',
            r'(free\s+cash\s+flow|fcf)',
            r'(cash\s+flow)',
            r'(total\s+assets)',
            r'(shareholders?\s+equity|stockholders?\s+equity)'
        ]
        
        for pattern in metric_patterns:
            match = re.search(pattern, query)
            if match:
                raw_metric = match.group(1)
                
                # Normalize using the MetricNormalizer
                normalized, _ = self.normalizer.normalize_label(raw_metric)
                
                if normalized:
                    return raw_metric, normalized
                else:
                    # Fallback: use raw metric
                    return raw_metric, raw_metric.replace(' ', '_')
        
        return "unknown_metric", "unknown_metric"
    
    def _extract_period_intent(self, query: str) -> Tuple[PeriodType, Optional[str]]:
        """
        CRITICAL: Interpret period requirements according to prompt rules
        
        Rules from your prompt:
        1. "LATEST" ALWAYS = BOTH quarterly AND annual
        2. EXCEPTIONS: "latest quarter", "latest annual", "Q3 revenue", "FY 2023"
        """
        # EXCEPTION 1: Explicit "latest quarter"
        if re.search(r'latest\s+(quarter|quarterly|q\d)', query):
            return PeriodType.LATEST_QUARTERLY, None
        
        # EXCEPTION 2: Explicit "latest annual/year"
        if re.search(r'latest\s+(annual|year|fiscal\s+year|fy)', query):
            return PeriodType.LATEST_ANNUAL, None
        
        # EXCEPTION 3: Specific quarter (e.g., "Q3 revenue", "Q3 2024")
        q_match = re.search(r'q([1-4])\s*(\d{4})?', query)
        if q_match:
            quarter = q_match.group(1)
            year = q_match.group(2) if q_match.group(2) else "2024"
            return PeriodType.SPECIFIC_QUARTER, f"Q{quarter} {year}"
        
        # EXCEPTION 4: Specific fiscal year (e.g., "FY 2023", "fiscal year 2023")
        fy_match = re.search(r'(?:fy|fiscal\s+year)\s*(\d{4})', query)
        if fy_match:
            year = fy_match.group(1)
            return PeriodType.SPECIFIC_YEAR, f"FY{year}"
        
        # EXCEPTION 5: TTM explicitly mentioned
        if 'ttm' in query or 'trailing twelve' in query:
            return PeriodType.TTM, None
        
        # DEFAULT RULE: "latest" without qualifier = BOTH
        if 'latest' in query:
            return PeriodType.LATEST_BOTH, None
        
        # Fallback: if no period specified, assume LATEST_BOTH
        return PeriodType.LATEST_BOTH, None
    
    def _determine_doc_types(self, period_type: PeriodType) -> List[str]:
        """Determine which SEC filing types to query"""
        if period_type == PeriodType.LATEST_BOTH:
            return ['10-Q', '10-K']  # Need both!
        
        elif period_type in [PeriodType.LATEST_QUARTERLY, PeriodType.SPECIFIC_QUARTER, PeriodType.TTM]:
            return ['10-Q']
        
        elif period_type in [PeriodType.LATEST_ANNUAL, PeriodType.SPECIFIC_YEAR]:
            return ['10-K']
        
        else:
            return ['10-K', '10-Q', '8-K']
    
    def _determine_statement_types(self, normalized_metric: str) -> List[str]:
        """Determine which financial statement sections to query"""
        for statement_type, metrics in self.STATEMENT_MAPPING.items():
            if normalized_metric in metrics:
                return [statement_type]
        
        # If not found in primary mapping, search all statements
        return ['balance_sheet', 'income_statement', 'cash_flow']
    
    def _needs_narrative_context(self, query: str) -> bool:
        """Determine if query needs narrative/qualitative context"""
        narrative_keywords = [
            'why', 'explain', 'context', 'trend', 'insight',
            'reason', 'commentary', 'discussion', 'analysis'
        ]
        
        return any(kw in query for kw in narrative_keywords)


class StructuredRetriever:
    """
    Retrieves exact metrics from structured storage
    No LLM hallucination possible at this stage
    """
    
    def __init__(self, metrics_db):
        """
        Args:
            metrics_db: Could be SQL database, DynamoDB, or filtered Bedrock KB
        """
        self.metrics_db = metrics_db
    
    def retrieve_metrics(self, intent: QueryIntent) -> Dict[str, List[Dict]]:
        """
        Retrieve exact metric values based on query intent
        
        Returns:
            {
                '10-Q': [list of quarterly metrics, sorted by date DESC],
                '10-K': [list of annual metrics, sorted by date DESC]
            }
        """
        results = {}
        
        for doc_type in intent.doc_types:
            # Construct filter criteria
            filter_criteria = {
                'ticker': intent.ticker,
                'normalized_metric': intent.normalized_metric,
                'filing_type': doc_type,
                'statement_type': intent.statement_types[0]  # Primary statement
            }
            
            # Add period filter if specific
            if intent.specific_period:
                filter_criteria['fiscal_period'] = intent.specific_period
            
            # Query structured storage
            metrics = self._query_metrics(filter_criteria)
            
            if metrics:
                results[doc_type] = metrics
        
        return results
    
    def _query_metrics(self, filter_criteria: Dict) -> List[Dict]:
        """
        Query the structured metrics database
        
        This is a MOCK implementation. In production, replace with:
        - SQL query to RDS
        - DynamoDB query
        - Bedrock KB metadata filter
        """
        # Example SQL query (pseudo-code):
        """
        SELECT ticker, normalized_metric, fiscal_period, value, unit, scale,
               filing_type, statement_date, raw_label, source_page
        FROM financial_metrics
        WHERE ticker = :ticker
          AND normalized_metric = :metric
          AND filing_type = :filing_type
          AND statement_type = :statement_type
        ORDER BY statement_date DESC
        LIMIT 10
        """
        
        # Mock return for demonstration
        return [
            {
                'ticker': filter_criteria['ticker'],
                'normalized_metric': filter_criteria['normalized_metric'],
                'fiscal_period': 'Q3 2024',
                'value': 5234000000,
                'unit': 'USD',
                'scale': 'thousands',
                'filing_type': filter_criteria['filing_type'],
                'statement_date': '2024-09-28',
                'raw_label': 'Accounts Payable',
                'source_page': 45
            }
        ]


class ResponseBuilder:
    """
    Builds final response according to your prompt template
    Pre-fills EXACT numbers to prevent LLM hallucination
    """
    
    @staticmethod
    def build_response(
        intent: QueryIntent,
        structured_data: Dict[str, List[Dict]],
        narrative_chunks: Optional[List[str]] = None
    ) -> str:
        """
        Build response using your prompt's format
        
        Key: Numbers are PRE-FILLED from structured data
        LLM only adds narrative context
        """
        ticker = intent.ticker
        metric_name = intent.metric.replace('_', ' ').title()
        
        # Extract latest values
        quarterly_data = structured_data.get('10-Q', [])
        annual_data = structured_data.get('10-K', [])
        
        response_parts = []
        
        # 📊 Summary Answer (ALWAYS includes both if LATEST_BOTH)
        response_parts.append("📊 **Summary Answer**")
        
        if intent.period_type == PeriodType.LATEST_BOTH:
            # MUST show both quarterly and annual
            if quarterly_data and annual_data:
                latest_q = quarterly_data[0]
                latest_fy = annual_data[0]
                
                response_parts.append(
                    f"{ticker}'s latest {metric_name}: "
                    f"**{latest_q['fiscal_period']}** was ${latest_q['value']:,.0f}{latest_q['scale'][0].upper()} "
                    f"and **{latest_fy['fiscal_period']}** was ${latest_fy['value']:,.0f}{latest_fy['scale'][0].upper()}."
                )
            elif quarterly_data:
                latest_q = quarterly_data[0]
                response_parts.append(
                    f"{ticker}'s latest quarterly {metric_name} ({latest_q['fiscal_period']}): "
                    f"${latest_q['value']:,.0f}{latest_q['scale'][0].upper()}. "
                    f"*Annual data not yet available.*"
                )
            elif annual_data:
                latest_fy = annual_data[0]
                response_parts.append(
                    f"{ticker}'s latest annual {metric_name} ({latest_fy['fiscal_period']}): "
                    f"${latest_fy['value']:,.0f}{latest_fy['scale'][0].upper()}."
                )
        
        elif intent.period_type == PeriodType.LATEST_QUARTERLY:
            if quarterly_data:
                latest_q = quarterly_data[0]
                response_parts.append(
                    f"{ticker}'s latest quarterly {metric_name} ({latest_q['fiscal_period']}): "
                    f"${latest_q['value']:,.0f}{latest_q['scale'][0].upper()}."
                )
        
        elif intent.period_type == PeriodType.LATEST_ANNUAL:
            if annual_data:
                latest_fy = annual_data[0]
                response_parts.append(
                    f"{ticker}'s latest annual {metric_name} ({latest_fy['fiscal_period']}): "
                    f"${latest_fy['value']:,.0f}{latest_fy['scale'][0].upper()}."
                )
        
        response_parts.append("")  # Blank line
        
        # 📅 Temporal Analysis
        response_parts.append("📅 **Temporal Analysis**")
        
        if quarterly_data:
            response_parts.append("**Latest Quarterly Results:**")
            for i, metric in enumerate(quarterly_data[:4]):  # Last 4 quarters
                response_parts.append(
                    f"- {metric['fiscal_period']}: ${metric['value']:,.0f}{metric['scale'][0].upper()}"
                )
            response_parts.append("")
        
        if annual_data:
            response_parts.append("**Latest Annual Results:**")
            for i, metric in enumerate(annual_data[:3]):  # Last 3 fiscal years
                response_parts.append(
                    f"- {metric['fiscal_period']}: ${metric['value']:,.0f}{metric['scale'][0].upper()}"
                )
            response_parts.append("")
        
        # 📄 Source Documentation
        response_parts.append("📄 **Source Documentation**")
        
        if quarterly_data:
            latest_q = quarterly_data[0]
            response_parts.append(
                f"- Document: {latest_q['filing_type']} | Company: {ticker} | "
                f"Period: {latest_q['fiscal_period']} | Page: {latest_q.get('source_page', 'N/A')}"
            )
        
        if annual_data:
            latest_fy = annual_data[0]
            response_parts.append(
                f"- Document: {latest_fy['filing_type']} | Company: {ticker} | "
                f"Period: {latest_fy['fiscal_period']} | Page: {latest_fy.get('source_page', 'N/A')}"
            )
        
        response_parts.append("")
        
        # Optional: Add LLM-generated insights from narrative context
        if narrative_chunks:
            response_parts.append("💡 **Key Insights**")
            response_parts.append(
                "[LLM to add context here based on MD&A/narrative chunks]"
            )
        
        return '\n'.join(response_parts)


# Example Usage
if __name__ == "__main__":
    # Mock setup
    from sec_table_extractor import MetricNormalizer
    
    # Load normalizer
    normalizer = MetricNormalizer('/mnt/user-data/uploads/mini_MVP_metrics.xlsx')
    
    # Initialize router
    router = QueryRouter(normalizer)
    
    # Test queries
    test_queries = [
        "What is AAPL's accounts payable for latest fiscal year?",
        "Give me TSLA's latest revenue",
        "Show me Q3 2024 revenue for GOOGL",
        "What's AMZN's latest quarterly net income?"
    ]
    
    for query in test_queries:
        print(f"\n{'='*60}")
        print(f"Query: {query}")
        print(f"{'='*60}")
        
        intent = router.parse_query(query)
        
        print(f"Ticker: {intent.ticker}")
        print(f"Metric: {intent.metric} -> {intent.normalized_metric}")
        print(f"Period Type: {intent.period_type}")
        print(f"Document Types: {intent.doc_types}")
        print(f"Statement Types: {intent.statement_types}")
        print(f"Needs Narrative: {intent.needs_narrative}")
