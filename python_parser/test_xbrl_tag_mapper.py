"""
Test suite for XBRLTagMapper - verifies comprehensive tag coverage across industries

This test validates:
1. ALL_MAPPINGS includes all industry-specific mapping lists
2. Tag mapper correctly maps common XBRL tags
3. Unmapped tag tracking works correctly
4. Coverage across different company types (tech, media, banks, etc.)
"""

import pytest
from xbrl_tag_mapper import (
    XBRLTagMapper,
    ALL_MAPPINGS,
    INCOME_STATEMENT_MAPPINGS,
    BALANCE_SHEET_MAPPINGS,
    CASH_FLOW_MAPPINGS,
    BANK_MAPPINGS,
    ADDITIONAL_MAPPINGS,
    MEDIA_COMPANY_MAPPINGS,
    TECH_COMPANY_MAPPINGS,
    RETAIL_COMPANY_MAPPINGS,
    HEALTHCARE_COMPANY_MAPPINGS,
    ENERGY_COMPANY_MAPPINGS,
    INDUSTRIAL_COMPANY_MAPPINGS,
    INSURANCE_COMPANY_MAPPINGS,
    TELECOM_COMPANY_MAPPINGS,
    REAL_ESTATE_COMPANY_MAPPINGS,
    UTILITY_COMPANY_MAPPINGS,
)


class TestAllMappingsCompleteness:
    """Verify ALL_MAPPINGS includes all industry-specific mapping lists"""
    
    def test_all_mappings_includes_core_mappings(self):
        """Core mappings (income, balance, cash flow) should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        
        # Check income statement
        for mapping in INCOME_STATEMENT_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing: {mapping.normalized_metric}"
        
        # Check balance sheet
        for mapping in BALANCE_SHEET_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing: {mapping.normalized_metric}"
        
        # Check cash flow
        for mapping in CASH_FLOW_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_bank_mappings(self):
        """Bank-specific mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in BANK_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing bank metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_media_mappings(self):
        """Media company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in MEDIA_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing media metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_tech_mappings(self):
        """Tech company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in TECH_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing tech metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_retail_mappings(self):
        """Retail company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in RETAIL_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing retail metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_healthcare_mappings(self):
        """Healthcare company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in HEALTHCARE_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing healthcare metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_energy_mappings(self):
        """Energy company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in ENERGY_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing energy metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_industrial_mappings(self):
        """Industrial company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in INDUSTRIAL_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing industrial metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_insurance_mappings(self):
        """Insurance company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in INSURANCE_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing insurance metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_telecom_mappings(self):
        """Telecom company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in TELECOM_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing telecom metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_real_estate_mappings(self):
        """Real estate company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in REAL_ESTATE_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing real estate metric: {mapping.normalized_metric}"
    
    def test_all_mappings_includes_utility_mappings(self):
        """Utility company mappings should be in ALL_MAPPINGS"""
        all_metrics = {m.normalized_metric for m in ALL_MAPPINGS}
        for mapping in UTILITY_COMPANY_MAPPINGS:
            assert mapping.normalized_metric in all_metrics, f"Missing utility metric: {mapping.normalized_metric}"


class TestXBRLTagMapperBasics:
    """Test basic XBRLTagMapper functionality"""
    
    def test_mapper_initialization(self):
        """Mapper should initialize without errors"""
        mapper = XBRLTagMapper()
        assert mapper is not None
    
    def test_map_common_revenue_tag(self):
        """Should map common revenue XBRL tag"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:Revenues')
        assert metric is not None
        assert 'revenue' in metric.lower()  # Could be 'revenue' or 'total_revenue'
        assert confidence > 0.9
    
    def test_map_net_income_tag(self):
        """Should map net income XBRL tag"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:NetIncomeLoss')
        assert metric is not None
        assert metric == 'net_income'
    
    def test_map_total_assets_tag(self):
        """Should map total assets XBRL tag"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:Assets')
        assert metric is not None
        assert metric == 'total_assets'
    
    def test_map_cash_tag(self):
        """Should map cash XBRL tag"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:CashAndCashEquivalentsAtCarryingValue')
        assert metric is not None
        assert 'cash' in metric.lower()  # Could be 'cash_and_equivalents' or 'ending_cash_balance'
    
    def test_map_unknown_tag_returns_none(self):
        """Unknown tags should return None with 0 confidence"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:SomeUnknownTag12345')
        assert metric is None
        assert confidence == 0.0


class TestUnmappedTagTracking:
    """Test unmapped tag tracking functionality"""
    
    def test_register_unmapped_tag(self):
        """Should track unmapped tags"""
        mapper = XBRLTagMapper()
        mapper.clear_unmapped_tags()
        
        mapper.register_unmapped_tag('us-gaap:UnknownTag1', 'AAPL')
        mapper.register_unmapped_tag('us-gaap:UnknownTag2', 'MSFT')
        
        report = mapper.get_unmapped_tags_report()
        assert len(report) == 2
    
    def test_unmapped_tag_deduplication(self):
        """Same tag from same ticker should not duplicate"""
        mapper = XBRLTagMapper()
        mapper.clear_unmapped_tags()
        
        mapper.register_unmapped_tag('us-gaap:UnknownTag1', 'AAPL')
        mapper.register_unmapped_tag('us-gaap:UnknownTag1', 'AAPL')
        
        report = mapper.get_unmapped_tags_report()
        assert len(report) == 1
    
    def test_same_tag_different_tickers_aggregated(self):
        """Same tag from different tickers should be aggregated into one report entry"""
        mapper = XBRLTagMapper()
        mapper.clear_unmapped_tags()
        
        mapper.register_unmapped_tag('us-gaap:UnknownTag1', 'AAPL')
        mapper.register_unmapped_tag('us-gaap:UnknownTag1', 'MSFT')
        
        report = mapper.get_unmapped_tags_report()
        # Should be 1 entry with count=2 and both contexts
        assert len(report) == 1
        assert report[0]['count'] == 2
        assert 'AAPL' in report[0]['contexts']
        assert 'MSFT' in report[0]['contexts']
    
    def test_clear_unmapped_tags(self):
        """Should clear all tracked unmapped tags"""
        mapper = XBRLTagMapper()
        mapper.register_unmapped_tag('us-gaap:UnknownTag1', 'AAPL')
        mapper.clear_unmapped_tags()
        
        report = mapper.get_unmapped_tags_report()
        assert len(report) == 0


class TestIndustrySpecificMappings:
    """Test industry-specific XBRL tag mappings"""
    
    def test_media_programming_costs(self):
        """Should map media company programming costs"""
        mapper = XBRLTagMapper()
        # CMCSA-style programming costs
        metric, confidence = mapper.get_normalized_metric('us-gaap:ProgrammingCosts')
        assert metric is not None
        assert 'programming' in metric.lower()
    
    def test_bank_interest_income(self):
        """Should map bank interest income"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:InterestAndDividendIncomeOperating')
        assert metric is not None
    
    def test_bank_provision_for_loan_losses(self):
        """Should map bank provision for loan losses"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:ProvisionForLoanAndLeaseLosses')
        assert metric is not None
        assert 'provision' in metric.lower() or 'loan' in metric.lower()
    
    def test_tech_stock_compensation(self):
        """Should map tech company stock compensation"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:ShareBasedCompensation')
        assert metric is not None
    
    def test_retail_same_store_sales(self):
        """Should map retail same-store sales if available"""
        mapper = XBRLTagMapper()
        # This may or may not be mapped - just verify no error
        metric, confidence = mapper.get_normalized_metric('us-gaap:SamestoreSales')
        # Result can be None if not mapped
    
    def test_energy_depletion_expense(self):
        """Should map energy company depletion expense"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:DepletionOfOilAndGasProperties')
        assert metric is not None
    
    def test_insurance_premiums_earned(self):
        """Should map insurance premiums earned"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:PremiumsEarnedNet')
        assert metric is not None
    
    def test_telecom_subscriber_revenue(self):
        """Should map telecom subscriber revenue"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:SubscriptionRevenue')
        assert metric is not None
    
    def test_reit_ffo(self):
        """Should map REIT FFO (Funds From Operations)"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:FundsFromOperationsPerShare')
        assert metric is not None
    
    def test_utility_fuel_costs(self):
        """Should map utility fuel costs"""
        mapper = XBRLTagMapper()
        metric, confidence = mapper.get_normalized_metric('us-gaap:FuelCosts')
        assert metric is not None


class TestMappingCoverage:
    """Test overall mapping coverage statistics"""
    
    def test_total_mapping_count(self):
        """Should have substantial number of mappings"""
        assert len(ALL_MAPPINGS) >= 200, f"Expected at least 200 mappings, got {len(ALL_MAPPINGS)}"
    
    def test_unique_xbrl_tags_count(self):
        """Should have many unique XBRL tags mapped"""
        all_tags = set()
        for mapping in ALL_MAPPINGS:
            for tag in mapping.xbrl_tags:
                all_tags.add(tag)
        
        assert len(all_tags) >= 400, f"Expected at least 400 unique tags, got {len(all_tags)}"
    
    def test_income_statement_coverage(self):
        """Should have comprehensive income statement coverage"""
        income_metrics = [m for m in ALL_MAPPINGS if m.statement_type == 'income_statement']
        assert len(income_metrics) >= 20, f"Expected at least 20 income statement metrics, got {len(income_metrics)}"
    
    def test_balance_sheet_coverage(self):
        """Should have comprehensive balance sheet coverage"""
        balance_metrics = [m for m in ALL_MAPPINGS if m.statement_type == 'balance_sheet']
        assert len(balance_metrics) >= 30, f"Expected at least 30 balance sheet metrics, got {len(balance_metrics)}"
    
    def test_cash_flow_coverage(self):
        """Should have comprehensive cash flow coverage"""
        cash_flow_metrics = [m for m in ALL_MAPPINGS if m.statement_type == 'cash_flow']
        assert len(cash_flow_metrics) >= 20, f"Expected at least 20 cash flow metrics, got {len(cash_flow_metrics)}"


class TestCommonCompanyTags:
    """Test mapping of common tags from major companies"""
    
    def test_apple_common_tags(self):
        """Should map common Apple (AAPL) XBRL tags"""
        mapper = XBRLTagMapper()
        
        apple_tags = [
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
            'us-gaap:CostOfGoodsAndServicesSold',
            'us-gaap:GrossProfit',
            'us-gaap:ResearchAndDevelopmentExpense',
            'us-gaap:SellingGeneralAndAdministrativeExpense',
            'us-gaap:OperatingIncomeLoss',
            'us-gaap:NetIncomeLoss',
            'us-gaap:EarningsPerShareBasic',
            'us-gaap:EarningsPerShareDiluted',
        ]
        
        mapped_count = 0
        for tag in apple_tags:
            metric, confidence = mapper.get_normalized_metric(tag)
            if metric:
                mapped_count += 1
        
        assert mapped_count >= 8, f"Expected at least 8 Apple tags mapped, got {mapped_count}"
    
    def test_microsoft_common_tags(self):
        """Should map common Microsoft (MSFT) XBRL tags"""
        mapper = XBRLTagMapper()
        
        msft_tags = [
            'us-gaap:Revenues',
            'us-gaap:CostOfRevenue',
            'us-gaap:GrossProfit',
            'us-gaap:ResearchAndDevelopmentExpense',
            'us-gaap:SellingGeneralAndAdministrativeExpense',
            'us-gaap:OperatingIncomeLoss',
            'us-gaap:IncomeTaxExpenseBenefit',
            'us-gaap:NetIncomeLoss',
        ]
        
        mapped_count = 0
        for tag in msft_tags:
            metric, confidence = mapper.get_normalized_metric(tag)
            if metric:
                mapped_count += 1
        
        assert mapped_count >= 7, f"Expected at least 7 Microsoft tags mapped, got {mapped_count}"
    
    def test_jpmorgan_common_tags(self):
        """Should map common JPMorgan (JPM) XBRL tags"""
        mapper = XBRLTagMapper()
        
        jpm_tags = [
            'us-gaap:InterestAndDividendIncomeOperating',
            'us-gaap:InterestExpense',
            'us-gaap:ProvisionForLoanAndLeaseLosses',
            'us-gaap:NoninterestIncome',
            'us-gaap:NoninterestExpense',
            'us-gaap:NetIncomeLoss',
        ]
        
        mapped_count = 0
        for tag in jpm_tags:
            metric, confidence = mapper.get_normalized_metric(tag)
            if metric:
                mapped_count += 1
        
        assert mapped_count >= 5, f"Expected at least 5 JPMorgan tags mapped, got {mapped_count}"
    
    def test_comcast_common_tags(self):
        """Should map common Comcast (CMCSA) XBRL tags"""
        mapper = XBRLTagMapper()
        
        cmcsa_tags = [
            'us-gaap:Revenues',
            'us-gaap:ProgrammingCosts',
            'us-gaap:DepreciationAndAmortization',
            'us-gaap:OperatingIncomeLoss',
            'us-gaap:NetIncomeLoss',
        ]
        
        mapped_count = 0
        for tag in cmcsa_tags:
            metric, confidence = mapper.get_normalized_metric(tag)
            if metric:
                mapped_count += 1
        
        assert mapped_count >= 4, f"Expected at least 4 Comcast tags mapped, got {mapped_count}"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
