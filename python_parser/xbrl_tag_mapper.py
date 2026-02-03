"""
XBRL Tag Mapper - Maps us-gaap XBRL tags to normalized metric names

This module provides comprehensive mapping from XBRL taxonomy tags to
normalized metric names used in the MVP metrics system.

Sources:
- RDS metric_mappings table (xbrlTags field)
- Excel mini MVP metrics.xlsx (Common_XBRL_Tags column)
- Additional common us-gaap tags
"""

import re
import logging
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class MetricMapping:
    """Represents a mapping from XBRL tag to normalized metric"""
    normalized_metric: str
    display_name: str
    statement_type: str  # income_statement, balance_sheet, cash_flow, shareholders_equity
    xbrl_tags: List[str]
    synonyms: List[str]
    description: str = ""


# Comprehensive XBRL tag to normalized metric mapping
# Priority order matters - first match wins
XBRL_TAG_MAPPINGS: Dict[str, MetricMapping] = {}


# ============ INCOME STATEMENT METRICS ============
INCOME_STATEMENT_MAPPINGS = [
    MetricMapping(
        normalized_metric='revenue',
        display_name='Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:Revenues',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
            'us-gaap:SalesRevenueNet',
            'us-gaap:SalesRevenueGoodsNet',
            'us-gaap:SalesRevenueServicesNet',
            'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax',
        ],
        synonyms=['revenue', 'revenues', 'net sales', 'total revenue', 'sales'],
    ),
    MetricMapping(
        normalized_metric='cost_of_revenue',
        display_name='Cost of Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CostOfRevenue',
            'us-gaap:CostOfGoodsAndServicesSold',
            'us-gaap:CostOfGoodsSold',
            'us-gaap:CostOfServices',
        ],
        synonyms=['cost of revenue', 'cost of sales', 'cogs', 'cost of goods sold'],
    ),
    MetricMapping(
        normalized_metric='gross_profit',
        display_name='Gross Profit',
        statement_type='income_statement',
        xbrl_tags=['us-gaap:GrossProfit'],
        synonyms=['gross profit', 'gross margin', 'gross income'],
    ),
    MetricMapping(
        normalized_metric='research_development',
        display_name='Research & Development',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ResearchAndDevelopmentExpense',
            'us-gaap:ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost',
        ],
        synonyms=['research and development', 'r&d'],
    ),
    MetricMapping(
        normalized_metric='selling_general_administrative',
        display_name='Selling, General & Administrative',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:SellingGeneralAndAdministrativeExpense',
            'us-gaap:GeneralAndAdministrativeExpense',
            'us-gaap:SellingAndMarketingExpense',
        ],
        synonyms=['sg&a', 'selling general and administrative'],
    ),
    MetricMapping(
        normalized_metric='operating_expenses',
        display_name='Operating Expenses',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:OperatingExpenses',
            'us-gaap:CostsAndExpenses',
        ],
        synonyms=['operating expenses', 'total operating expenses'],
    ),
    MetricMapping(
        normalized_metric='operating_income',
        display_name='Operating Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:OperatingIncomeLoss',
            'us-gaap:IncomeLossFromOperations',
        ],
        synonyms=['operating income', 'income from operations', 'operating profit'],
    ),
    MetricMapping(
        normalized_metric='interest_income',
        display_name='Interest Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:InterestIncomeOperating',
            'us-gaap:InterestAndDividendIncomeOperating',
            'us-gaap:InvestmentIncomeInterest',
        ],
        synonyms=['interest income'],
    ),
    MetricMapping(
        normalized_metric='interest_expense',
        display_name='Interest Expense',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:InterestExpense',
            'us-gaap:InterestExpenseDebt',
        ],
        synonyms=['interest expense'],
    ),
    MetricMapping(
        normalized_metric='other_income_expense',
        display_name='Other Income (Expense)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:OtherNonoperatingIncomeExpense',
            'us-gaap:NonoperatingIncomeExpense',
            'us-gaap:OtherIncome',
        ],
        synonyms=['other income', 'other expense', 'non-operating income'],
    ),
    MetricMapping(
        normalized_metric='income_before_taxes',
        display_name='Income Before Taxes',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
            'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
            'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic',
        ],
        synonyms=['income before taxes', 'pretax income', 'earnings before taxes'],
    ),
    MetricMapping(
        normalized_metric='income_tax_expense',
        display_name='Income Tax Expense',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:IncomeTaxExpenseBenefit',
            'us-gaap:IncomeTaxesPaidNet',
        ],
        synonyms=['income tax expense', 'provision for income taxes', 'tax expense'],
    ),
    MetricMapping(
        normalized_metric='net_income',
        display_name='Net Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NetIncomeLoss',
            'us-gaap:ProfitLoss',
            'us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic',
        ],
        synonyms=['net income', 'net earnings', 'net profit', 'net loss'],
    ),
    MetricMapping(
        normalized_metric='earnings_per_share_basic',
        display_name='Basic EPS',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:EarningsPerShareBasic',
            'us-gaap:IncomeLossFromContinuingOperationsPerBasicShare',
        ],
        synonyms=['basic eps', 'earnings per share basic'],
    ),
    MetricMapping(
        normalized_metric='earnings_per_share_diluted',
        display_name='Diluted EPS',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:EarningsPerShareDiluted',
            'us-gaap:IncomeLossFromContinuingOperationsPerDilutedShare',
        ],
        synonyms=['diluted eps', 'earnings per share diluted'],
    ),
    MetricMapping(
        normalized_metric='weighted_average_shares_basic',
        display_name='Weighted Average Shares (Basic)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:WeightedAverageNumberOfSharesOutstandingBasic',
            'us-gaap:CommonStockSharesOutstanding',
        ],
        synonyms=['weighted average shares', 'shares outstanding basic'],
    ),
    MetricMapping(
        normalized_metric='weighted_average_shares_diluted',
        display_name='Weighted Average Shares (Diluted)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding',
        ],
        synonyms=['diluted shares', 'shares outstanding diluted'],
    ),
    # Additional Income Statement Items for Comprehensive Coverage
    MetricMapping(
        normalized_metric='total_revenue',
        display_name='Total Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
            'us-gaap:Revenues',
            'us-gaap:SalesRevenueNet',
        ],
        synonyms=['total revenue', 'total revenues', 'net revenues'],
    ),
    MetricMapping(
        normalized_metric='restructuring_charges',
        display_name='Restructuring Charges',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RestructuringCharges',
            'us-gaap:RestructuringAndRelatedCostIncurredCost',
            'us-gaap:RestructuringCostsAndAssetImpairmentCharges',
            'us-gaap:BusinessExitCosts',
        ],
        synonyms=['restructuring charges', 'restructuring costs', 'exit costs'],
    ),
    MetricMapping(
        normalized_metric='merger_acquisition_costs',
        display_name='Merger & Acquisition Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:BusinessCombinationAcquisitionRelatedCosts',
            'us-gaap:MergerRelatedCosts',
        ],
        synonyms=['m&a costs', 'acquisition costs', 'merger costs'],
    ),
    MetricMapping(
        normalized_metric='litigation_settlement',
        display_name='Litigation Settlement',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:LitigationSettlementExpense',
            'us-gaap:LossContingencyLossInPeriod',
            'us-gaap:GainLossRelatedToLitigationSettlement',
        ],
        synonyms=['litigation settlement', 'legal settlement'],
    ),
    MetricMapping(
        normalized_metric='gain_loss_on_sale_of_assets',
        display_name='Gain (Loss) on Sale of Assets',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:GainLossOnSaleOfPropertyPlantEquipment',
            'us-gaap:GainLossOnDispositionOfAssets',
            'us-gaap:GainLossOnSaleOfBusiness',
        ],
        synonyms=['gain on sale', 'loss on sale', 'disposal gain'],
    ),
    MetricMapping(
        normalized_metric='equity_method_income',
        display_name='Equity Method Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:IncomeLossFromEquityMethodInvestments',
            'us-gaap:EquityMethodInvestmentRealizedGainLossOnDisposal',
        ],
        synonyms=['equity method income', 'equity in earnings'],
    ),
    MetricMapping(
        normalized_metric='foreign_exchange_gain_loss',
        display_name='Foreign Exchange Gain (Loss)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ForeignCurrencyTransactionGainLossBeforeTax',
            'us-gaap:GainLossOnForeignCurrencyDerivativeInstrumentsNotDesignatedAsHedgingInstruments',
        ],
        synonyms=['foreign exchange gain', 'fx gain loss', 'currency gain loss'],
    ),
    MetricMapping(
        normalized_metric='dividend_income',
        display_name='Dividend Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:DividendIncomeOperating',
            'us-gaap:InvestmentIncomeDividend',
        ],
        synonyms=['dividend income', 'dividends received'],
    ),
    MetricMapping(
        normalized_metric='gain_loss_on_investments',
        display_name='Gain (Loss) on Investments',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:GainLossOnInvestments',
            'us-gaap:UnrealizedGainLossOnInvestments',
            'us-gaap:RealizedInvestmentGainsLosses',
            'us-gaap:GainLossOnSaleOfInvestments',
        ],
        synonyms=['investment gain', 'investment loss', 'securities gain loss'],
    ),
    MetricMapping(
        normalized_metric='income_from_continuing_operations',
        display_name='Income from Continuing Operations',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:IncomeLossFromContinuingOperations',
            'us-gaap:IncomeLossFromContinuingOperationsIncludingPortionAttributableToNoncontrollingInterest',
        ],
        synonyms=['income from continuing operations', 'continuing operations income'],
    ),
    MetricMapping(
        normalized_metric='net_income_attributable_to_parent',
        display_name='Net Income Attributable to Parent',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic',
            'us-gaap:NetIncomeLossAttributableToParent',
        ],
        synonyms=['net income attributable to parent', 'net income to common'],
    ),
    MetricMapping(
        normalized_metric='dividends_per_share',
        display_name='Dividends Per Share',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CommonStockDividendsPerShareDeclared',
            'us-gaap:CommonStockDividendsPerShareCashPaid',
        ],
        synonyms=['dividends per share', 'dps'],
    ),
]


# ============ BALANCE SHEET METRICS ============
BALANCE_SHEET_MAPPINGS = [
    MetricMapping(
        normalized_metric='cash_and_equivalents',
        display_name='Cash and Cash Equivalents',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:CashAndCashEquivalentsAtCarryingValue',
            'us-gaap:Cash',
            'us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
        ],
        synonyms=['cash and cash equivalents', 'cash'],
    ),
    MetricMapping(
        normalized_metric='marketable_securities',
        display_name='Marketable Securities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:MarketableSecuritiesCurrent',
            'us-gaap:AvailableForSaleSecuritiesDebtSecuritiesCurrent',
            'us-gaap:ShortTermInvestments',
        ],
        synonyms=['marketable securities', 'short-term investments'],
    ),
    MetricMapping(
        normalized_metric='accounts_receivable',
        display_name='Accounts Receivable',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AccountsReceivableNetCurrent',
            'us-gaap:AccountsReceivableNet',
            'us-gaap:ReceivablesNetCurrent',
        ],
        synonyms=['accounts receivable', 'trade receivables', 'receivables'],
    ),
    MetricMapping(
        normalized_metric='inventory',
        display_name='Inventory',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:InventoryNet',
            'us-gaap:InventoryFinishedGoodsNetOfReserves',
        ],
        synonyms=['inventory', 'inventories'],
    ),
    MetricMapping(
        normalized_metric='current_assets',
        display_name='Total Current Assets',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:AssetsCurrent'],
        synonyms=['current assets', 'total current assets'],
    ),
    MetricMapping(
        normalized_metric='property_plant_equipment',
        display_name='Property, Plant & Equipment',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:PropertyPlantAndEquipmentNet',
            'us-gaap:PropertyPlantAndEquipmentGross',
        ],
        synonyms=['property plant and equipment', 'pp&e', 'fixed assets'],
    ),
    MetricMapping(
        normalized_metric='goodwill',
        display_name='Goodwill',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:Goodwill'],
        synonyms=['goodwill'],
    ),
    MetricMapping(
        normalized_metric='intangible_assets',
        display_name='Intangible Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:IntangibleAssetsNetExcludingGoodwill',
            'us-gaap:FiniteLivedIntangibleAssetsNet',
        ],
        synonyms=['intangible assets', 'other intangible assets'],
    ),
    MetricMapping(
        normalized_metric='total_assets',
        display_name='Total Assets',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:Assets'],
        synonyms=['total assets', 'assets'],
    ),
    MetricMapping(
        normalized_metric='accounts_payable',
        display_name='Accounts Payable',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AccountsPayableCurrent',
            'us-gaap:AccountsPayableAndAccruedLiabilitiesCurrent',
        ],
        synonyms=['accounts payable', 'trade payables'],
    ),
    MetricMapping(
        normalized_metric='accrued_liabilities',
        display_name='Accrued Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AccruedLiabilitiesCurrent',
            'us-gaap:OtherAccruedLiabilitiesCurrent',
        ],
        synonyms=['accrued liabilities', 'accrued expenses'],
    ),
    MetricMapping(
        normalized_metric='deferred_revenue',
        display_name='Deferred Revenue',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:DeferredRevenueCurrent',
            'us-gaap:ContractWithCustomerLiabilityCurrent',
        ],
        synonyms=['deferred revenue', 'unearned revenue', 'contract liabilities'],
    ),
    MetricMapping(
        normalized_metric='current_liabilities',
        display_name='Total Current Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:LiabilitiesCurrent'],
        synonyms=['current liabilities', 'total current liabilities'],
    ),
    MetricMapping(
        normalized_metric='long_term_debt',
        display_name='Long-term Debt',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:LongTermDebtNoncurrent',
            'us-gaap:LongTermDebt',
            'us-gaap:LongTermDebtAndCapitalLeaseObligations',
        ],
        synonyms=['long-term debt', 'term debt', 'non-current debt'],
    ),
    MetricMapping(
        normalized_metric='total_liabilities',
        display_name='Total Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:Liabilities',
            'us-gaap:LiabilitiesNoncurrent',  # Some companies only report this
        ],
        synonyms=['total liabilities', 'liabilities'],
    ),
    MetricMapping(
        normalized_metric='liabilities_and_equity',
        display_name='Total Liabilities and Equity',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:LiabilitiesAndStockholdersEquity'],
        synonyms=['total liabilities and equity', 'liabilities and stockholders equity'],
    ),
    MetricMapping(
        normalized_metric='common_stock',
        display_name='Common Stock',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:CommonStockValue',
            'us-gaap:CommonStocksIncludingAdditionalPaidInCapital',
        ],
        synonyms=['common stock', 'common shares'],
    ),
    MetricMapping(
        normalized_metric='additional_paid_in_capital',
        display_name='Additional Paid-in Capital',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AdditionalPaidInCapital',
            'us-gaap:AdditionalPaidInCapitalCommonStock',
        ],
        synonyms=['additional paid-in capital', 'apic'],
    ),
    MetricMapping(
        normalized_metric='retained_earnings',
        display_name='Retained Earnings',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:RetainedEarningsAccumulatedDeficit'],
        synonyms=['retained earnings', 'accumulated deficit'],
    ),
    MetricMapping(
        normalized_metric='accumulated_other_comprehensive_income',
        display_name='Accumulated Other Comprehensive Income',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:AccumulatedOtherComprehensiveIncomeLossNetOfTax'],
        synonyms=['accumulated other comprehensive income', 'aoci'],
    ),
    MetricMapping(
        normalized_metric='shareholders_equity',
        display_name='Total Shareholders Equity',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:StockholdersEquity',
            'us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
        ],
        synonyms=['shareholders equity', 'stockholders equity', 'total equity'],
    ),
    # Additional Balance Sheet Items for Comprehensive Coverage
    MetricMapping(
        normalized_metric='cash_and_short_term_investments',
        display_name='Cash and Short-term Investments',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:CashCashEquivalentsAndShortTermInvestments',
            'us-gaap:CashAndCashEquivalentsAtCarryingValueIncludingDiscontinuedOperations',
        ],
        synonyms=['cash and short-term investments', 'total cash'],
    ),
    MetricMapping(
        normalized_metric='notes_receivable',
        display_name='Notes Receivable',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:NotesReceivableNet',
            'us-gaap:FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss',
        ],
        synonyms=['notes receivable', 'loans receivable'],
    ),
    MetricMapping(
        normalized_metric='contract_assets',
        display_name='Contract Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:ContractWithCustomerAssetNetCurrent',
            'us-gaap:ContractWithCustomerAssetNet',
        ],
        synonyms=['contract assets', 'unbilled receivables'],
    ),
    MetricMapping(
        normalized_metric='income_taxes_receivable',
        display_name='Income Taxes Receivable',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:IncomeTaxesReceivable',
            'us-gaap:IncomeTaxReceivable',
        ],
        synonyms=['income taxes receivable', 'tax refund receivable'],
    ),
    MetricMapping(
        normalized_metric='assets_held_for_sale',
        display_name='Assets Held for Sale',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AssetsHeldForSaleNotPartOfDisposalGroupCurrent',
            'us-gaap:AssetsOfDisposalGroupIncludingDiscontinuedOperation',
        ],
        synonyms=['assets held for sale', 'disposal group assets'],
    ),
    MetricMapping(
        normalized_metric='operating_lease_right_of_use_assets',
        display_name='Operating Lease Right-of-Use Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:OperatingLeaseRightOfUseAsset',
            'us-gaap:RightOfUseAssetObtainedInExchangeForOperatingLeaseLiability',
        ],
        synonyms=['operating lease rou assets', 'right of use assets'],
    ),
    MetricMapping(
        normalized_metric='finance_lease_right_of_use_assets',
        display_name='Finance Lease Right-of-Use Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FinanceLeaseRightOfUseAsset',
            'us-gaap:RightOfUseAssetObtainedInExchangeForFinanceLeaseLiability',
        ],
        synonyms=['finance lease rou assets', 'capital lease assets'],
    ),
    MetricMapping(
        normalized_metric='equity_method_investments',
        display_name='Equity Method Investments',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:EquityMethodInvestments',
            'us-gaap:InvestmentsInAffiliatesSubsidiariesAssociatesAndJointVentures',
        ],
        synonyms=['equity method investments', 'investments in affiliates'],
    ),
    MetricMapping(
        normalized_metric='long_term_investments',
        display_name='Long-term Investments',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:LongTermInvestments',
            'us-gaap:MarketableSecuritiesNoncurrent',
            'us-gaap:AvailableForSaleSecuritiesDebtSecuritiesNoncurrent',
        ],
        synonyms=['long-term investments', 'non-current investments'],
    ),
    MetricMapping(
        normalized_metric='accumulated_depreciation',
        display_name='Accumulated Depreciation',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment',
            'us-gaap:PropertyPlantAndEquipmentAccumulatedDepreciation',
        ],
        synonyms=['accumulated depreciation', 'accumulated d&a'],
    ),
    MetricMapping(
        normalized_metric='land',
        display_name='Land',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:Land',
            'us-gaap:LandAndLandImprovements',
        ],
        synonyms=['land', 'land and improvements'],
    ),
    MetricMapping(
        normalized_metric='buildings',
        display_name='Buildings',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:BuildingsAndImprovementsGross',
            'us-gaap:BuildingAndBuildingImprovements',
        ],
        synonyms=['buildings', 'buildings and improvements'],
    ),
    MetricMapping(
        normalized_metric='machinery_and_equipment',
        display_name='Machinery and Equipment',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:MachineryAndEquipmentGross',
            'us-gaap:FurnitureAndFixturesGross',
        ],
        synonyms=['machinery and equipment', 'equipment'],
    ),
    MetricMapping(
        normalized_metric='construction_in_progress',
        display_name='Construction in Progress',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:ConstructionInProgressGross',
            'us-gaap:CapitalizedComputerSoftwareGross',
        ],
        synonyms=['construction in progress', 'cip'],
    ),
    MetricMapping(
        normalized_metric='indefinite_lived_intangibles',
        display_name='Indefinite-lived Intangible Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:IndefiniteLivedIntangibleAssetsExcludingGoodwill',
            'us-gaap:IndefiniteLivedTrademarks',
        ],
        synonyms=['indefinite-lived intangibles', 'indefinite intangibles'],
    ),
    MetricMapping(
        normalized_metric='finite_lived_intangibles',
        display_name='Finite-lived Intangible Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FiniteLivedIntangibleAssetsNet',
            'us-gaap:FiniteLivedIntangibleAssetsGross',
        ],
        synonyms=['finite-lived intangibles', 'amortizable intangibles'],
    ),
    MetricMapping(
        normalized_metric='customer_relationships',
        display_name='Customer Relationships',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FiniteLivedCustomerRelationshipsGross',
            'us-gaap:CustomerRelationshipsMember',
        ],
        synonyms=['customer relationships', 'customer lists'],
    ),
    MetricMapping(
        normalized_metric='patents_and_technology',
        display_name='Patents and Technology',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FiniteLivedPatentsGross',
            'us-gaap:TechnologyBasedIntangibleAssetsMember',
        ],
        synonyms=['patents', 'technology', 'developed technology'],
    ),
    MetricMapping(
        normalized_metric='trademarks_and_trade_names',
        display_name='Trademarks and Trade Names',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FiniteLivedTrademarksGross',
            'us-gaap:TradeNamesMember',
        ],
        synonyms=['trademarks', 'trade names', 'brand names'],
    ),
    MetricMapping(
        normalized_metric='noncurrent_assets',
        display_name='Total Noncurrent Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AssetsNoncurrent',
            'us-gaap:NoncurrentAssets',
        ],
        synonyms=['noncurrent assets', 'long-term assets'],
    ),
    MetricMapping(
        normalized_metric='commercial_paper',
        display_name='Commercial Paper',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:CommercialPaper',
            'us-gaap:ShortTermBorrowingsCommercialPaper',
        ],
        synonyms=['commercial paper', 'cp'],
    ),
    MetricMapping(
        normalized_metric='current_portion_long_term_debt',
        display_name='Current Portion of Long-term Debt',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:LongTermDebtCurrent',
            'us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent',
        ],
        synonyms=['current portion of long-term debt', 'current maturities'],
    ),
    MetricMapping(
        normalized_metric='accrued_compensation',
        display_name='Accrued Compensation',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:EmployeeRelatedLiabilitiesCurrent',
            'us-gaap:AccruedSalariesCurrent',
        ],
        synonyms=['accrued compensation', 'accrued payroll'],
    ),
    MetricMapping(
        normalized_metric='income_taxes_payable',
        display_name='Income Taxes Payable',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AccruedIncomeTaxesCurrent',
            'us-gaap:TaxesPayableCurrent',
        ],
        synonyms=['income taxes payable', 'taxes payable'],
    ),
    MetricMapping(
        normalized_metric='dividends_payable',
        display_name='Dividends Payable',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:DividendsPayableCurrent',
            'us-gaap:DividendsPayable',
        ],
        synonyms=['dividends payable', 'declared dividends'],
    ),
    MetricMapping(
        normalized_metric='contract_liabilities',
        display_name='Contract Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:ContractWithCustomerLiabilityCurrent',
            'us-gaap:ContractWithCustomerLiability',
        ],
        synonyms=['contract liabilities', 'deferred revenue'],
    ),
    MetricMapping(
        normalized_metric='operating_lease_liabilities_current',
        display_name='Operating Lease Liabilities (Current)',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:OperatingLeaseLiabilityCurrent',
        ],
        synonyms=['operating lease liabilities current', 'current lease obligations'],
    ),
    MetricMapping(
        normalized_metric='operating_lease_liabilities_noncurrent',
        display_name='Operating Lease Liabilities (Noncurrent)',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:OperatingLeaseLiabilityNoncurrent',
        ],
        synonyms=['operating lease liabilities noncurrent', 'long-term lease obligations'],
    ),
    MetricMapping(
        normalized_metric='finance_lease_liabilities',
        display_name='Finance Lease Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FinanceLeaseLiability',
            'us-gaap:CapitalLeaseObligations',
        ],
        synonyms=['finance lease liabilities', 'capital lease obligations'],
    ),
    MetricMapping(
        normalized_metric='pension_liabilities',
        display_name='Pension Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:DefinedBenefitPensionPlanLiabilitiesNoncurrent',
            'us-gaap:PensionAndOtherPostretirementDefinedBenefitPlansLiabilitiesNoncurrent',
        ],
        synonyms=['pension liabilities', 'pension obligations'],
    ),
    MetricMapping(
        normalized_metric='postretirement_benefits',
        display_name='Postretirement Benefits',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:OtherPostretirementDefinedBenefitPlanLiabilitiesNoncurrent',
            'us-gaap:PostemploymentBenefitsLiabilityNoncurrent',
        ],
        synonyms=['postretirement benefits', 'opeb liabilities'],
    ),
    MetricMapping(
        normalized_metric='deferred_revenue_noncurrent',
        display_name='Deferred Revenue (Noncurrent)',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:DeferredRevenueNoncurrent',
            'us-gaap:ContractWithCustomerLiabilityNoncurrent',
        ],
        synonyms=['deferred revenue noncurrent', 'long-term deferred revenue'],
    ),
    MetricMapping(
        normalized_metric='asset_retirement_obligations',
        display_name='Asset Retirement Obligations',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AssetRetirementObligationsNoncurrent',
            'us-gaap:AssetRetirementObligation',
        ],
        synonyms=['asset retirement obligations', 'aro'],
    ),
    MetricMapping(
        normalized_metric='contingent_liabilities',
        display_name='Contingent Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:LossContingencyAccrualAtCarryingValue',
            'us-gaap:LitigationReserve',
        ],
        synonyms=['contingent liabilities', 'litigation reserves'],
    ),
    MetricMapping(
        normalized_metric='preferred_stock',
        display_name='Preferred Stock',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:PreferredStockValue',
            'us-gaap:PreferredStockValueOutstanding',
        ],
        synonyms=['preferred stock', 'preferred shares'],
    ),
    MetricMapping(
        normalized_metric='noncontrolling_interests',
        display_name='Noncontrolling Interests',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:MinorityInterest',
            'us-gaap:RedeemableNoncontrollingInterestEquityCarryingAmount',
        ],
        synonyms=['noncontrolling interests', 'minority interest'],
    ),
    MetricMapping(
        normalized_metric='total_equity',
        display_name='Total Equity',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
            'us-gaap:Equity',
        ],
        synonyms=['total equity', 'total stockholders equity'],
    ),
]


# ============ CASH FLOW STATEMENT METRICS ============
CASH_FLOW_MAPPINGS = [
    MetricMapping(
        normalized_metric='operating_cash_flow',
        display_name='Operating Cash Flow',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:NetCashProvidedByUsedInOperatingActivities',
            'us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
        ],
        synonyms=['operating cash flow', 'cash from operations'],
    ),
    MetricMapping(
        normalized_metric='investing_cash_flow',
        display_name='Investing Cash Flow',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:NetCashProvidedByUsedInInvestingActivities',
            'us-gaap:NetCashProvidedByUsedInInvestingActivitiesContinuingOperations',
        ],
        synonyms=['investing cash flow', 'cash from investing'],
    ),
    MetricMapping(
        normalized_metric='financing_cash_flow',
        display_name='Financing Cash Flow',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:NetCashProvidedByUsedInFinancingActivities',
            'us-gaap:NetCashProvidedByUsedInFinancingActivitiesContinuingOperations',
        ],
        synonyms=['financing cash flow', 'cash from financing'],
    ),
    MetricMapping(
        normalized_metric='depreciation_amortization',
        display_name='Depreciation & Amortization',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:DepreciationDepletionAndAmortization',
            'us-gaap:DepreciationAndAmortization',
            'us-gaap:Depreciation',
        ],
        synonyms=['depreciation and amortization', 'd&a'],
    ),
    MetricMapping(
        normalized_metric='capital_expenditures',
        display_name='Capital Expenditures',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment',
            'us-gaap:PaymentsToAcquireProductiveAssets',
        ],
        synonyms=['capital expenditures', 'capex'],
    ),
    MetricMapping(
        normalized_metric='stock_based_compensation',
        display_name='Stock-Based Compensation',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ShareBasedCompensation',
            'us-gaap:AllocatedShareBasedCompensationExpense',
        ],
        synonyms=['stock-based compensation', 'share-based compensation'],
    ),
    MetricMapping(
        normalized_metric='dividends_paid',
        display_name='Dividends Paid',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsOfDividendsCommonStock',
            'us-gaap:PaymentsOfDividends',
        ],
        synonyms=['dividends paid', 'cash dividends'],
    ),
    MetricMapping(
        normalized_metric='share_repurchases',
        display_name='Share Repurchases',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsForRepurchaseOfCommonStock',
            'us-gaap:PaymentsForRepurchaseOfEquity',
        ],
        synonyms=['share repurchases', 'stock buybacks'],
    ),
    # Additional Cash Flow Items for Comprehensive Coverage
    # Operating Activities - Reconciliation Items
    MetricMapping(
        normalized_metric='accounts_receivable_change',
        display_name='Change in Accounts Receivable',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncreaseDecreaseInAccountsReceivable',
            'us-gaap:IncreaseDecreaseInReceivables',
        ],
        synonyms=['change in accounts receivable', 'receivables change'],
    ),
    MetricMapping(
        normalized_metric='inventory_change',
        display_name='Change in Inventory',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncreaseDecreaseInInventories',
            'us-gaap:IncreaseDecreaseInRetailRelatedInventories',
        ],
        synonyms=['change in inventory', 'inventory change'],
    ),
    MetricMapping(
        normalized_metric='accounts_payable_change',
        display_name='Change in Accounts Payable',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncreaseDecreaseInAccountsPayable',
            'us-gaap:IncreaseDecreaseInAccountsPayableAndAccruedLiabilities',
        ],
        synonyms=['change in accounts payable', 'payables change'],
    ),
    MetricMapping(
        normalized_metric='accrued_liabilities_change',
        display_name='Change in Accrued Liabilities',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncreaseDecreaseInAccruedLiabilities',
            'us-gaap:IncreaseDecreaseInOtherAccruedLiabilities',
        ],
        synonyms=['change in accrued liabilities', 'accrued expenses change'],
    ),
    MetricMapping(
        normalized_metric='deferred_revenue_change',
        display_name='Change in Deferred Revenue',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncreaseDecreaseInDeferredRevenue',
            'us-gaap:IncreaseDecreaseInContractWithCustomerLiability',
        ],
        synonyms=['change in deferred revenue', 'deferred revenue change'],
    ),
    MetricMapping(
        normalized_metric='prepaid_expenses_change',
        display_name='Change in Prepaid Expenses',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncreaseDecreaseInPrepaidExpense',
            'us-gaap:IncreaseDecreaseInPrepaidDeferredExpenseAndOtherAssets',
        ],
        synonyms=['change in prepaid expenses', 'prepaid change'],
    ),
    MetricMapping(
        normalized_metric='income_taxes_change',
        display_name='Change in Income Taxes',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncreaseDecreaseInAccruedIncomeTaxesPayable',
            'us-gaap:IncreaseDecreaseInIncomeTaxesPayableNetOfIncomeTaxesReceivable',
        ],
        synonyms=['change in income taxes', 'taxes payable change'],
    ),
    MetricMapping(
        normalized_metric='other_operating_activities',
        display_name='Other Operating Activities',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:OtherOperatingActivitiesCashFlowStatement',
            'us-gaap:IncreaseDecreaseInOtherOperatingAssets',
            'us-gaap:IncreaseDecreaseInOtherOperatingLiabilities',
        ],
        synonyms=['other operating activities', 'other operating'],
    ),
    MetricMapping(
        normalized_metric='gain_loss_on_sale_of_assets_cf',
        display_name='Gain/Loss on Sale of Assets',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:GainLossOnSaleOfPropertyPlantEquipment',
            'us-gaap:GainLossOnDispositionOfAssets1',
        ],
        synonyms=['gain loss on sale', 'asset disposal gain loss'],
    ),
    MetricMapping(
        normalized_metric='impairment_charges_cf',
        display_name='Impairment Charges',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:AssetImpairmentCharges',
            'us-gaap:GoodwillImpairmentLoss',
            'us-gaap:ImpairmentOfLongLivedAssetsHeldForUse',
        ],
        synonyms=['impairment charges', 'asset impairment'],
    ),
    MetricMapping(
        normalized_metric='equity_method_income_cf',
        display_name='Equity Method Income (Cash Flow)',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncomeLossFromEquityMethodInvestments',
            'us-gaap:IncomeLossFromEquityMethodInvestmentsNetOfDividendsOrDistributions',
        ],
        synonyms=['equity method income', 'equity in earnings'],
    ),
    MetricMapping(
        normalized_metric='deferred_income_taxes_cf',
        display_name='Deferred Income Taxes',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:DeferredIncomeTaxExpenseBenefit',
            'us-gaap:DeferredIncomeTaxesAndTaxCredits',
        ],
        synonyms=['deferred income taxes', 'deferred tax expense'],
    ),
    # Investing Activities
    MetricMapping(
        normalized_metric='purchases_of_investments',
        display_name='Purchases of Investments',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsToAcquireMarketableSecurities',
            'us-gaap:PaymentsToAcquireAvailableForSaleSecuritiesDebt',
            'us-gaap:PaymentsToAcquireInvestments',
        ],
        synonyms=['purchases of investments', 'investment purchases'],
    ),
    MetricMapping(
        normalized_metric='proceeds_from_investments',
        display_name='Proceeds from Investments',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromSaleAndMaturityOfMarketableSecurities',
            'us-gaap:ProceedsFromSaleOfAvailableForSaleSecuritiesDebt',
            'us-gaap:ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities',
        ],
        synonyms=['proceeds from investments', 'investment proceeds'],
    ),
    MetricMapping(
        normalized_metric='maturities_of_investments',
        display_name='Maturities of Investments',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities',
            'us-gaap:ProceedsFromMaturitiesPrepaymentsAndCallsOfHeldToMaturitySecurities',
        ],
        synonyms=['maturities of investments', 'investment maturities'],
    ),
    MetricMapping(
        normalized_metric='acquisitions_net_of_cash',
        display_name='Acquisitions, Net of Cash',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsToAcquireBusinessesNetOfCashAcquired',
            'us-gaap:PaymentsToAcquireBusinessesGross',
        ],
        synonyms=['acquisitions net of cash', 'business acquisitions'],
    ),
    MetricMapping(
        normalized_metric='proceeds_from_divestitures',
        display_name='Proceeds from Divestitures',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromDivestitureOfBusinesses',
            'us-gaap:ProceedsFromDivestitureOfBusinessesNetOfCashDivested',
        ],
        synonyms=['proceeds from divestitures', 'divestiture proceeds'],
    ),
    MetricMapping(
        normalized_metric='purchases_of_intangibles',
        display_name='Purchases of Intangibles',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsToAcquireIntangibleAssets',
            'us-gaap:PaymentsToAcquireOtherProductiveAssets',
        ],
        synonyms=['purchases of intangibles', 'intangible asset purchases'],
    ),
    MetricMapping(
        normalized_metric='proceeds_from_sale_of_ppe',
        display_name='Proceeds from Sale of PP&E',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromSaleOfPropertyPlantAndEquipment',
            'us-gaap:ProceedsFromSaleOfProductiveAssets',
        ],
        synonyms=['proceeds from sale of ppe', 'asset sale proceeds'],
    ),
    MetricMapping(
        normalized_metric='other_investing_activities',
        display_name='Other Investing Activities',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsForProceedsFromOtherInvestingActivities',
            'us-gaap:OtherInvestingActivitiesCashFlowStatement',
        ],
        synonyms=['other investing activities', 'other investing'],
    ),
    # Financing Activities
    MetricMapping(
        normalized_metric='proceeds_from_debt_issuance',
        display_name='Proceeds from Debt Issuance',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromIssuanceOfLongTermDebt',
            'us-gaap:ProceedsFromDebtNetOfIssuanceCosts',
            'us-gaap:ProceedsFromIssuanceOfDebt',
        ],
        synonyms=['proceeds from debt issuance', 'debt proceeds'],
    ),
    MetricMapping(
        normalized_metric='repayments_of_debt',
        display_name='Repayments of Debt',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:RepaymentsOfLongTermDebt',
            'us-gaap:RepaymentsOfDebt',
            'us-gaap:RepaymentsOfLongTermDebtAndCapitalSecurities',
        ],
        synonyms=['repayments of debt', 'debt repayments'],
    ),
    MetricMapping(
        normalized_metric='proceeds_from_short_term_debt',
        display_name='Proceeds from Short-term Debt',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromShortTermDebt',
            'us-gaap:ProceedsFromRepaymentsOfShortTermDebt',
        ],
        synonyms=['proceeds from short-term debt', 'short-term borrowings'],
    ),
    MetricMapping(
        normalized_metric='repayments_of_short_term_debt',
        display_name='Repayments of Short-term Debt',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:RepaymentsOfShortTermDebt',
            'us-gaap:RepaymentsOfCommercialPaper',
        ],
        synonyms=['repayments of short-term debt', 'short-term debt repayments'],
    ),
    MetricMapping(
        normalized_metric='proceeds_from_stock_issuance',
        display_name='Proceeds from Stock Issuance',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromIssuanceOfCommonStock',
            'us-gaap:ProceedsFromIssuanceOrSaleOfEquity',
            'us-gaap:ProceedsFromStockOptionsExercised',
        ],
        synonyms=['proceeds from stock issuance', 'stock issuance proceeds'],
    ),
    MetricMapping(
        normalized_metric='payments_for_taxes_on_stock_compensation',
        display_name='Payments for Taxes on Stock Compensation',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsRelatedToTaxWithholdingForShareBasedCompensation',
            'us-gaap:PaymentsForRepurchaseOfEquityInstrumentsToSatisfyEmployeeTaxWithholdingObligations',
        ],
        synonyms=['tax payments on stock compensation', 'withholding taxes'],
    ),
    MetricMapping(
        normalized_metric='dividends_paid_to_noncontrolling',
        display_name='Dividends Paid to Noncontrolling Interests',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsOfDividendsMinorityInterest',
            'us-gaap:PaymentsToMinorityShareholders',
        ],
        synonyms=['dividends to noncontrolling', 'minority dividends'],
    ),
    MetricMapping(
        normalized_metric='debt_issuance_costs',
        display_name='Debt Issuance Costs',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:PaymentsOfDebtIssuanceCosts',
            'us-gaap:PaymentsOfFinancingCosts',
        ],
        synonyms=['debt issuance costs', 'financing costs'],
    ),
    MetricMapping(
        normalized_metric='other_financing_activities',
        display_name='Other Financing Activities',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:ProceedsFromPaymentsForOtherFinancingActivities',
            'us-gaap:OtherFinancingActivitiesCashFlowStatement',
        ],
        synonyms=['other financing activities', 'other financing'],
    ),
    # Summary Items
    MetricMapping(
        normalized_metric='net_change_in_cash',
        display_name='Net Change in Cash',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect',
            'us-gaap:CashAndCashEquivalentsPeriodIncreaseDecrease',
        ],
        synonyms=['net change in cash', 'change in cash'],
    ),
    MetricMapping(
        normalized_metric='beginning_cash_balance',
        display_name='Beginning Cash Balance',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations',
            'us-gaap:CashAndCashEquivalentsAtCarryingValue',
        ],
        synonyms=['beginning cash balance', 'cash at beginning'],
    ),
    MetricMapping(
        normalized_metric='ending_cash_balance',
        display_name='Ending Cash Balance',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
            'us-gaap:CashAndCashEquivalentsAtCarryingValue',
        ],
        synonyms=['ending cash balance', 'cash at end'],
    ),
    MetricMapping(
        normalized_metric='effect_of_exchange_rate_on_cash',
        display_name='Effect of Exchange Rate on Cash',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
            'us-gaap:EffectOfExchangeRateOnCashAndCashEquivalents',
        ],
        synonyms=['effect of exchange rate', 'fx effect on cash'],
    ),
    # Supplemental Cash Flow Information
    MetricMapping(
        normalized_metric='cash_paid_for_interest',
        display_name='Cash Paid for Interest',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:InterestPaidNet',
            'us-gaap:InterestPaid',
        ],
        synonyms=['cash paid for interest', 'interest paid'],
    ),
    MetricMapping(
        normalized_metric='cash_paid_for_taxes',
        display_name='Cash Paid for Taxes',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:IncomeTaxesPaidNet',
            'us-gaap:IncomeTaxesPaid',
        ],
        synonyms=['cash paid for taxes', 'taxes paid'],
    ),
    MetricMapping(
        normalized_metric='free_cash_flow',
        display_name='Free Cash Flow',
        statement_type='cash_flow',
        xbrl_tags=[
            'us-gaap:FreeCashFlow',  # Rarely used directly
        ],
        synonyms=['free cash flow', 'fcf'],
    ),
]


# ============ MEDIA COMPANY MAPPINGS (CMCSA, DIS, NFLX, etc.) ============
MEDIA_COMPANY_MAPPINGS = [
    # Cost and Expense Breakdowns
    MetricMapping(
        normalized_metric='programming_and_production',
        display_name='Programming and Production',
        statement_type='income_statement',
        xbrl_tags=[
            'cmcsa:ProgrammingAndProduction',
            'cmcsa:ProgrammingAndProductionCosts',
            'us-gaap:ProgrammingCosts',
            'us-gaap:CostOfGoodsAndServicesSoldProgrammingAndProduction',
            'us-gaap:ProgramRightsAmortization',
            'dis:ProgrammingAndProductionCosts',
            'nflx:CostOfRevenues',  # Netflix uses this for content costs
        ],
        synonyms=['programming and production', 'programming costs', 'content costs'],
    ),
    MetricMapping(
        normalized_metric='marketing_and_promotion',
        display_name='Marketing and Promotion',
        statement_type='income_statement',
        xbrl_tags=[
            'cmcsa:MarketingAndPromotion',
            'us-gaap:MarketingAndAdvertisingExpense',
            'us-gaap:SellingAndMarketingExpense',
            'us-gaap:AdvertisingExpense',
            'dis:MarketingCosts',
            'nflx:MarketingExpense',
        ],
        synonyms=['marketing and promotion', 'marketing expense', 'advertising expense'],
    ),
    MetricMapping(
        normalized_metric='other_operating_and_administrative',
        display_name='Other Operating and Administrative',
        statement_type='income_statement',
        xbrl_tags=[
            'cmcsa:OtherOperatingAndAdministrative',
            'us-gaap:OtherCostAndExpenseOperating',
            'us-gaap:OtherOperatingIncomeExpenseNet',
        ],
        synonyms=['other operating and administrative', 'other operating costs'],
    ),
    MetricMapping(
        normalized_metric='depreciation',
        display_name='Depreciation',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:Depreciation',
            'us-gaap:DepreciationNonproduction',
            'us-gaap:DepreciationExpenseOnReclassifiedAssets',
        ],
        synonyms=['depreciation'],
    ),
    MetricMapping(
        normalized_metric='amortization',
        display_name='Amortization',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:AmortizationOfIntangibleAssets',
            'us-gaap:Amortization',
            'us-gaap:AmortizationOfAcquisitionCosts',
        ],
        synonyms=['amortization'],
    ),
    MetricMapping(
        normalized_metric='goodwill_and_long_lived_asset_impairments',
        display_name='Goodwill and Long-lived Asset Impairments',
        statement_type='income_statement',
        xbrl_tags=[
            'cmcsa:GoodwillAndLongLivedAssetImpairments',
            'us-gaap:GoodwillAndIntangibleAssetImpairment',
            'us-gaap:AssetImpairmentCharges',
            'us-gaap:GoodwillImpairmentLoss',
            'us-gaap:ImpairmentOfLongLivedAssetsHeldForUse',
            'dis:ImpairmentCharges',
        ],
        synonyms=['goodwill impairment', 'asset impairment', 'impairment charges'],
    ),
    # Media-specific Revenue Breakdowns
    MetricMapping(
        normalized_metric='advertising_revenue',
        display_name='Advertising Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:AdvertisingRevenue',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxAdvertising',
            'cmcsa:AdvertisingRevenue',
            'dis:AdvertisingRevenue',
            'nflx:AdvertisingRevenue',
        ],
        synonyms=['advertising revenue', 'ad revenue'],
    ),
    MetricMapping(
        normalized_metric='subscription_revenue',
        display_name='Subscription Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:SubscriptionRevenue',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxSubscription',
            'cmcsa:SubscriptionRevenue',
            'nflx:StreamingRevenue',
            'dis:SubscriptionRevenue',
        ],
        synonyms=['subscription revenue', 'streaming revenue'],
    ),
    MetricMapping(
        normalized_metric='content_licensing_revenue',
        display_name='Content Licensing Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:LicenseRevenue',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxLicensing',
            'cmcsa:ContentLicensingRevenue',
            'dis:ContentLicensingRevenue',
        ],
        synonyms=['content licensing', 'licensing revenue'],
    ),
    MetricMapping(
        normalized_metric='theme_park_revenue',
        display_name='Theme Park Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'dis:ThemeParkRevenue',
            'cmcsa:ThemeParkRevenue',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxThemePark',
        ],
        synonyms=['theme park revenue', 'parks revenue'],
    ),
]


# ============ TECH COMPANY MAPPINGS (AAPL, MSFT, GOOGL, META, etc.) ============
TECH_COMPANY_MAPPINGS = [
    # Revenue Breakdowns
    MetricMapping(
        normalized_metric='product_revenue',
        display_name='Product Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxProduct',
            'us-gaap:SalesRevenueGoodsNet',
            'us-gaap:ProductRevenue',
            'aapl:ProductsNetSales',
            'msft:ProductRevenue',
        ],
        synonyms=['product revenue', 'product sales', 'products net sales'],
    ),
    MetricMapping(
        normalized_metric='service_revenue',
        display_name='Service Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxService',
            'us-gaap:SalesRevenueServicesNet',
            'us-gaap:ServiceRevenue',
            'aapl:ServicesNetSales',
            'msft:ServiceRevenue',
            'googl:GoogleServicesRevenue',
        ],
        synonyms=['service revenue', 'services revenue', 'services net sales'],
    ),
    MetricMapping(
        normalized_metric='cloud_revenue',
        display_name='Cloud Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'msft:IntelligentCloudRevenue',
            'msft:AzureAndOtherCloudServicesRevenue',
            'googl:GoogleCloudRevenue',
            'amzn:AWSRevenue',
            'us-gaap:CloudServicesRevenue',
        ],
        synonyms=['cloud revenue', 'cloud services revenue', 'aws revenue', 'azure revenue'],
    ),
    MetricMapping(
        normalized_metric='hardware_revenue',
        display_name='Hardware Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:HardwareRevenue',
            'aapl:IPhoneNetSales',
            'aapl:MacNetSales',
            'aapl:IPadNetSales',
            'aapl:WearablesHomeAndAccessoriesNetSales',
            'msft:DevicesRevenue',
        ],
        synonyms=['hardware revenue', 'device revenue'],
    ),
    MetricMapping(
        normalized_metric='software_revenue',
        display_name='Software Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:SoftwareRevenue',
            'us-gaap:LicenseAndServicesRevenue',
            'msft:ProductivityAndBusinessProcessesRevenue',
            'msft:OfficeProductsAndCloudServicesRevenue',
        ],
        synonyms=['software revenue', 'license revenue'],
    ),
    # Tech-specific Costs
    MetricMapping(
        normalized_metric='cost_of_products',
        display_name='Cost of Products',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CostOfGoodsSoldProduct',
            'aapl:ProductsCostOfSales',
            'msft:CostOfProductRevenue',
        ],
        synonyms=['cost of products', 'product cost of sales'],
    ),
    MetricMapping(
        normalized_metric='cost_of_services',
        display_name='Cost of Services',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CostOfGoodsSoldService',
            'aapl:ServicesCostOfSales',
            'msft:CostOfServiceRevenue',
        ],
        synonyms=['cost of services', 'service cost of sales'],
    ),
    MetricMapping(
        normalized_metric='traffic_acquisition_costs',
        display_name='Traffic Acquisition Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'googl:TrafficAcquisitionCosts',
            'us-gaap:TrafficAcquisitionCosts',
        ],
        synonyms=['traffic acquisition costs', 'tac'],
    ),
    MetricMapping(
        normalized_metric='content_costs',
        display_name='Content Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'googl:ContentAcquisitionCosts',
            'us-gaap:ContentCosts',
            'nflx:CostOfRevenues',
        ],
        synonyms=['content costs', 'content acquisition costs'],
    ),
]


# ============ RETAIL COMPANY MAPPINGS (WMT, AMZN, TGT, COST, etc.) ============
RETAIL_COMPANY_MAPPINGS = [
    # Revenue Breakdowns
    MetricMapping(
        normalized_metric='net_sales',
        display_name='Net Sales',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:SalesRevenueNet',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
            'wmt:NetSales',
            'tgt:SalesRevenue',
            'cost:NetSales',
        ],
        synonyms=['net sales', 'sales revenue'],
    ),
    MetricMapping(
        normalized_metric='membership_revenue',
        display_name='Membership Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:MembershipDuesRevenue',
            'cost:MembershipFees',
            'wmt:MembershipAndOtherIncome',
        ],
        synonyms=['membership revenue', 'membership fees'],
    ),
    MetricMapping(
        normalized_metric='online_sales',
        display_name='Online Sales',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxEcommerce',
            'amzn:OnlineStoresRevenue',
            'wmt:EcommerceNetSales',
        ],
        synonyms=['online sales', 'e-commerce revenue'],
    ),
    MetricMapping(
        normalized_metric='physical_stores_revenue',
        display_name='Physical Stores Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'amzn:PhysicalStoresRevenue',
            'us-gaap:RetailRevenue',
        ],
        synonyms=['physical stores revenue', 'retail revenue'],
    ),
    MetricMapping(
        normalized_metric='third_party_seller_services',
        display_name='Third-Party Seller Services',
        statement_type='income_statement',
        xbrl_tags=[
            'amzn:ThirdPartySellerServicesRevenue',
            'us-gaap:CommissionRevenue',
        ],
        synonyms=['third-party seller services', 'marketplace revenue'],
    ),
    # Retail-specific Costs
    MetricMapping(
        normalized_metric='fulfillment_costs',
        display_name='Fulfillment Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'amzn:FulfillmentExpense',
            'us-gaap:FulfillmentCosts',
            'us-gaap:ShippingHandlingAndTransportationCosts',
        ],
        synonyms=['fulfillment costs', 'fulfillment expense'],
    ),
    MetricMapping(
        normalized_metric='technology_and_content',
        display_name='Technology and Content',
        statement_type='income_statement',
        xbrl_tags=[
            'amzn:TechnologyAndContentExpense',
            'us-gaap:TechnologyExpense',
        ],
        synonyms=['technology and content', 'technology expense'],
    ),
]


# ============ HEALTHCARE COMPANY MAPPINGS (JNJ, PFE, UNH, etc.) ============
HEALTHCARE_COMPANY_MAPPINGS = [
    # Revenue Breakdowns
    MetricMapping(
        normalized_metric='pharmaceutical_revenue',
        display_name='Pharmaceutical Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PharmaceuticalRevenue',
            'jnj:PharmaceuticalSales',
            'pfe:BiopharmaceuticalRevenue',
        ],
        synonyms=['pharmaceutical revenue', 'pharma sales'],
    ),
    MetricMapping(
        normalized_metric='medical_devices_revenue',
        display_name='Medical Devices Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:MedicalDeviceRevenue',
            'jnj:MedicalDevicesSales',
        ],
        synonyms=['medical devices revenue', 'medtech revenue'],
    ),
    MetricMapping(
        normalized_metric='consumer_health_revenue',
        display_name='Consumer Health Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'jnj:ConsumerHealthSales',
            'us-gaap:ConsumerProductsRevenue',
        ],
        synonyms=['consumer health revenue', 'consumer products revenue'],
    ),
    MetricMapping(
        normalized_metric='premium_revenue',
        display_name='Premium Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PremiumsEarnedNet',
            'us-gaap:InsurancePremiumsRevenue',
            'unh:PremiumRevenue',
        ],
        synonyms=['premium revenue', 'insurance premiums'],
    ),
    MetricMapping(
        normalized_metric='medical_costs',
        display_name='Medical Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PolicyholderBenefitsAndClaimsIncurredNet',
            'us-gaap:MedicalCostsAndExpenses',
            'unh:MedicalCosts',
        ],
        synonyms=['medical costs', 'claims expense'],
    ),
    MetricMapping(
        normalized_metric='acquired_iprd',
        display_name='Acquired In-Process R&D',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ResearchAndDevelopmentInProcess',
            'us-gaap:AcquiredInProcessResearchAndDevelopment',
        ],
        synonyms=['acquired iprd', 'in-process r&d'],
    ),
]


# ============ ENERGY COMPANY MAPPINGS (XOM, CVX, etc.) ============
ENERGY_COMPANY_MAPPINGS = [
    # Revenue Breakdowns
    MetricMapping(
        normalized_metric='upstream_revenue',
        display_name='Upstream Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'xom:UpstreamRevenue',
            'cvx:UpstreamRevenue',
            'us-gaap:OilAndGasRevenue',
        ],
        synonyms=['upstream revenue', 'exploration and production revenue'],
    ),
    MetricMapping(
        normalized_metric='downstream_revenue',
        display_name='Downstream Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'xom:DownstreamRevenue',
            'cvx:DownstreamRevenue',
            'us-gaap:RefinedProductsRevenue',
        ],
        synonyms=['downstream revenue', 'refining revenue'],
    ),
    MetricMapping(
        normalized_metric='chemical_revenue',
        display_name='Chemical Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'xom:ChemicalRevenue',
            'us-gaap:ChemicalProductsRevenue',
        ],
        synonyms=['chemical revenue', 'chemicals revenue'],
    ),
    # Energy-specific Costs
    MetricMapping(
        normalized_metric='exploration_expenses',
        display_name='Exploration Expenses',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ExplorationExpense',
            'us-gaap:OilAndGasExplorationExpense',
            'xom:ExplorationExpenses',
        ],
        synonyms=['exploration expenses', 'exploration costs'],
    ),
    MetricMapping(
        normalized_metric='production_costs',
        display_name='Production Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ProductionCosts',
            'us-gaap:OilAndGasProductionExpense',
            'xom:ProductionAndManufacturingExpenses',
        ],
        synonyms=['production costs', 'lifting costs'],
    ),
    MetricMapping(
        normalized_metric='depletion_expense',
        display_name='Depletion Expense',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:Depletion',
            'us-gaap:DepletionOfOilAndGasProperties',
        ],
        synonyms=['depletion expense', 'depletion'],
    ),
]


# ============ INDUSTRIAL COMPANY MAPPINGS (GE, CAT, BA, etc.) ============
INDUSTRIAL_COMPANY_MAPPINGS = [
    # Revenue Breakdowns
    MetricMapping(
        normalized_metric='equipment_revenue',
        display_name='Equipment Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:EquipmentRevenue',
            'cat:MachineryEnergyAndTransportationRevenue',
            'ge:EquipmentRevenue',
        ],
        synonyms=['equipment revenue', 'machinery revenue'],
    ),
    MetricMapping(
        normalized_metric='services_revenue',
        display_name='Services Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:MaintenanceRevenue',
            'ge:ServicesRevenue',
            'cat:FinancialProductsRevenue',
        ],
        synonyms=['services revenue', 'maintenance revenue'],
    ),
    MetricMapping(
        normalized_metric='aviation_revenue',
        display_name='Aviation Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'ge:AviationRevenue',
            'ba:CommercialAirplanesRevenue',
        ],
        synonyms=['aviation revenue', 'aerospace revenue'],
    ),
    MetricMapping(
        normalized_metric='power_revenue',
        display_name='Power Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'ge:PowerRevenue',
            'us-gaap:ElectricUtilityRevenue',
        ],
        synonyms=['power revenue', 'energy revenue'],
    ),
    MetricMapping(
        normalized_metric='defense_revenue',
        display_name='Defense Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'ba:DefenseSpaceAndSecurityRevenue',
            'us-gaap:DefenseContractRevenue',
        ],
        synonyms=['defense revenue', 'defense and security revenue'],
    ),
    # Industrial-specific Costs
    MetricMapping(
        normalized_metric='warranty_expense',
        display_name='Warranty Expense',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ProductWarrantyExpense',
            'us-gaap:StandardProductWarrantyAccrual',
        ],
        synonyms=['warranty expense', 'warranty costs'],
    ),
    MetricMapping(
        normalized_metric='pension_expense',
        display_name='Pension Expense',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:DefinedBenefitPlanNetPeriodicBenefitCost',
            'us-gaap:PensionExpense',
        ],
        synonyms=['pension expense', 'pension costs'],
    ),
]


# ============ INSURANCE COMPANY MAPPINGS (MET, PRU, AIG, ALL, etc.) ============
INSURANCE_COMPANY_MAPPINGS = [
    # Insurance Revenue
    MetricMapping(
        normalized_metric='premiums_earned_net',
        display_name='Premiums Earned, Net',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PremiumsEarnedNet',
            'us-gaap:PremiumsEarnedNetPropertyAndCasualty',
            'us-gaap:PremiumsEarnedNetLife',
            'us-gaap:InsurancePremiumsRevenue',
        ],
        synonyms=['premiums earned', 'net premiums earned', 'insurance premiums'],
    ),
    MetricMapping(
        normalized_metric='premiums_written',
        display_name='Premiums Written',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PremiumsWrittenNet',
            'us-gaap:PremiumsWrittenGross',
            'us-gaap:DirectPremiumsWritten',
        ],
        synonyms=['premiums written', 'gross premiums written'],
    ),
    MetricMapping(
        normalized_metric='policy_charges_and_fees',
        display_name='Policy Charges and Fees',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PolicyChargesAndFeeIncome',
            'us-gaap:InsuranceCommissionsAndFees',
        ],
        synonyms=['policy charges', 'policy fees', 'insurance fees'],
    ),
    MetricMapping(
        normalized_metric='net_investment_income',
        display_name='Net Investment Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NetInvestmentIncome',
            'us-gaap:InvestmentIncomeNet',
            'us-gaap:InvestmentIncomeInterestAndDividend',
        ],
        synonyms=['net investment income', 'investment income'],
    ),
    MetricMapping(
        normalized_metric='realized_investment_gains_losses',
        display_name='Realized Investment Gains (Losses)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RealizedInvestmentGainsLosses',
            'us-gaap:GainLossOnInvestmentsExcludingOtherThanTemporaryImpairments',
            'us-gaap:NetRealizedInvestmentGainLoss',
        ],
        synonyms=['realized gains', 'investment gains losses'],
    ),
    # Insurance Costs and Benefits
    MetricMapping(
        normalized_metric='policyholder_benefits_and_claims',
        display_name='Policyholder Benefits and Claims',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PolicyholderBenefitsAndClaimsIncurredNet',
            'us-gaap:BenefitsLossesAndExpenses',
            'us-gaap:InsuranceLossesAndSettlementExpense',
        ],
        synonyms=['policyholder benefits', 'claims incurred', 'benefits and claims'],
    ),
    MetricMapping(
        normalized_metric='policy_acquisition_costs',
        display_name='Policy Acquisition Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PolicyAcquisitionCosts',
            'us-gaap:DeferredPolicyAcquisitionCostAmortizationExpense',
            'us-gaap:InsuranceAcquisitionCosts',
        ],
        synonyms=['policy acquisition costs', 'dac amortization'],
    ),
    MetricMapping(
        normalized_metric='loss_ratio',
        display_name='Loss Ratio',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:LossRatio',
            'us-gaap:InsuranceLossRatio',
        ],
        synonyms=['loss ratio', 'claims ratio'],
    ),
    MetricMapping(
        normalized_metric='combined_ratio',
        display_name='Combined Ratio',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CombinedRatio',
            'us-gaap:PropertyCasualtyCombinedRatio',
        ],
        synonyms=['combined ratio'],
    ),
    # Insurance Balance Sheet
    MetricMapping(
        normalized_metric='deferred_policy_acquisition_costs',
        display_name='Deferred Policy Acquisition Costs',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:DeferredPolicyAcquisitionCosts',
            'us-gaap:DeferredPolicyAcquisitionCostsAndValueOfBusinessAcquired',
        ],
        synonyms=['deferred acquisition costs', 'dac'],
    ),
    MetricMapping(
        normalized_metric='policy_liabilities',
        display_name='Policy Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:LiabilityForFuturePolicyBenefits',
            'us-gaap:PolicyholderContractDeposits',
            'us-gaap:LiabilityForUnpaidClaimsAndClaimsAdjustmentExpense',
        ],
        synonyms=['policy liabilities', 'insurance reserves'],
    ),
    MetricMapping(
        normalized_metric='unearned_premiums',
        display_name='Unearned Premiums',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:UnearnedPremiums',
            'us-gaap:UnearnedPremiumsPolicy',
        ],
        synonyms=['unearned premiums', 'unearned premium reserve'],
    ),
    MetricMapping(
        normalized_metric='separate_account_assets',
        display_name='Separate Account Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:SeparateAccountAssets',
            'us-gaap:SeparateAccountsAssets',
        ],
        synonyms=['separate account assets'],
    ),
    MetricMapping(
        normalized_metric='separate_account_liabilities',
        display_name='Separate Account Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:SeparateAccountsLiability',
            'us-gaap:SeparateAccountLiabilities',
        ],
        synonyms=['separate account liabilities'],
    ),
]


# ============ TELECOM COMPANY MAPPINGS (T, VZ, TMUS, etc.) ============
TELECOM_COMPANY_MAPPINGS = [
    # Telecom Revenue
    MetricMapping(
        normalized_metric='wireless_service_revenue',
        display_name='Wireless Service Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:WirelessServiceRevenue',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxWireless',
            't:WirelessServiceRevenue',
            'vz:WirelessServiceRevenue',
            'tmus:ServiceRevenues',
        ],
        synonyms=['wireless service revenue', 'mobile service revenue'],
    ),
    MetricMapping(
        normalized_metric='wireless_equipment_revenue',
        display_name='Wireless Equipment Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:WirelessEquipmentRevenue',
            't:WirelessEquipmentRevenue',
            'vz:WirelessEquipmentRevenue',
            'tmus:EquipmentRevenues',
        ],
        synonyms=['wireless equipment revenue', 'device revenue'],
    ),
    MetricMapping(
        normalized_metric='wireline_revenue',
        display_name='Wireline Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:WirelineRevenue',
            't:WirelineRevenue',
            'vz:WirelineRevenue',
            'us-gaap:TelecommunicationsRevenue',
        ],
        synonyms=['wireline revenue', 'fixed line revenue'],
    ),
    MetricMapping(
        normalized_metric='broadband_revenue',
        display_name='Broadband Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:BroadbandRevenue',
            't:BroadbandRevenue',
            'vz:FiosRevenue',
            'cmcsa:HighSpeedInternetRevenue',
        ],
        synonyms=['broadband revenue', 'internet revenue', 'fios revenue'],
    ),
    MetricMapping(
        normalized_metric='video_revenue',
        display_name='Video Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:VideoRevenue',
            't:VideoRevenue',
            'cmcsa:VideoRevenue',
            'us-gaap:CableTelevisionRevenue',
        ],
        synonyms=['video revenue', 'tv revenue', 'cable revenue'],
    ),
    MetricMapping(
        normalized_metric='business_solutions_revenue',
        display_name='Business Solutions Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            't:BusinessSolutionsRevenue',
            'vz:BusinessRevenue',
            'us-gaap:EnterpriseServicesRevenue',
        ],
        synonyms=['business solutions revenue', 'enterprise revenue'],
    ),
    # Telecom Costs
    MetricMapping(
        normalized_metric='cost_of_services_telecom',
        display_name='Cost of Services (Telecom)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CostOfTelecommunicationServices',
            't:CostOfServices',
            'vz:CostOfServices',
        ],
        synonyms=['cost of services', 'network costs'],
    ),
    MetricMapping(
        normalized_metric='cost_of_equipment',
        display_name='Cost of Equipment',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CostOfEquipment',
            't:CostOfEquipment',
            'vz:CostOfWirelessEquipment',
            'tmus:CostOfEquipmentSales',
        ],
        synonyms=['cost of equipment', 'device costs'],
    ),
    MetricMapping(
        normalized_metric='network_access_costs',
        display_name='Network Access Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NetworkAccessCosts',
            't:NetworkAccessCosts',
            'us-gaap:InterconnectionCosts',
        ],
        synonyms=['network access costs', 'interconnection costs'],
    ),
    # Telecom Metrics
    MetricMapping(
        normalized_metric='arpu',
        display_name='Average Revenue Per User (ARPU)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:AverageRevenuePerUser',
            't:ARPU',
            'vz:ARPU',
            'tmus:ARPU',
        ],
        synonyms=['arpu', 'average revenue per user'],
    ),
    MetricMapping(
        normalized_metric='subscriber_count',
        display_name='Subscriber Count',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:NumberOfSubscribers',
            't:WirelessSubscribers',
            'vz:WirelessRetailConnections',
            'tmus:TotalCustomers',
        ],
        synonyms=['subscriber count', 'customer count', 'connections'],
    ),
    MetricMapping(
        normalized_metric='churn_rate',
        display_name='Churn Rate',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ChurnRate',
            't:ChurnRate',
            'vz:ChurnRate',
            'tmus:ChurnRate',
        ],
        synonyms=['churn rate', 'customer churn'],
    ),
]


# ============ REAL ESTATE / REIT MAPPINGS (SPG, PLD, AMT, EQIX, etc.) ============
REAL_ESTATE_COMPANY_MAPPINGS = [
    # REIT Revenue
    MetricMapping(
        normalized_metric='rental_revenue',
        display_name='Rental Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RentalRevenue',
            'us-gaap:OperatingLeaseLeaseIncome',
            'us-gaap:LeaseIncome',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxRental',
        ],
        synonyms=['rental revenue', 'lease revenue', 'rent income'],
    ),
    MetricMapping(
        normalized_metric='tenant_reimbursements',
        display_name='Tenant Reimbursements',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:TenantReimbursements',
            'us-gaap:OperatingLeaseVariableLeaseIncome',
            'us-gaap:CommonAreaMaintenanceRevenue',
        ],
        synonyms=['tenant reimbursements', 'cam revenue'],
    ),
    MetricMapping(
        normalized_metric='property_management_fees',
        display_name='Property Management Fees',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PropertyManagementFeeRevenue',
            'us-gaap:ManagementFeesRevenue',
        ],
        synonyms=['property management fees', 'management fees'],
    ),
    # REIT Key Metrics
    MetricMapping(
        normalized_metric='funds_from_operations',
        display_name='Funds From Operations (FFO)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:FundsFromOperations',
            'us-gaap:FundsFromOperationsPerShare',
            'us-gaap:AdjustedFundsFromOperations',
        ],
        synonyms=['ffo', 'funds from operations'],
    ),
    MetricMapping(
        normalized_metric='adjusted_funds_from_operations',
        display_name='Adjusted Funds From Operations (AFFO)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:AdjustedFundsFromOperations',
            'us-gaap:CoreFundsFromOperations',
        ],
        synonyms=['affo', 'adjusted ffo', 'core ffo'],
    ),
    MetricMapping(
        normalized_metric='net_operating_income',
        display_name='Net Operating Income (NOI)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NetOperatingIncome',
            'us-gaap:RealEstateRevenueNet',
        ],
        synonyms=['noi', 'net operating income'],
    ),
    MetricMapping(
        normalized_metric='same_store_noi',
        display_name='Same-Store NOI',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:SameStoreNetOperatingIncome',
            'us-gaap:ComparableStoreNetOperatingIncome',
        ],
        synonyms=['same store noi', 'comparable noi'],
    ),
    # REIT Costs
    MetricMapping(
        normalized_metric='property_operating_expenses',
        display_name='Property Operating Expenses',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:DirectCostsOfLeasedAndRentedPropertyOrEquipment',
            'us-gaap:RealEstateTaxExpense',
            'us-gaap:PropertyOperatingExpense',
        ],
        synonyms=['property operating expenses', 'property expenses'],
    ),
    MetricMapping(
        normalized_metric='real_estate_taxes',
        display_name='Real Estate Taxes',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RealEstateTaxExpense',
            'us-gaap:PropertyTaxExpense',
        ],
        synonyms=['real estate taxes', 'property taxes'],
    ),
    # REIT Balance Sheet
    MetricMapping(
        normalized_metric='real_estate_investments',
        display_name='Real Estate Investments',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:RealEstateInvestmentPropertyNet',
            'us-gaap:RealEstateInvestmentPropertyAtCost',
            'us-gaap:RealEstateInvestments',
        ],
        synonyms=['real estate investments', 'investment properties'],
    ),
    MetricMapping(
        normalized_metric='accumulated_depreciation_real_estate',
        display_name='Accumulated Depreciation (Real Estate)',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:RealEstateInvestmentPropertyAccumulatedDepreciation',
            'us-gaap:AccumulatedDepreciationOnRealEstateAssets',
        ],
        synonyms=['accumulated depreciation real estate'],
    ),
    MetricMapping(
        normalized_metric='real_estate_held_for_sale',
        display_name='Real Estate Held for Sale',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:RealEstateHeldforsale',
            'us-gaap:AssetsHeldForSaleRealEstate',
        ],
        synonyms=['real estate held for sale', 'properties held for sale'],
    ),
    # REIT Occupancy and Metrics
    MetricMapping(
        normalized_metric='occupancy_rate',
        display_name='Occupancy Rate',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:OccupancyRate',
            'us-gaap:PercentageOccupied',
        ],
        synonyms=['occupancy rate', 'occupancy percentage'],
    ),
    MetricMapping(
        normalized_metric='average_rent_per_square_foot',
        display_name='Average Rent Per Square Foot',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:AverageRentPerSquareFoot',
            'us-gaap:AverageBaseRentPerSquareFoot',
        ],
        synonyms=['average rent psf', 'rent per square foot'],
    ),
]


# ============ UTILITY COMPANY MAPPINGS (NEE, DUK, SO, D, etc.) ============
UTILITY_COMPANY_MAPPINGS = [
    # Utility Revenue
    MetricMapping(
        normalized_metric='electric_utility_revenue',
        display_name='Electric Utility Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ElectricUtilityRevenue',
            'us-gaap:RegulatedElectricRevenue',
            'us-gaap:ElectricityRevenue',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxElectric',
        ],
        synonyms=['electric revenue', 'electricity revenue'],
    ),
    MetricMapping(
        normalized_metric='gas_utility_revenue',
        display_name='Gas Utility Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:GasUtilityRevenue',
            'us-gaap:RegulatedGasRevenue',
            'us-gaap:NaturalGasRevenue',
            'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTaxGas',
        ],
        synonyms=['gas revenue', 'natural gas revenue'],
    ),
    MetricMapping(
        normalized_metric='water_utility_revenue',
        display_name='Water Utility Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:WaterUtilityRevenue',
            'us-gaap:WaterRevenue',
        ],
        synonyms=['water revenue', 'water utility revenue'],
    ),
    MetricMapping(
        normalized_metric='transmission_revenue',
        display_name='Transmission Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:TransmissionRevenue',
            'us-gaap:ElectricTransmissionRevenue',
        ],
        synonyms=['transmission revenue'],
    ),
    MetricMapping(
        normalized_metric='distribution_revenue',
        display_name='Distribution Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:DistributionRevenue',
            'us-gaap:ElectricDistributionRevenue',
        ],
        synonyms=['distribution revenue'],
    ),
    MetricMapping(
        normalized_metric='renewable_energy_revenue',
        display_name='Renewable Energy Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RenewableEnergyRevenue',
            'us-gaap:WindEnergyRevenue',
            'us-gaap:SolarEnergyRevenue',
        ],
        synonyms=['renewable energy revenue', 'clean energy revenue'],
    ),
    # Utility Costs
    MetricMapping(
        normalized_metric='fuel_costs',
        display_name='Fuel Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:FuelCosts',
            'us-gaap:CostOfFuel',
            'us-gaap:ElectricUtilityFuelAndPurchasedPowerCost',
        ],
        synonyms=['fuel costs', 'fuel expense'],
    ),
    MetricMapping(
        normalized_metric='purchased_power_costs',
        display_name='Purchased Power Costs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:PurchasedPowerCosts',
            'us-gaap:CostOfPurchasedPower',
            'us-gaap:ElectricUtilityPurchasedPowerCost',
        ],
        synonyms=['purchased power costs', 'power purchase costs'],
    ),
    MetricMapping(
        normalized_metric='cost_of_gas_sold',
        display_name='Cost of Gas Sold',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:CostOfGasSold',
            'us-gaap:GasUtilityCostOfGasSold',
            'us-gaap:NaturalGasPurchaseCosts',
        ],
        synonyms=['cost of gas sold', 'gas purchase costs'],
    ),
    MetricMapping(
        normalized_metric='transmission_and_distribution_expense',
        display_name='Transmission and Distribution Expense',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:TransmissionAndDistributionExpense',
            'us-gaap:ElectricUtilityTransmissionAndDistributionExpense',
        ],
        synonyms=['t&d expense', 'transmission and distribution expense'],
    ),
    # Utility Balance Sheet
    MetricMapping(
        normalized_metric='utility_plant',
        display_name='Utility Plant',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:PublicUtilitiesPropertyPlantAndEquipmentNet',
            'us-gaap:UtilityPlantNet',
            'us-gaap:ElectricUtilityPlantNet',
        ],
        synonyms=['utility plant', 'utility ppe'],
    ),
    MetricMapping(
        normalized_metric='regulatory_assets',
        display_name='Regulatory Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:RegulatoryAssets',
            'us-gaap:RegulatoryAssetsCurrent',
            'us-gaap:RegulatoryAssetsNoncurrent',
        ],
        synonyms=['regulatory assets'],
    ),
    MetricMapping(
        normalized_metric='regulatory_liabilities',
        display_name='Regulatory Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:RegulatoryLiabilities',
            'us-gaap:RegulatoryLiabilitiesCurrent',
            'us-gaap:RegulatoryLiabilitiesNoncurrent',
        ],
        synonyms=['regulatory liabilities'],
    ),
    MetricMapping(
        normalized_metric='nuclear_decommissioning_trust',
        display_name='Nuclear Decommissioning Trust',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:NuclearDecommissioningTrustFund',
            'us-gaap:NuclearDecommissioningFundAssets',
        ],
        synonyms=['nuclear decommissioning trust', 'decommissioning fund'],
    ),
    # Utility Metrics
    MetricMapping(
        normalized_metric='rate_base',
        display_name='Rate Base',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:RateBase',
            'us-gaap:RegulatoryRateBase',
        ],
        synonyms=['rate base'],
    ),
    MetricMapping(
        normalized_metric='allowed_return_on_equity',
        display_name='Allowed Return on Equity',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:AllowedReturnOnEquity',
            'us-gaap:AuthorizedReturnOnEquity',
        ],
        synonyms=['allowed roe', 'authorized roe'],
    ),
]


# ALL_MAPPINGS is defined after all metric lists are created (see bottom of file)


class XBRLTagMapper:
    """
    Maps XBRL tags to normalized metric names.
    
    Supports:
    - Direct tag lookup (us-gaap:Revenues -> revenue)
    - Partial tag matching (Revenues -> revenue)
    - Reverse lookup (revenue -> list of XBRL tags)
    - Unmapped tag tracking for gap analysis
    """
    
    def __init__(self):
        # Build lookup tables
        self.tag_to_metric: Dict[str, MetricMapping] = {}
        self.metric_to_mapping: Dict[str, MetricMapping] = {}
        self.tag_name_to_metric: Dict[str, MetricMapping] = {}  # Without namespace
        self.unmapped_tags: Set[Tuple[str, str]] = set()  # Track (tag, context) pairs for gap analysis
        
        for mapping in ALL_MAPPINGS:
            self.metric_to_mapping[mapping.normalized_metric] = mapping
            for tag in mapping.xbrl_tags:
                self.tag_to_metric[tag.lower()] = mapping
                # Also store without namespace
                if ':' in tag:
                    tag_name = tag.split(':')[1].lower()
                    self.tag_name_to_metric[tag_name] = mapping
        
        logger.info(f"Loaded {len(ALL_MAPPINGS)} metric mappings with "
                   f"{len(self.tag_to_metric)} XBRL tags")
    
    def get_normalized_metric(self, xbrl_tag: str) -> Tuple[Optional[str], float]:
        """
        Get normalized metric name for an XBRL tag.
        
        Args:
            xbrl_tag: Full XBRL tag (e.g., 'us-gaap:Revenues')
            
        Returns:
            Tuple of (normalized_metric, confidence)
            Returns (None, 0) if no match found
        """
        tag_lower = xbrl_tag.lower()
        
        # Direct match (highest confidence)
        if tag_lower in self.tag_to_metric:
            return self.tag_to_metric[tag_lower].normalized_metric, 1.0
        
        # Match without namespace
        if ':' in xbrl_tag:
            tag_name = xbrl_tag.split(':')[1].lower()
            if tag_name in self.tag_name_to_metric:
                return self.tag_name_to_metric[tag_name].normalized_metric, 0.95
        
        # No match - return the tag as-is (slugified)
        return None, 0.0
    
    def get_mapping(self, normalized_metric: str) -> Optional[MetricMapping]:
        """Get full mapping for a normalized metric"""
        return self.metric_to_mapping.get(normalized_metric)
    
    def get_xbrl_tags(self, normalized_metric: str) -> List[str]:
        """Get all XBRL tags for a normalized metric"""
        mapping = self.metric_to_mapping.get(normalized_metric)
        return mapping.xbrl_tags if mapping else []
    
    def get_statement_type(self, xbrl_tag: str) -> str:
        """Get statement type for an XBRL tag"""
        tag_lower = xbrl_tag.lower()
        if tag_lower in self.tag_to_metric:
            return self.tag_to_metric[tag_lower].statement_type
        return 'unknown'
    
    def slugify_tag(self, xbrl_tag: str) -> str:
        """Convert XBRL tag to a slug for unmatched tags"""
        # Remove namespace
        if ':' in xbrl_tag:
            tag_name = xbrl_tag.split(':')[1]
        else:
            tag_name = xbrl_tag
        
        # Convert CamelCase to snake_case
        slug = re.sub(r'(?<!^)(?=[A-Z])', '_', tag_name).lower()
        return slug
    
    def get_all_metrics(self) -> List[MetricMapping]:
        """Get all metric mappings"""
        return ALL_MAPPINGS
    
    def register_unmapped_tag(self, xbrl_tag: str, context: str) -> None:
        """
        Track unmapped tags for gap analysis.
        
        Args:
            xbrl_tag: The XBRL tag that was not found in mappings
            context: Context information (e.g., "AAPL:10-K" or "income_statement")
        """
        self.unmapped_tags.add((xbrl_tag, context))
        logger.debug(f"Registered unmapped tag: {xbrl_tag} (context: {context})")
    
    def get_unmapped_tags_report(self) -> List[Dict]:
        """
        Generate report of unmapped tags for review.
        
        Returns:
            List of dicts with tag info, sorted by frequency
        """
        # Count occurrences by tag
        tag_counts: Dict[str, Dict] = {}
        for tag, context in self.unmapped_tags:
            if tag not in tag_counts:
                tag_counts[tag] = {
                    'xbrl_tag': tag,
                    'suggested_slug': self.slugify_tag(tag),
                    'contexts': [],
                    'count': 0
                }
            tag_counts[tag]['contexts'].append(context)
            tag_counts[tag]['count'] += 1
        
        # Sort by count descending
        report = sorted(tag_counts.values(), key=lambda x: x['count'], reverse=True)
        return report
    
    def clear_unmapped_tags(self) -> None:
        """Clear the unmapped tags set (useful for testing or batch processing)"""
        self.unmapped_tags.clear()


# Singleton instance
_mapper_instance: Optional[XBRLTagMapper] = None

def get_mapper() -> XBRLTagMapper:
    """Get singleton XBRLTagMapper instance"""
    global _mapper_instance
    if _mapper_instance is None:
        _mapper_instance = XBRLTagMapper()
    return _mapper_instance


# ============ BANK-SPECIFIC METRICS ============
BANK_MAPPINGS = [
    # Bank Income Statement Metrics
    MetricMapping(
        normalized_metric='interest_income',
        display_name='Interest Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:InterestAndDividendIncomeOperating',
            'us-gaap:InterestIncomeOperating',
            'us-gaap:InterestAndFeeIncomeLoansAndLeases',
            'us-gaap:InterestIncomeExpenseNet',
            'us-gaap:InterestAndDividendIncome',
            'jpm:InterestIncome',  # JPM custom tag
        ],
        synonyms=['interest income', 'interest and dividend income', 'interest and fee income'],
    ),
    MetricMapping(
        normalized_metric='interest_expense_operating',
        display_name='Interest Expense (Operating)',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:InterestExpenseOperating',
            'us-gaap:InterestExpenseDeposits',
            'us-gaap:InterestExpenseBorrowings',
            'us-gaap:InterestExpenseFederalFundsPurchasedAndSecuritiesSoldUnderAgreementsToRepurchase',
        ],
        synonyms=['interest expense operating'],
    ),
    MetricMapping(
        normalized_metric='net_interest_income',
        display_name='Net Interest Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:InterestIncomeExpenseNet',
            'us-gaap:InterestIncomeExpenseAfterProvisionForLoanLoss',
            'us-gaap:NetInterestIncome',
            'jpm:NetInterestIncome',
        ],
        synonyms=['net interest income', 'interest income net', 'nii'],
    ),
    MetricMapping(
        normalized_metric='provision_for_credit_losses',
        display_name='Provision for Credit Losses',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ProvisionForLoanLeaseAndOtherLosses',
            'us-gaap:ProvisionForLoanAndLeaseLosses',
            'us-gaap:ProvisionForCreditLosses',
            'us-gaap:ProvisionForLoanLossesExpensed',
            'jpm:ProvisionForCreditLosses',
        ],
        synonyms=['provision for credit losses', 'loan loss provision', 'credit loss provision'],
    ),
    MetricMapping(
        normalized_metric='noninterest_income',
        display_name='Noninterest Income',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NoninterestIncome',
            'us-gaap:FeesAndCommissions',
            'us-gaap:InvestmentBankingRevenue',
            'us-gaap:TradingRevenue',
            'us-gaap:AssetManagementFees',
            'jpm:NoninterestRevenue',
        ],
        synonyms=['noninterest income', 'fee income', 'noninterest revenue'],
    ),
    MetricMapping(
        normalized_metric='noninterest_expense',
        display_name='Noninterest Expense',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NoninterestExpense',
            'us-gaap:LaborAndRelatedExpense',
            'us-gaap:OccupancyNet',
            'jpm:NoninterestExpense',
        ],
        synonyms=['noninterest expense', 'operating expense'],
    ),
    # Bank Balance Sheet Metrics
    MetricMapping(
        normalized_metric='total_loans',
        display_name='Total Loans',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:LoansAndLeasesReceivableNetReportedAmount',
            'us-gaap:LoansAndLeasesReceivableNetOfDeferredIncome',
            'us-gaap:LoansReceivableNet',
            'us-gaap:NotesReceivableNet',
            'jpm:Loans',
        ],
        synonyms=['total loans', 'loans and leases', 'loan portfolio'],
    ),
    MetricMapping(
        normalized_metric='total_deposits',
        display_name='Total Deposits',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:Deposits',
            'us-gaap:DepositsDomestic',
            'us-gaap:DepositsForeign',
            'us-gaap:InterestBearingDepositsInBanks',
            'jpm:Deposits',
        ],
        synonyms=['total deposits', 'deposits', 'customer deposits'],
    ),
    MetricMapping(
        normalized_metric='allowance_for_loan_losses',
        display_name='Allowance for Loan Losses',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FinancingReceivableAllowanceForCreditLosses',
            'us-gaap:AllowanceForLoanAndLeaseLossesRealEstate',
            'us-gaap:LoansAndLeasesReceivableAllowance',
            'jpm:AllowanceForCreditLosses',
        ],
        synonyms=['allowance for loan losses', 'loan loss reserve', 'credit loss allowance'],
    ),
    MetricMapping(
        normalized_metric='trading_assets',
        display_name='Trading Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:TradingSecurities',
            'us-gaap:TradingAssetsDebt',
            'us-gaap:TradingAssetsEquity',
            'jpm:TradingAssets',
        ],
        synonyms=['trading assets', 'trading securities'],
    ),
    MetricMapping(
        normalized_metric='investment_securities',
        display_name='Investment Securities',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:AvailableForSaleSecuritiesDebtSecurities',
            'us-gaap:HeldToMaturitySecurities',
            'us-gaap:InvestmentSecurities',
            'jpm:InvestmentSecurities',
        ],
        synonyms=['investment securities', 'securities portfolio'],
    ),
    MetricMapping(
        normalized_metric='federal_funds_sold',
        display_name='Federal Funds Sold',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FederalFundsSoldAndSecuritiesPurchasedUnderAgreementsToResell',
            'us-gaap:FederalFundsSold',
        ],
        synonyms=['federal funds sold', 'fed funds sold'],
    ),
    MetricMapping(
        normalized_metric='federal_funds_purchased',
        display_name='Federal Funds Purchased',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:FederalFundsPurchasedAndSecuritiesSoldUnderAgreementsToRepurchase',
            'us-gaap:FederalFundsPurchased',
        ],
        synonyms=['federal funds purchased', 'fed funds purchased'],
    ),
    # Bank Regulatory Capital Metrics
    MetricMapping(
        normalized_metric='tier1_capital',
        display_name='Tier 1 Capital',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:Tier1Capital',
            'us-gaap:CommonEquityTier1Capital',
            'jpm:Tier1Capital',
        ],
        synonyms=['tier 1 capital', 'tier one capital', 'cet1'],
    ),
    MetricMapping(
        normalized_metric='total_risk_weighted_assets',
        display_name='Total Risk-Weighted Assets',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:RiskWeightedAssets',
            'jpm:RiskWeightedAssets',
        ],
        synonyms=['risk weighted assets', 'rwa'],
    ),
    MetricMapping(
        normalized_metric='tier1_capital_ratio',
        display_name='Tier 1 Capital Ratio',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:Tier1CapitalToRiskWeightedAssets',
            'us-gaap:CommonEquityTier1CapitalRatio',
            'jpm:Tier1CapitalRatio',
        ],
        synonyms=['tier 1 capital ratio', 'tier 1 ratio', 'cet1 ratio'],
    ),
    MetricMapping(
        normalized_metric='total_capital_ratio',
        display_name='Total Capital Ratio',
        statement_type='balance_sheet',
        xbrl_tags=[
            'us-gaap:TotalCapitalToRiskWeightedAssets',
            'us-gaap:CapitalToRiskWeightedAssets',
            'jpm:TotalCapitalRatio',
        ],
        synonyms=['total capital ratio', 'capital adequacy ratio'],
    ),
    # Bank Performance Metrics
    MetricMapping(
        normalized_metric='net_charge_offs',
        display_name='Net Charge-offs',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:FinancingReceivableAllowanceForCreditLossesWriteOffs',
            'us-gaap:AllowanceForLoanAndLeaseLossesWriteOffs',
            'jpm:NetChargeOffs',
        ],
        synonyms=['net charge-offs', 'charge-offs', 'loan write-offs'],
    ),
    MetricMapping(
        normalized_metric='efficiency_ratio',
        display_name='Efficiency Ratio',
        statement_type='income_statement',
        xbrl_tags=[
            'jpm:EfficiencyRatio',
        ],
        synonyms=['efficiency ratio', 'cost to income ratio'],
    ),
    MetricMapping(
        normalized_metric='return_on_equity',
        display_name='Return on Equity',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ReturnOnEquity',
            'jpm:ReturnOnCommonEquity',
        ],
        synonyms=['return on equity', 'roe'],
    ),
    MetricMapping(
        normalized_metric='return_on_assets',
        display_name='Return on Assets',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:ReturnOnAssets',
            'jpm:ReturnOnAssets',
        ],
        synonyms=['return on assets', 'roa'],
    ),
    MetricMapping(
        normalized_metric='net_interest_margin',
        display_name='Net Interest Margin',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:NetInterestIncomeExpenseToAverageEarningAssets',
            'jpm:NetInterestMargin',
        ],
        synonyms=['net interest margin', 'nim'],
    ),
    # Bank Revenue (alternative to standard revenue)
    MetricMapping(
        normalized_metric='total_net_revenue',
        display_name='Total Net Revenue',
        statement_type='income_statement',
        xbrl_tags=[
            'us-gaap:RevenuesNetOfInterestExpense',
            'jpm:TotalNetRevenue',
            'jpm:ManagedRevenue',
        ],
        synonyms=['total net revenue', 'managed revenue', 'net revenue'],
    ),
]

# ============ ADDITIONAL METRICS FROM EXCEL ============
ADDITIONAL_MAPPINGS = [
    # Income Statement additions
    MetricMapping(
        normalized_metric='comprehensive_income',
        display_name='Comprehensive Income',
        statement_type='income_statement',
        xbrl_tags=['us-gaap:ComprehensiveIncomeNetOfTax'],
        synonyms=['comprehensive income'],
    ),
    MetricMapping(
        normalized_metric='other_comprehensive_income',
        display_name='Other Comprehensive Income',
        statement_type='income_statement',
        xbrl_tags=['us-gaap:OtherComprehensiveIncomeLossNetOfTax'],
        synonyms=['other comprehensive income', 'oci'],
    ),
    MetricMapping(
        normalized_metric='discontinued_operations',
        display_name='Discontinued Operations',
        statement_type='income_statement',
        xbrl_tags=['us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax'],
        synonyms=['discontinued operations'],
    ),
    MetricMapping(
        normalized_metric='noncontrolling_interest',
        display_name='Noncontrolling Interest',
        statement_type='income_statement',
        xbrl_tags=['us-gaap:NetIncomeLossAttributableToNoncontrollingInterest', 'us-gaap:MinorityInterest'],
        synonyms=['noncontrolling interest', 'minority interest'],
    ),
    # Balance Sheet additions
    MetricMapping(
        normalized_metric='restricted_cash',
        display_name='Restricted Cash',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:RestrictedCash', 'us-gaap:RestrictedCashAndCashEquivalents'],
        synonyms=['restricted cash'],
    ),
    MetricMapping(
        normalized_metric='prepaid_expenses',
        display_name='Prepaid Expenses',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:PrepaidExpenseAndOtherAssetsCurrent', 'us-gaap:PrepaidExpenseCurrent'],
        synonyms=['prepaid expenses'],
    ),
    MetricMapping(
        normalized_metric='other_current_assets',
        display_name='Other Current Assets',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:OtherAssetsCurrent'],
        synonyms=['other current assets'],
    ),
    MetricMapping(
        normalized_metric='deferred_tax_assets',
        display_name='Deferred Tax Assets',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:DeferredIncomeTaxAssetsNet', 'us-gaap:DeferredTaxAssetsNet'],
        synonyms=['deferred tax assets'],
    ),
    MetricMapping(
        normalized_metric='other_noncurrent_assets',
        display_name='Other Noncurrent Assets',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:OtherAssetsNoncurrent'],
        synonyms=['other noncurrent assets', 'other long-term assets'],
    ),
    MetricMapping(
        normalized_metric='short_term_debt',
        display_name='Short-term Debt',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:ShortTermBorrowings', 'us-gaap:DebtCurrent'],
        synonyms=['short-term debt', 'current debt'],
    ),
    MetricMapping(
        normalized_metric='other_current_liabilities',
        display_name='Other Current Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:OtherLiabilitiesCurrent'],
        synonyms=['other current liabilities'],
    ),
    MetricMapping(
        normalized_metric='deferred_tax_liabilities',
        display_name='Deferred Tax Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:DeferredIncomeTaxLiabilitiesNet', 'us-gaap:DeferredTaxLiabilitiesNoncurrent'],
        synonyms=['deferred tax liabilities'],
    ),
    MetricMapping(
        normalized_metric='other_noncurrent_liabilities',
        display_name='Other Noncurrent Liabilities',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:OtherLiabilitiesNoncurrent'],
        synonyms=['other noncurrent liabilities', 'other long-term liabilities'],
    ),
    MetricMapping(
        normalized_metric='treasury_stock',
        display_name='Treasury Stock',
        statement_type='balance_sheet',
        xbrl_tags=['us-gaap:TreasuryStockValue', 'us-gaap:TreasuryStockCommonValue'],
        synonyms=['treasury stock'],
    ),
    # Cash Flow additions
    MetricMapping(
        normalized_metric='deferred_taxes',
        display_name='Deferred Taxes',
        statement_type='cash_flow',
        xbrl_tags=['us-gaap:DeferredIncomeTaxExpenseBenefit'],
        synonyms=['deferred taxes', 'deferred income taxes'],
    ),
    MetricMapping(
        normalized_metric='acquisitions',
        display_name='Acquisitions',
        statement_type='cash_flow',
        xbrl_tags=['us-gaap:PaymentsToAcquireBusinessesNetOfCashAcquired'],
        synonyms=['acquisitions', 'business acquisitions'],
    ),
    MetricMapping(
        normalized_metric='proceeds_from_investments',
        display_name='Proceeds from Investments',
        statement_type='cash_flow',
        xbrl_tags=['us-gaap:ProceedsFromSaleAndMaturityOfMarketableSecurities', 'us-gaap:ProceedsFromSaleOfAvailableForSaleSecuritiesDebt'],
        synonyms=['proceeds from investments'],
    ),
    MetricMapping(
        normalized_metric='purchases_of_investments',
        display_name='Purchases of Investments',
        statement_type='cash_flow',
        xbrl_tags=['us-gaap:PaymentsToAcquireMarketableSecurities', 'us-gaap:PaymentsToAcquireAvailableForSaleSecuritiesDebt'],
        synonyms=['purchases of investments'],
    ),
    MetricMapping(
        normalized_metric='debt_issued',
        display_name='Debt Issued',
        statement_type='cash_flow',
        xbrl_tags=['us-gaap:ProceedsFromIssuanceOfLongTermDebt', 'us-gaap:ProceedsFromDebtNetOfIssuanceCosts'],
        synonyms=['debt issued', 'proceeds from debt'],
    ),
    MetricMapping(
        normalized_metric='debt_repaid',
        display_name='Debt Repaid',
        statement_type='cash_flow',
        xbrl_tags=['us-gaap:RepaymentsOfLongTermDebt', 'us-gaap:RepaymentsOfDebt'],
        synonyms=['debt repaid', 'repayments of debt'],
    ),
    MetricMapping(
        normalized_metric='effect_of_exchange_rate',
        display_name='Effect of Exchange Rate on Cash',
        statement_type='cash_flow',
        xbrl_tags=['us-gaap:EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
        synonyms=['effect of exchange rate', 'fx effect'],
    ),
]

# Update ALL_MAPPINGS to include all metrics (including all industry-specific mappings)
ALL_MAPPINGS = (
    INCOME_STATEMENT_MAPPINGS + 
    BALANCE_SHEET_MAPPINGS + 
    CASH_FLOW_MAPPINGS + 
    BANK_MAPPINGS + 
    ADDITIONAL_MAPPINGS +
    MEDIA_COMPANY_MAPPINGS +
    TECH_COMPANY_MAPPINGS +
    RETAIL_COMPANY_MAPPINGS +
    HEALTHCARE_COMPANY_MAPPINGS +
    ENERGY_COMPANY_MAPPINGS +
    INDUSTRIAL_COMPANY_MAPPINGS +
    INSURANCE_COMPANY_MAPPINGS +
    TELECOM_COMPANY_MAPPINGS +
    REAL_ESTATE_COMPANY_MAPPINGS +
    UTILITY_COMPANY_MAPPINGS
)
