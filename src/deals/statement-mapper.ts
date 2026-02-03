import { Injectable, Logger } from '@nestjs/common';
import { StatementType, MetricDefinition, MetricRow } from './export.types';

interface RawMetric {
  normalized_metric: string;
  value: number;
  fiscal_period: string;
  reporting_unit?: string;  // Original scale from SEC: units, thousands, millions, billions
  parent_metric?: string;   // Parent metric for hierarchical relationships
  indent_level?: number;    // Indentation level from parsing (0=top level, 1=child, etc.)
}

interface StatementConfig {
  type: StatementType;
  displayName: string;
  worksheetName: string;
  metricOrder: MetricDefinition[];
}

// GICS Sector-based Industry Types (11 sectors)
// https://www.msci.com/our-solutions/indexes/gics
type IndustryType = 
  | 'energy'                  // GICS 10 - Energy
  | 'materials'               // GICS 15 - Materials
  | 'industrials'             // GICS 20 - Industrials
  | 'consumer_discretionary'  // GICS 25 - Consumer Discretionary
  | 'consumer_staples'        // GICS 30 - Consumer Staples
  | 'health_care'             // GICS 35 - Health Care
  | 'financials'              // GICS 40 - Financials (includes banks, insurance)
  | 'information_technology'  // GICS 45 - Information Technology
  | 'communication_services'  // GICS 50 - Communication Services (includes media, telecom)
  | 'utilities'               // GICS 55 - Utilities
  | 'real_estate';            // GICS 60 - Real Estate (includes REITs)

// Metric aliases - maps primary metric name to alternative names that should be coalesced
// This handles cases where SEC filings use different names for the same concept
const METRIC_ALIASES: Record<string, string[]> = {
  // Common aliases
  'interest_expense': ['interest_expense_nonoperating', 'interest_expense_operating'],
  'revenue': ['net_sales', 'total_revenue', 'revenues', 'total_net_revenue'],
  'net_income': ['net_income_loss', 'profit_loss'],
  'cost_of_revenue': ['cost_of_goods_sold', 'cost_of_sales', 'cost_of_products_and_services'],
  'operating_income': ['income_from_operations', 'operating_profit'],
  'income_tax_expense': ['provision_for_income_taxes', 'income_tax_provision'],
  
  // Bank-specific aliases (JPM, BAC, WFC, etc.)
  'net_interest_income': ['net_interest_revenue', 'interest_income_net'],
  'interest_income': ['total_interest_income', 'interest_and_dividend_income'],
  'noninterest_revenue': ['noninterest_income', 'fee_income', 'non_interest_income'],
  'noninterest_expense': ['non_interest_expense', 'operating_expense_bank'],
  'provision_credit_losses': ['provision_for_loan_losses', 'credit_loss_provision', 'allowance_for_credit_losses'],
  'investment_banking_fees': ['investment_banking_revenue', 'ib_fees'],
  'principal_transactions': ['trading_revenue', 'trading_gains_losses'],
  'asset_management_fees': ['asset_management_revenue', 'wealth_management_fees', 'advisory_fees'],
  'compensation_expense': ['salaries_and_employee_benefits', 'personnel_expense', 'employee_compensation'],
  'net_income_common': ['net_income_applicable_to_common', 'net_income_to_common_shareholders'],
  
  // Tech-specific aliases (AAPL, MSFT, NVDA, etc.)
  'product_revenue': ['products_revenue', 'hardware_revenue', 'device_revenue'],
  'service_revenue': ['services_revenue', 'subscription_revenue', 'cloud_revenue'],
  'cost_of_products': ['cost_of_products_sold', 'product_cost_of_sales'],
  'cost_of_services': ['cost_of_services_sold', 'service_cost_of_sales'],
  'research_and_development': ['research_development', 'r_and_d', 'rd_expense'],
  'selling_general_administrative': ['sg_and_a', 'sga_expense', 'selling_general_and_administrative'],
  'gross_profit': ['gross_margin', 'gross_income'],
  'other_income_expense': ['other_income', 'other_expense_net', 'non_operating_income'],
  
  // Retail/Consumer Discretionary aliases (AMZN, WMT, HD, etc.)
  'product_sales': ['net_product_sales', 'merchandise_sales'],
  'service_sales': ['net_service_sales', 'service_revenue'],
  'fulfillment': ['fulfillment_expense', 'fulfillment_costs'],
  'technology_and_infrastructure': ['technology_and_content', 'technology_expense'],
  
  // Energy-specific aliases (XOM, CVX, COP, etc.)
  'sales_and_other_operating_revenue': ['total_revenues', 'net_revenues'],
  'crude_oil_and_product_purchases': ['purchased_crude_oil', 'crude_purchases'],
  'production_and_manufacturing': ['production_expenses', 'manufacturing_expenses'],
  'depreciation_and_depletion': ['dd_and_a', 'depreciation_depletion_amortization'],
  'exploration_expenses': ['exploration_costs', 'dry_hole_costs'],
  
  // Utility-specific aliases (NEE, DUK, SO, etc.)
  'electric_revenue': ['electric_operating_revenue', 'electricity_revenue'],
  'gas_revenue': ['natural_gas_revenue', 'gas_operating_revenue'],
  'fuel_purchased_power_interchange': ['fuel_and_purchased_power', 'purchased_power_expense'],
  
  // Healthcare-specific aliases (UNH, JNJ, PFE, etc.)
  'premiums': ['premium_revenue', 'insurance_premiums'],
  'medical_costs': ['medical_expenses', 'healthcare_costs', 'benefit_costs'],
  
  // REIT-specific aliases (AMT, PLD, EQIX, etc.)
  'property_revenue': ['rental_revenue', 'lease_revenue'],
  'depreciation_amortization_accretion': ['depreciation_and_amortization', 'dd_and_a'],
  
  // Consumer Staples aliases (PG, KO, PEP, etc.)
  'cost_of_products_sold': ['cost_of_goods_sold', 'cost_of_sales'],
  'net_sales': ['total_revenue', 'revenues'],
  
  // Industrials aliases (UNP, CAT, BA, HON, etc.)
  'freight_revenues': ['transportation_revenue', 'shipping_revenue'],
  'compensation_and_benefits': ['labor_and_fringe', 'employee_costs'],
  'purchased_services_and_materials': ['materials_and_supplies', 'outside_services'],
  
  // Materials aliases (LIN, APD, SHW, ECL, etc.)
  'cost_of_sales': ['cost_of_goods_sold', 'cost_of_products_sold'],
  'operating_profit': ['operating_income', 'income_from_operations'],
  
  // Media-specific aliases (CMCSA, DIS, NFLX, etc.) - Task 7.2
  'programming_and_production': ['programming_costs', 'content_costs', 'content_production'],
  'content_amortization': ['programming_amortization', 'content_expense'],
  'marketing_and_promotion': ['advertising_and_marketing', 'promotional_expense'],
  'other_operating_and_administrative': ['general_and_administrative', 'administrative_expense'],
  
  // Balance sheet aliases - Task 7.6
  'total_assets': ['assets', 'total_assets_consolidated'],
  'total_liabilities': ['liabilities', 'total_liabilities_consolidated'],
  'stockholders_equity': ['shareholders_equity', 'total_equity', 'total_stockholders_equity'],
  'current_assets': ['total_current_assets', 'current_assets_total'],
  'current_liabilities': ['total_current_liabilities', 'current_liabilities_total'],
  'accounts_receivable': ['receivables', 'trade_receivables'],
  'inventory': ['inventories', 'merchandise_inventory'],
  'property_plant_equipment': ['ppe', 'property_plant_and_equipment', 'fixed_assets'],
  'goodwill': ['goodwill_net', 'goodwill_and_intangibles'],
  'intangible_assets': ['intangibles', 'intangible_assets_net'],
  'accounts_payable': ['payables', 'trade_payables'],
  'short_term_debt': ['current_debt', 'short_term_borrowings'],
  'long_term_debt': ['long_term_borrowings', 'debt_long_term'],
  'retained_earnings': ['accumulated_earnings', 'retained_earnings_deficit'],
  'accumulated_other_comprehensive_income': ['aoci', 'other_comprehensive_income_accumulated'],
  
  // Cash flow aliases - Task 7.7
  'operating_cash_flow': ['cash_from_operations', 'net_cash_from_operating_activities', 'operating_activities_cash_flow'],
  'investing_cash_flow': ['cash_from_investing', 'net_cash_from_investing_activities', 'investing_activities_cash_flow'],
  'financing_cash_flow': ['cash_from_financing', 'net_cash_from_financing_activities', 'financing_activities_cash_flow'],
  'capital_expenditures': ['capex', 'purchases_of_property_and_equipment', 'capital_spending'],
  'free_cash_flow': ['fcf', 'unlevered_free_cash_flow'],
  'dividends_paid': ['cash_dividends_paid', 'dividend_payments'],
  'stock_repurchases': ['share_buybacks', 'treasury_stock_purchases', 'repurchase_of_common_stock'],
  'debt_issuance': ['proceeds_from_debt', 'debt_proceeds'],
  'debt_repayment': ['repayment_of_debt', 'debt_payments'],
  'depreciation_amortization': ['depreciation_and_amortization', 'dd_and_a', 'da_expense'],
  'stock_based_compensation': ['share_based_compensation', 'stock_compensation_expense'],
  'change_accounts_receivable': ['change_in_receivables', 'accounts_receivable_change'],
  'change_inventory': ['change_in_inventory', 'inventory_change'],
  'change_accounts_payable': ['change_in_payables', 'accounts_payable_change'],
  'deferred_income_taxes': ['deferred_tax_expense', 'deferred_taxes'],
};

@Injectable()
export class StatementMapper {
  private readonly logger = new Logger(StatementMapper.name);

  // ============================================================
  // MEDIA COMPANY INCOME STATEMENT (CMCSA, DIS, NFLX, etc.)
  // This replaces the generic income statement for media companies
  // Matches SEC 10-K structure exactly
  // ============================================================
  static readonly MEDIA_INCOME_STATEMENT: MetricDefinition[] = [
    // Revenue
    { normalizedMetric: 'revenue_header', displayName: 'REVENUE', isHeader: true },
    { normalizedMetric: 'net_sales', displayName: 'Revenue', format: 'currency' },
    { normalizedMetric: 'revenue', displayName: 'Revenue', format: 'currency' },
    
    // Costs and Expenses (CMCSA-specific structure)
    { normalizedMetric: 'costs_header', displayName: 'COSTS AND EXPENSES', isHeader: true },
    { normalizedMetric: 'programming_and_production', displayName: 'Programming and production', format: 'currency', indent: 1 },
    { normalizedMetric: 'marketing_and_promotion', displayName: 'Marketing and promotion', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_operating_and_administrative', displayName: 'Other operating and administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation', displayName: 'Depreciation', format: 'currency', indent: 1 },
    { normalizedMetric: 'amortization', displayName: 'Amortization', format: 'currency', indent: 1 },
    { normalizedMetric: 'goodwill_and_long_lived_asset_impairments', displayName: 'Goodwill and long-lived asset impairments', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total costs and expenses', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Operating income', format: 'currency' },
    
    // Non-Operating Items
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense_nonoperating', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_income_expense', displayName: 'Investment and other income (loss), net', format: 'currency', indent: 1 },
    
    // Pre-Tax and Tax
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income taxes', format: 'currency' },
    { normalizedMetric: 'income_tax_expense', displayName: 'Income tax expense', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    { normalizedMetric: 'noncontrolling_interest', displayName: 'Less: Net income (loss) attributable to noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net income attributable to Comcast Corporation', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'PER SHARE DATA', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic earnings per common share', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted earnings per common share', format: 'eps' },
  ];

  // Keep the old additions for backward compatibility (used by other methods)
  static readonly MEDIA_INCOME_STATEMENT_ADDITIONS: MetricDefinition[] = [
    // Media-specific cost breakdowns
    { normalizedMetric: 'programming_and_production', displayName: 'Programming & Production Costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'programming_costs', displayName: 'Programming Costs', format: 'currency', indent: 2 },
    { normalizedMetric: 'production_costs', displayName: 'Production Costs', format: 'currency', indent: 2 },
    { normalizedMetric: 'content_costs', displayName: 'Content Costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'content_amortization', displayName: 'Content Amortization', format: 'currency', indent: 2 },
    { normalizedMetric: 'marketing_and_promotion', displayName: 'Marketing & Promotion', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_operating_and_administrative', displayName: 'Other Operating & Administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'technical_and_product_support', displayName: 'Technical & Product Support', format: 'currency', indent: 1 },
    { normalizedMetric: 'customer_service', displayName: 'Customer Service', format: 'currency', indent: 1 },
    // Depreciation & Amortization as separate line items (CMCSA shows these separately)
    { normalizedMetric: 'depreciation', displayName: 'Depreciation', format: 'currency', indent: 1 },
    { normalizedMetric: 'amortization', displayName: 'Amortization', format: 'currency', indent: 1 },
    { normalizedMetric: 'goodwill_and_long_lived_asset_impairments', displayName: 'Goodwill & Long-Lived Asset Impairments', format: 'currency', indent: 1 },
    { normalizedMetric: 'transaction_and_integration_costs', displayName: 'Transaction & Integration Costs', format: 'currency', indent: 1 },
    // Media-specific revenue breakdowns
    { normalizedMetric: 'cable_communications_revenue', displayName: 'Cable Communications Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'media_revenue', displayName: 'Media Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'studios_revenue', displayName: 'Studios Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'theme_parks_revenue', displayName: 'Theme Parks Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'streaming_revenue', displayName: 'Streaming Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'direct_to_consumer_revenue', displayName: 'Direct-to-Consumer Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'linear_networks_revenue', displayName: 'Linear Networks Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'affiliate_fees', displayName: 'Affiliate Fees', format: 'currency', indent: 2 },
    { normalizedMetric: 'distribution_revenue', displayName: 'Distribution Revenue', format: 'currency', indent: 2 },
  ];

  // ============================================================
  // BANK INCOME STATEMENT (JPM, BAC, WFC, C, GS, MS, etc.)
  // This replaces the generic income statement for bank/financial companies
  // Matches JPMorgan Chase SEC 10-K Consolidated Statements of Income exactly
  // Reference: JPM 10-K FY2024 (jpm-20241231.htm)
  // ============================================================
  static readonly BANK_INCOME_STATEMENT: MetricDefinition[] = [
    // Revenue Section - Net Interest Income
    { normalizedMetric: 'revenue_header', displayName: 'REVENUE', isHeader: true },
    
    // Interest Income
    { normalizedMetric: 'interest_income', displayName: 'Interest income', format: 'currency' },
    { normalizedMetric: 'interest_income_loans', displayName: 'Loans', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income_securities', displayName: 'Investment securities', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income_deposits_with_banks', displayName: 'Deposits with banks', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income_federal_funds', displayName: 'Federal funds sold and securities purchased under resale agreements', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income_trading_assets', displayName: 'Trading assets', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income_other', displayName: 'Other interest income', format: 'currency', indent: 1 },
    
    // Interest Expense
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency' },
    { normalizedMetric: 'interest_expense_deposits', displayName: 'Deposits', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense_borrowings', displayName: 'Short-term and other liabilities', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense_long_term_debt', displayName: 'Long-term debt', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense_beneficial_interests', displayName: 'Beneficial interests issued by consolidated VIEs', format: 'currency', indent: 1 },
    
    // Net Interest Income
    { normalizedMetric: 'net_interest_income', displayName: 'Net interest income', format: 'currency' },
    
    // Provision for Credit Losses
    { normalizedMetric: 'provision_credit_losses', displayName: 'Provision for credit losses', format: 'currency' },
    
    // Net Interest Income After Provision
    { normalizedMetric: 'net_interest_income_after_provision', displayName: 'Net interest income after provision for credit losses', format: 'currency' },
    
    // Noninterest Revenue Section
    { normalizedMetric: 'noninterest_revenue_header', displayName: 'NONINTEREST REVENUE', isHeader: true },
    { normalizedMetric: 'investment_banking_fees', displayName: 'Investment banking fees', format: 'currency', indent: 1 },
    { normalizedMetric: 'principal_transactions', displayName: 'Principal transactions', format: 'currency', indent: 1 },
    { normalizedMetric: 'lending_and_deposit_related_fees', displayName: 'Lending- and deposit-related fees', format: 'currency', indent: 1 },
    { normalizedMetric: 'asset_management_fees', displayName: 'Asset management, administration and commissions', format: 'currency', indent: 1 },
    { normalizedMetric: 'card_income', displayName: 'Card income', format: 'currency', indent: 1 },
    { normalizedMetric: 'mortgage_fees_and_related_income', displayName: 'Mortgage fees and related income', format: 'currency', indent: 1 },
    { normalizedMetric: 'securities_gains_losses', displayName: 'Securities gains (losses)', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_noninterest_revenue', displayName: 'Other income', format: 'currency', indent: 1 },
    { normalizedMetric: 'noninterest_revenue', displayName: 'Total noninterest revenue', format: 'currency' },
    
    // Total Net Revenue
    { normalizedMetric: 'total_net_revenue', displayName: 'Total net revenue', format: 'currency' },
    { normalizedMetric: 'revenue', displayName: 'Total net revenue', format: 'currency' },
    
    // Noninterest Expense Section
    { normalizedMetric: 'noninterest_expense_header', displayName: 'NONINTEREST EXPENSE', isHeader: true },
    { normalizedMetric: 'compensation_expense', displayName: 'Compensation expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'occupancy_expense', displayName: 'Occupancy expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'technology_expense', displayName: 'Technology, communications and equipment expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'professional_fees', displayName: 'Professional and outside services', format: 'currency', indent: 1 },
    { normalizedMetric: 'marketing_expense', displayName: 'Marketing', format: 'currency', indent: 1 },
    { normalizedMetric: 'fdic_assessment', displayName: 'FDIC-related expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_noninterest_expense', displayName: 'Other expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'noninterest_expense', displayName: 'Total noninterest expense', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income tax expense', format: 'currency' },
    
    // Income Tax Expense
    { normalizedMetric: 'income_tax_expense', displayName: 'Income tax expense', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Less: Net income attributable to noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net income attributable to JPMorgan Chase & Co.', format: 'currency' },
    
    // Preferred Stock Dividends
    { normalizedMetric: 'preferred_stock_dividends', displayName: 'Preferred stock dividends', format: 'currency' },
    
    // Net Income Applicable to Common Stock
    { normalizedMetric: 'net_income_common', displayName: 'Net income applicable to common stockholders', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'PER SHARE DATA', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic earnings per share', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted earnings per share', format: 'eps' },
    
    // Weighted Average Shares
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Weighted-average basic shares', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Weighted-average diluted shares', format: 'number' },
    
    // Key Bank Ratios (optional - shown if data available)
    { normalizedMetric: 'ratios_header', displayName: 'KEY RATIOS', isHeader: true },
    { normalizedMetric: 'net_interest_margin', displayName: 'Net interest margin', format: 'percentage' },
    { normalizedMetric: 'efficiency_ratio', displayName: 'Efficiency ratio', format: 'percentage' },
    { normalizedMetric: 'return_on_equity', displayName: 'Return on equity', format: 'percentage' },
    { normalizedMetric: 'return_on_assets', displayName: 'Return on assets', format: 'percentage' },
    { normalizedMetric: 'return_on_tangible_common_equity', displayName: 'Return on tangible common equity', format: 'percentage' },
  ];

  // ============================================================
  // BANK/FINANCIAL SERVICES METRIC ADDITIONS (JPM, BAC, GS, etc.)
  // Used for backward compatibility and fallback
  // ============================================================
  static readonly BANK_INCOME_STATEMENT_ADDITIONS: MetricDefinition[] = [
    { normalizedMetric: 'net_interest_income', displayName: 'Net Interest Income', format: 'currency' },
    { normalizedMetric: 'interest_income_loans', displayName: 'Interest Income - Loans', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income_securities', displayName: 'Interest Income - Securities', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense_deposits', displayName: 'Interest Expense - Deposits', format: 'currency', indent: 1 },
    { normalizedMetric: 'noninterest_income', displayName: 'Noninterest Income', format: 'currency' },
    { normalizedMetric: 'investment_banking_fees', displayName: 'Investment Banking Fees', format: 'currency', indent: 1 },
    { normalizedMetric: 'trading_revenue', displayName: 'Trading Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'asset_management_fees', displayName: 'Asset Management Fees', format: 'currency', indent: 1 },
    { normalizedMetric: 'card_income', displayName: 'Card Income', format: 'currency', indent: 1 },
    { normalizedMetric: 'mortgage_banking_income', displayName: 'Mortgage Banking Income', format: 'currency', indent: 1 },
    { normalizedMetric: 'provision_credit_losses', displayName: 'Provision for Credit Losses', format: 'currency' },
    { normalizedMetric: 'noninterest_expense', displayName: 'Noninterest Expense', format: 'currency' },
    { normalizedMetric: 'compensation_expense', displayName: 'Compensation & Benefits', format: 'currency', indent: 1 },
    { normalizedMetric: 'occupancy_expense', displayName: 'Occupancy Expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'technology_expense', displayName: 'Technology & Communications', format: 'currency', indent: 1 },
    { normalizedMetric: 'professional_fees', displayName: 'Professional Fees', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_interest_margin', displayName: 'Net Interest Margin %', format: 'percentage' },
    { normalizedMetric: 'efficiency_ratio', displayName: 'Efficiency Ratio %', format: 'percentage' },
    { normalizedMetric: 'return_on_equity', displayName: 'Return on Equity %', format: 'percentage' },
    { normalizedMetric: 'return_on_assets', displayName: 'Return on Assets %', format: 'percentage' },
  ];

  static readonly BANK_BALANCE_SHEET_ADDITIONS: MetricDefinition[] = [
    { normalizedMetric: 'loans_net', displayName: 'Loans, Net of Allowance', format: 'currency', indent: 2 },
    { normalizedMetric: 'total_loans', displayName: 'Total Loans', format: 'currency', indent: 2 },
    { normalizedMetric: 'allowance_loan_losses', displayName: 'Allowance for Loan Losses', format: 'currency', indent: 3 },
    { normalizedMetric: 'commercial_loans', displayName: 'Commercial Loans', format: 'currency', indent: 3 },
    { normalizedMetric: 'consumer_loans', displayName: 'Consumer Loans', format: 'currency', indent: 3 },
    { normalizedMetric: 'mortgage_loans', displayName: 'Mortgage Loans', format: 'currency', indent: 3 },
    { normalizedMetric: 'trading_assets', displayName: 'Trading Assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'federal_funds_sold', displayName: 'Federal Funds Sold', format: 'currency', indent: 2 },
    { normalizedMetric: 'deposits', displayName: 'Total Deposits', format: 'currency', indent: 2 },
    { normalizedMetric: 'demand_deposits', displayName: 'Demand Deposits', format: 'currency', indent: 3 },
    { normalizedMetric: 'savings_deposits', displayName: 'Savings Deposits', format: 'currency', indent: 3 },
    { normalizedMetric: 'time_deposits', displayName: 'Time Deposits', format: 'currency', indent: 3 },
    { normalizedMetric: 'federal_funds_purchased', displayName: 'Federal Funds Purchased', format: 'currency', indent: 2 },
    { normalizedMetric: 'trading_liabilities', displayName: 'Trading Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'tier_1_capital_ratio', displayName: 'Tier 1 Capital Ratio %', format: 'percentage' },
    { normalizedMetric: 'total_capital_ratio', displayName: 'Total Capital Ratio %', format: 'percentage' },
    { normalizedMetric: 'leverage_ratio', displayName: 'Leverage Ratio %', format: 'percentage' },
  ];

  // ============================================================
  // TECH COMPANY INCOME STATEMENT (AAPL, MSFT, NVDA, GOOGL, etc.)
  // This replaces the generic income statement for tech companies
  // Matches Apple Inc. SEC 10-K Consolidated Statements of Operations exactly
  // Reference: AAPL 10-K FY2024 (aapl-20240928.htm)
  // ============================================================
  static readonly TECH_INCOME_STATEMENT: MetricDefinition[] = [
    // Net Sales Section
    { normalizedMetric: 'revenue_header', displayName: 'NET SALES', isHeader: true },
    { normalizedMetric: 'product_revenue', displayName: 'Products', format: 'currency', indent: 1 },
    { normalizedMetric: 'service_revenue', displayName: 'Services', format: 'currency', indent: 1 },
    { normalizedMetric: 'revenue', displayName: 'Total net sales', format: 'currency' },
    { normalizedMetric: 'net_sales', displayName: 'Total net sales', format: 'currency' },
    
    // Cost of Sales Section
    { normalizedMetric: 'cost_header', displayName: 'COST OF SALES', isHeader: true },
    { normalizedMetric: 'cost_of_products', displayName: 'Products', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_services', displayName: 'Services', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_revenue', displayName: 'Total cost of sales', format: 'currency' },
    { normalizedMetric: 'cost_of_sales', displayName: 'Total cost of sales', format: 'currency' },
    
    // Gross Margin
    { normalizedMetric: 'gross_profit', displayName: 'Gross margin', format: 'currency' },
    { normalizedMetric: 'gross_margin', displayName: 'Gross margin', format: 'currency' },
    
    // Operating Expenses Section
    { normalizedMetric: 'opex_header', displayName: 'OPERATING EXPENSES', isHeader: true },
    { normalizedMetric: 'research_and_development', displayName: 'Research and development', format: 'currency', indent: 1 },
    { normalizedMetric: 'research_development', displayName: 'Research and development', format: 'currency', indent: 1 },
    { normalizedMetric: 'selling_general_administrative', displayName: 'Selling, general and administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'sg_and_a', displayName: 'Selling, general and administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total operating expenses', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Operating income', format: 'currency' },
    
    // Other Income/(Expense)
    { normalizedMetric: 'other_income_expense', displayName: 'Other income/(expense), net', format: 'currency' },
    { normalizedMetric: 'other_income', displayName: 'Other income/(expense), net', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before provision for income taxes', format: 'currency' },
    
    // Provision for Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Provision for income taxes', format: 'currency' },
    { normalizedMetric: 'provision_for_income_taxes', displayName: 'Provision for income taxes', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
    
    // Shares Used in Computing EPS
    { normalizedMetric: 'shares_header', displayName: 'SHARES USED IN COMPUTING EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Basic', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Diluted', format: 'number' },
  ];

  // ============================================================
  // TECH COMPANY METRIC ADDITIONS (AAPL, MSFT, NVDA, etc.)
  // Used for backward compatibility and fallback
  // ============================================================
  static readonly TECH_INCOME_STATEMENT_ADDITIONS: MetricDefinition[] = [
    { normalizedMetric: 'product_revenue', displayName: 'Product Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'service_revenue', displayName: 'Service Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'subscription_revenue', displayName: 'Subscription Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'licensing_revenue', displayName: 'Licensing Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'cloud_revenue', displayName: 'Cloud Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'hardware_revenue', displayName: 'Hardware Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'software_revenue', displayName: 'Software Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'research_and_development', displayName: 'Research & Development', format: 'currency', indent: 1 },
    { normalizedMetric: 'stock_based_compensation', displayName: 'Stock-Based Compensation', format: 'currency', indent: 1 },
    { normalizedMetric: 'gross_margin_percentage', displayName: 'Gross Margin %', format: 'percentage' },
    { normalizedMetric: 'operating_margin', displayName: 'Operating Margin %', format: 'percentage' },
    { normalizedMetric: 'net_margin', displayName: 'Net Margin %', format: 'percentage' },
  ];

  // ============================================================
  // RETAIL/CONSUMER DISCRETIONARY INCOME STATEMENT (AMZN, WMT, HD, etc.)
  // Matches Amazon/Walmart SEC 10-K Consolidated Statements of Operations
  // Reference: AMZN 10-K FY2024, WMT 10-K FY2024
  // ============================================================
  static readonly RETAIL_INCOME_STATEMENT: MetricDefinition[] = [
    // Net Sales Section
    { normalizedMetric: 'revenue_header', displayName: 'NET SALES', isHeader: true },
    { normalizedMetric: 'product_sales', displayName: 'Product sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'service_sales', displayName: 'Service sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_sales', displayName: 'Total net sales', format: 'currency' },
    { normalizedMetric: 'revenue', displayName: 'Total net sales', format: 'currency' },
    
    // Operating Expenses Section
    { normalizedMetric: 'opex_header', displayName: 'OPERATING EXPENSES', isHeader: true },
    { normalizedMetric: 'cost_of_sales', displayName: 'Cost of sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_revenue', displayName: 'Cost of sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'fulfillment', displayName: 'Fulfillment', format: 'currency', indent: 1 },
    { normalizedMetric: 'technology_and_infrastructure', displayName: 'Technology and infrastructure', format: 'currency', indent: 1 },
    { normalizedMetric: 'sales_and_marketing', displayName: 'Sales and marketing', format: 'currency', indent: 1 },
    { normalizedMetric: 'general_and_administrative', displayName: 'General and administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_operating_expense', displayName: 'Other operating expense (income), net', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total operating expenses', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Operating income', format: 'currency' },
    
    // Non-Operating Items
    { normalizedMetric: 'interest_income', displayName: 'Interest income', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_income_expense', displayName: 'Other income (expense), net', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_non_operating', displayName: 'Total non-operating income (expense)', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income taxes', format: 'currency' },
    
    // Provision for Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Provision for income taxes', format: 'currency' },
    { normalizedMetric: 'equity_method_investment_activity', displayName: 'Equity-method investment activity, net of tax', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
    
    // Weighted Average Shares
    { normalizedMetric: 'shares_header', displayName: 'WEIGHTED-AVERAGE SHARES', isHeader: true },
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Basic', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Diluted', format: 'number' },
  ];

  // ============================================================
  // ENERGY COMPANY INCOME STATEMENT (XOM, CVX, COP, etc.)
  // Matches ExxonMobil SEC 10-K Consolidated Statement of Income
  // Reference: XOM 10-K FY2024
  // ============================================================
  static readonly ENERGY_INCOME_STATEMENT: MetricDefinition[] = [
    // Revenues Section
    { normalizedMetric: 'revenue_header', displayName: 'REVENUES AND OTHER INCOME', isHeader: true },
    { normalizedMetric: 'sales_and_other_operating_revenue', displayName: 'Sales and other operating revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'income_from_equity_affiliates', displayName: 'Income from equity affiliates', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_income', displayName: 'Other income', format: 'currency', indent: 1 },
    { normalizedMetric: 'revenue', displayName: 'Total revenues and other income', format: 'currency' },
    
    // Costs and Expenses Section
    { normalizedMetric: 'costs_header', displayName: 'COSTS AND OTHER DEDUCTIONS', isHeader: true },
    { normalizedMetric: 'crude_oil_and_product_purchases', displayName: 'Crude oil and product purchases', format: 'currency', indent: 1 },
    { normalizedMetric: 'production_and_manufacturing', displayName: 'Production and manufacturing expenses', format: 'currency', indent: 1 },
    { normalizedMetric: 'selling_general_administrative', displayName: 'Selling, general and administrative expenses', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation_and_depletion', displayName: 'Depreciation and depletion', format: 'currency', indent: 1 },
    { normalizedMetric: 'exploration_expenses', displayName: 'Exploration expenses, including dry holes', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_taxes_and_duties', displayName: 'Other taxes and duties', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total costs and other deductions', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income taxes', format: 'currency' },
    
    // Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Income taxes', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income including noncontrolling interests', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Net income attributable to noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net income attributable to ExxonMobil', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER COMMON SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
  ];

  // ============================================================
  // UTILITY COMPANY INCOME STATEMENT (NEE, DUK, SO, etc.)
  // Matches NextEra Energy SEC 10-K Consolidated Statements of Income
  // Reference: NEE 10-K FY2024
  // ============================================================
  static readonly UTILITY_INCOME_STATEMENT: MetricDefinition[] = [
    // Operating Revenues Section
    { normalizedMetric: 'revenue_header', displayName: 'OPERATING REVENUES', isHeader: true },
    { normalizedMetric: 'electric_revenue', displayName: 'Electric', format: 'currency', indent: 1 },
    { normalizedMetric: 'gas_revenue', displayName: 'Gas', format: 'currency', indent: 1 },
    { normalizedMetric: 'revenue', displayName: 'Total operating revenues', format: 'currency' },
    
    // Operating Expenses Section
    { normalizedMetric: 'opex_header', displayName: 'OPERATING EXPENSES', isHeader: true },
    { normalizedMetric: 'fuel_purchased_power_interchange', displayName: 'Fuel, purchased power and interchange', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_gas_sold', displayName: 'Cost of gas sold', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_operations_and_maintenance', displayName: 'Other operations and maintenance', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation_amortization', displayName: 'Depreciation and amortization', format: 'currency', indent: 1 },
    { normalizedMetric: 'taxes_other_than_income', displayName: 'Taxes other than income taxes', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total operating expenses', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Operating income', format: 'currency' },
    
    // Other Income (Deductions)
    { normalizedMetric: 'other_header', displayName: 'OTHER INCOME (DEDUCTIONS)', isHeader: true },
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'equity_earnings_unconsolidated', displayName: 'Equity in earnings of equity method investees', format: 'currency', indent: 1 },
    { normalizedMetric: 'allowance_equity_funds', displayName: 'Allowance for equity funds used during construction', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income', displayName: 'Interest income', format: 'currency', indent: 1 },
    { normalizedMetric: 'gains_disposal_assets', displayName: 'Gains on disposal of businesses/assets', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_net', displayName: 'Other - net', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_other_income', displayName: 'Total other income (deductions)', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income taxes', format: 'currency' },
    
    // Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Income tax expense (benefit)', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Less net income attributable to noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net income attributable to NEE', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
  ];

  // ============================================================
  // REIT INCOME STATEMENT (AMT, PLD, EQIX, etc.)
  // Matches American Tower SEC 10-K Consolidated Statements of Operations
  // Reference: AMT 10-K FY2024
  // ============================================================
  static readonly REIT_INCOME_STATEMENT: MetricDefinition[] = [
    // Revenues Section
    { normalizedMetric: 'revenue_header', displayName: 'REVENUES', isHeader: true },
    { normalizedMetric: 'property_revenue', displayName: 'Property revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'services_and_other_revenue', displayName: 'Services and other revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'revenue', displayName: 'Total revenues', format: 'currency' },
    
    // Operating Expenses Section
    { normalizedMetric: 'opex_header', displayName: 'OPERATING EXPENSES', isHeader: true },
    { normalizedMetric: 'cost_of_revenue', displayName: 'Cost of revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'selling_general_administrative', displayName: 'Selling, general, administrative and development expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation_amortization_accretion', displayName: 'Depreciation, amortization and accretion', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total operating expenses', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Operating income', format: 'currency' },
    
    // Other Income (Expense)
    { normalizedMetric: 'other_header', displayName: 'OTHER INCOME (EXPENSE)', isHeader: true },
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income', displayName: 'Interest income', format: 'currency', indent: 1 },
    { normalizedMetric: 'loss_retirement_long_term_obligations', displayName: 'Loss on retirement of long-term obligations', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_expense', displayName: 'Other expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_other_expense', displayName: 'Total other expense', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income taxes', format: 'currency' },
    
    // Income Tax Provision
    { normalizedMetric: 'income_tax_expense', displayName: 'Income tax provision', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Less: Net income attributable to noncontrolling interest', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net income attributable to American Tower Corporation', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
    
    // Weighted Average Shares
    { normalizedMetric: 'shares_header', displayName: 'WEIGHTED AVERAGE COMMON SHARES OUTSTANDING', isHeader: true },
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Basic', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Diluted', format: 'number' },
  ];

  // ============================================================
  // CONSUMER STAPLES INCOME STATEMENT (PG, KO, PEP, WMT, etc.)
  // Matches Procter & Gamble SEC 10-K Consolidated Statements of Earnings
  // Reference: PG 10-K FY2024
  // ============================================================
  static readonly CONSUMER_STAPLES_INCOME_STATEMENT: MetricDefinition[] = [
    // Net Sales Section
    { normalizedMetric: 'revenue_header', displayName: 'NET SALES', isHeader: true },
    { normalizedMetric: 'net_sales', displayName: 'Net sales', format: 'currency' },
    { normalizedMetric: 'revenue', displayName: 'Net sales', format: 'currency' },
    
    // Cost and Expenses Section
    { normalizedMetric: 'costs_header', displayName: 'COSTS AND EXPENSES', isHeader: true },
    { normalizedMetric: 'cost_of_products_sold', displayName: 'Cost of products sold', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_revenue', displayName: 'Cost of products sold', format: 'currency', indent: 1 },
    { normalizedMetric: 'selling_general_administrative', displayName: 'Selling, general and administrative expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total costs and expenses', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Operating income', format: 'currency' },
    
    // Non-Operating Items
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income', displayName: 'Interest income', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_non_operating_income', displayName: 'Other non-operating income (expense), net', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_non_operating', displayName: 'Total non-operating income (expense)', format: 'currency' },
    
    // Earnings Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Earnings before income taxes', format: 'currency' },
    
    // Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Income taxes', format: 'currency' },
    
    // Net Earnings
    { normalizedMetric: 'net_income', displayName: 'Net earnings', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Less: Net earnings attributable to noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net earnings attributable to Procter & Gamble', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic net earnings per common share', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted net earnings per common share', format: 'eps' },
    
    // Dividends Per Share
    { normalizedMetric: 'dividends_per_share', displayName: 'Dividends per common share', format: 'currency' },
  ];

  // ============================================================
  // INDUSTRIALS INCOME STATEMENT (UNP, CAT, BA, HON, etc.)
  // Matches Union Pacific SEC 10-K Consolidated Statements of Income
  // Reference: UNP 10-K FY2024
  // ============================================================
  static readonly INDUSTRIALS_INCOME_STATEMENT: MetricDefinition[] = [
    // Operating Revenues Section
    { normalizedMetric: 'revenue_header', displayName: 'OPERATING REVENUES', isHeader: true },
    { normalizedMetric: 'freight_revenues', displayName: 'Freight revenues', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_revenues', displayName: 'Other revenues', format: 'currency', indent: 1 },
    { normalizedMetric: 'revenue', displayName: 'Total operating revenues', format: 'currency' },
    
    // Operating Expenses Section
    { normalizedMetric: 'opex_header', displayName: 'OPERATING EXPENSES', isHeader: true },
    { normalizedMetric: 'compensation_and_benefits', displayName: 'Compensation and benefits', format: 'currency', indent: 1 },
    { normalizedMetric: 'fuel', displayName: 'Fuel', format: 'currency', indent: 1 },
    { normalizedMetric: 'purchased_services_and_materials', displayName: 'Purchased services and materials', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation', displayName: 'Depreciation', format: 'currency', indent: 1 },
    { normalizedMetric: 'equipment_and_other_rents', displayName: 'Equipment and other rents', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_operating_expenses', displayName: 'Other', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total operating expenses', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Operating income', format: 'currency' },
    
    // Other Income (Expense)
    { normalizedMetric: 'other_header', displayName: 'OTHER INCOME (EXPENSE)', isHeader: true },
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_income', displayName: 'Interest income', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_income', displayName: 'Other income', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_other_income', displayName: 'Total other income (expense)', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income taxes', format: 'currency' },
    
    // Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Income taxes', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
    
    // Weighted Average Shares
    { normalizedMetric: 'shares_header', displayName: 'WEIGHTED AVERAGE SHARES', isHeader: true },
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Basic', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Diluted', format: 'number' },
  ];

  // ============================================================
  // MATERIALS COMPANY INCOME STATEMENT (LIN, APD, SHW, ECL, etc.)
  // Matches Linde plc SEC 10-K Consolidated Statements of Income
  // Reference: LIN 10-K FY2024
  // ============================================================
  static readonly MATERIALS_INCOME_STATEMENT: MetricDefinition[] = [
    // Sales Section
    { normalizedMetric: 'revenue_header', displayName: 'SALES', isHeader: true },
    { normalizedMetric: 'net_sales', displayName: 'Sales', format: 'currency' },
    { normalizedMetric: 'revenue', displayName: 'Sales', format: 'currency' },
    
    // Cost and Expenses Section
    { normalizedMetric: 'costs_header', displayName: 'COSTS AND EXPENSES', isHeader: true },
    { normalizedMetric: 'cost_of_sales', displayName: 'Cost of sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_revenue', displayName: 'Cost of sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'selling_general_administrative', displayName: 'Selling, general and administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'research_and_development', displayName: 'Research and development', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation_amortization', displayName: 'Depreciation and amortization', format: 'currency', indent: 1 },
    { normalizedMetric: 'restructuring_charges', displayName: 'Restructuring charges', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_operating_expenses', displayName: 'Other operating expenses (income)', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total costs and expenses', format: 'currency' },
    
    // Operating Profit
    { normalizedMetric: 'operating_income', displayName: 'Operating profit', format: 'currency' },
    
    // Non-Operating Items
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense - net', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_income_expense', displayName: 'Other income (expenses) - net', format: 'currency', indent: 1 },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Income before income taxes', format: 'currency' },
    
    // Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Income tax expense', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net income', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Less: Net income attributable to noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net income attributable to Linde plc', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
    
    // Weighted Average Shares
    { normalizedMetric: 'shares_header', displayName: 'WEIGHTED AVERAGE SHARES OUTSTANDING', isHeader: true },
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Basic', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Diluted', format: 'number' },
  ];

  // ============================================================
  // HEALTHCARE COMPANY INCOME STATEMENT (UNH, JNJ, PFE, etc.)
  // Matches UnitedHealth Group SEC 10-K Consolidated Statements of Operations
  // Reference: UNH 10-K FY2024
  // ============================================================
  static readonly HEALTHCARE_INCOME_STATEMENT: MetricDefinition[] = [
    // Revenues Section
    { normalizedMetric: 'revenue_header', displayName: 'REVENUES', isHeader: true },
    { normalizedMetric: 'premiums', displayName: 'Premiums', format: 'currency', indent: 1 },
    { normalizedMetric: 'products_revenue', displayName: 'Products', format: 'currency', indent: 1 },
    { normalizedMetric: 'services_revenue', displayName: 'Services', format: 'currency', indent: 1 },
    { normalizedMetric: 'investment_other_income', displayName: 'Investment and other income', format: 'currency', indent: 1 },
    { normalizedMetric: 'revenue', displayName: 'Total revenues', format: 'currency' },
    
    // Operating Costs Section
    { normalizedMetric: 'costs_header', displayName: 'OPERATING COSTS', isHeader: true },
    { normalizedMetric: 'medical_costs', displayName: 'Medical costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_costs', displayName: 'Operating costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_products_sold', displayName: 'Cost of products sold', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation_amortization', displayName: 'Depreciation and amortization', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total operating costs', format: 'currency' },
    
    // Operating Income
    { normalizedMetric: 'operating_income', displayName: 'Earnings from operations', format: 'currency' },
    
    // Interest Expense
    { normalizedMetric: 'interest_expense', displayName: 'Interest expense', format: 'currency' },
    
    // Income Before Taxes
    { normalizedMetric: 'income_before_taxes', displayName: 'Earnings before income taxes', format: 'currency' },
    
    // Income Taxes
    { normalizedMetric: 'income_tax_expense', displayName: 'Provision for income taxes', format: 'currency' },
    
    // Net Income
    { normalizedMetric: 'net_income', displayName: 'Net earnings', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Net earnings attributable to noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net earnings attributable to UnitedHealth Group', format: 'currency' },
    
    // Per Share Data
    { normalizedMetric: 'eps_header', displayName: 'EARNINGS PER SHARE', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted', format: 'eps' },
    
    // Weighted Average Shares
    { normalizedMetric: 'shares_header', displayName: 'WEIGHTED-AVERAGE SHARES', isHeader: true },
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Basic', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Diluted', format: 'number' },
  ];

  // ============================================================
  // INSURANCE COMPANY METRIC ADDITIONS (BRK, MET, PRU, etc.)
  // ============================================================
  static readonly INSURANCE_INCOME_STATEMENT_ADDITIONS: MetricDefinition[] = [
    { normalizedMetric: 'premiums_earned', displayName: 'Premiums Earned', format: 'currency' },
    { normalizedMetric: 'net_premiums_written', displayName: 'Net Premiums Written', format: 'currency', indent: 1 },
    { normalizedMetric: 'policy_charges', displayName: 'Policy Charges & Fees', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_investment_income', displayName: 'Net Investment Income', format: 'currency' },
    { normalizedMetric: 'realized_investment_gains', displayName: 'Realized Investment Gains (Losses)', format: 'currency', indent: 1 },
    { normalizedMetric: 'claims_and_benefits', displayName: 'Claims & Benefits Paid', format: 'currency' },
    { normalizedMetric: 'policyholder_benefits', displayName: 'Policyholder Benefits', format: 'currency', indent: 1 },
    { normalizedMetric: 'policy_acquisition_costs', displayName: 'Policy Acquisition Costs', format: 'currency' },
    { normalizedMetric: 'underwriting_expense', displayName: 'Underwriting Expense', format: 'currency' },
    { normalizedMetric: 'loss_ratio', displayName: 'Loss Ratio %', format: 'percentage' },
    { normalizedMetric: 'expense_ratio', displayName: 'Expense Ratio %', format: 'percentage' },
    { normalizedMetric: 'combined_ratio', displayName: 'Combined Ratio %', format: 'percentage' },
  ];

  // ============================================================
  // REIT METRIC ADDITIONS (Real Estate Investment Trusts)
  // ============================================================
  static readonly REIT_INCOME_STATEMENT_ADDITIONS: MetricDefinition[] = [
    { normalizedMetric: 'rental_revenue', displayName: 'Rental Revenue', format: 'currency' },
    { normalizedMetric: 'tenant_reimbursements', displayName: 'Tenant Reimbursements', format: 'currency', indent: 1 },
    { normalizedMetric: 'property_operating_expenses', displayName: 'Property Operating Expenses', format: 'currency' },
    { normalizedMetric: 'real_estate_taxes', displayName: 'Real Estate Taxes', format: 'currency', indent: 1 },
    { normalizedMetric: 'property_management_fees', displayName: 'Property Management Fees', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_operating_income', displayName: 'Net Operating Income (NOI)', format: 'currency' },
    { normalizedMetric: 'funds_from_operations', displayName: 'Funds from Operations (FFO)', format: 'currency' },
    { normalizedMetric: 'adjusted_ffo', displayName: 'Adjusted FFO (AFFO)', format: 'currency' },
    { normalizedMetric: 'ffo_per_share', displayName: 'FFO Per Share', format: 'eps' },
    { normalizedMetric: 'affo_per_share', displayName: 'AFFO Per Share', format: 'eps' },
    { normalizedMetric: 'occupancy_rate', displayName: 'Occupancy Rate %', format: 'percentage' },
    { normalizedMetric: 'same_store_noi_growth', displayName: 'Same-Store NOI Growth %', format: 'percentage' },
  ];

  // ============================================================
  // UTILITY COMPANY METRIC ADDITIONS (NEE, DUK, SO, etc.)
  // ============================================================
  static readonly UTILITY_INCOME_STATEMENT_ADDITIONS: MetricDefinition[] = [
    { normalizedMetric: 'electric_revenue', displayName: 'Electric Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'gas_revenue', displayName: 'Gas Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'fuel_costs', displayName: 'Fuel Costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'purchased_power', displayName: 'Purchased Power', format: 'currency', indent: 1 },
    { normalizedMetric: 'transmission_costs', displayName: 'Transmission Costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'distribution_costs', displayName: 'Distribution Costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'regulatory_assets', displayName: 'Regulatory Assets', format: 'currency' },
    { normalizedMetric: 'regulatory_liabilities', displayName: 'Regulatory Liabilities', format: 'currency' },
    { normalizedMetric: 'rate_base', displayName: 'Rate Base', format: 'currency' },
    { normalizedMetric: 'allowed_roe', displayName: 'Allowed ROE %', format: 'percentage' },
  ];

  // ============================================================
  // TELECOM COMPANY METRIC ADDITIONS (T, VZ, TMUS, etc.)
  // ============================================================
  static readonly TELECOM_INCOME_STATEMENT_ADDITIONS: MetricDefinition[] = [
    { normalizedMetric: 'wireless_revenue', displayName: 'Wireless Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'wireline_revenue', displayName: 'Wireline Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'equipment_revenue', displayName: 'Equipment Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'service_revenue', displayName: 'Service Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'network_costs', displayName: 'Network Costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_equipment', displayName: 'Cost of Equipment', format: 'currency', indent: 1 },
    { normalizedMetric: 'subscriber_acquisition_costs', displayName: 'Subscriber Acquisition Costs', format: 'currency', indent: 1 },
    { normalizedMetric: 'arpu', displayName: 'Average Revenue Per User (ARPU)', format: 'currency' },
    { normalizedMetric: 'churn_rate', displayName: 'Churn Rate %', format: 'percentage' },
    { normalizedMetric: 'subscriber_count', displayName: 'Subscriber Count', format: 'number' },
    { normalizedMetric: 'postpaid_subscribers', displayName: 'Postpaid Subscribers', format: 'number', indent: 1 },
    { normalizedMetric: 'prepaid_subscribers', displayName: 'Prepaid Subscribers', format: 'number', indent: 1 },
  ];

  // ============================================================
  // BANK BALANCE SHEET (JPM, BAC, WFC, C, GS, MS, etc.)
  // Matches JPMorgan Chase SEC 10-K Consolidated Balance Sheets
  // Reference: JPM 10-K FY2024 (jpm-20241231.htm)
  // Banks have fundamentally different balance sheet structure than other companies
  // ============================================================
  static readonly BANK_BALANCE_SHEET: MetricDefinition[] = [
    // ASSETS
    { normalizedMetric: 'assets_header', displayName: 'ASSETS', isHeader: true },
    
    // Cash and deposits with banks
    { normalizedMetric: 'cash_deposits_banks', displayName: 'Cash and due from banks', format: 'currency', indent: 1 },
    { normalizedMetric: 'deposits_with_banks', displayName: 'Deposits with banks', format: 'currency', indent: 1 },
    { normalizedMetric: 'federal_funds_sold', displayName: 'Federal funds sold and securities purchased under resale agreements', format: 'currency', indent: 1 },
    
    // Securities
    { normalizedMetric: 'securities_header', displayName: 'Securities', isHeader: true, indent: 1 },
    { normalizedMetric: 'trading_assets', displayName: 'Trading assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'securities_available_for_sale', displayName: 'Securities available-for-sale', format: 'currency', indent: 2 },
    { normalizedMetric: 'securities_held_to_maturity', displayName: 'Securities held-to-maturity', format: 'currency', indent: 2 },
    
    // Loans
    { normalizedMetric: 'loans_header', displayName: 'Loans', isHeader: true, indent: 1 },
    { normalizedMetric: 'loans_gross', displayName: 'Loans', format: 'currency', indent: 2 },
    { normalizedMetric: 'allowance_loan_losses', displayName: 'Allowance for loan losses', format: 'currency', indent: 2 },
    { normalizedMetric: 'loans_net', displayName: 'Loans, net of allowance', format: 'currency', indent: 2 },
    
    // Other assets
    { normalizedMetric: 'accrued_interest_fees_receivable', displayName: 'Accrued interest and accounts receivable', format: 'currency', indent: 1 },
    { normalizedMetric: 'premises_equipment', displayName: 'Premises and equipment', format: 'currency', indent: 1 },
    { normalizedMetric: 'goodwill', displayName: 'Goodwill', format: 'currency', indent: 1 },
    { normalizedMetric: 'intangible_assets', displayName: 'Mortgage servicing rights and other intangibles', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_assets', displayName: 'Other assets', format: 'currency', indent: 1 },
    
    // Total Assets
    { normalizedMetric: 'total_assets', displayName: 'Total assets', format: 'currency' },
    
    // LIABILITIES
    { normalizedMetric: 'liabilities_header', displayName: 'LIABILITIES', isHeader: true },
    
    // Deposits
    { normalizedMetric: 'deposits_header', displayName: 'Deposits', isHeader: true, indent: 1 },
    { normalizedMetric: 'noninterest_bearing_deposits', displayName: 'Noninterest-bearing', format: 'currency', indent: 2 },
    { normalizedMetric: 'interest_bearing_deposits', displayName: 'Interest-bearing', format: 'currency', indent: 2 },
    { normalizedMetric: 'deposits', displayName: 'Total deposits', format: 'currency', indent: 1 },
    
    // Borrowings
    { normalizedMetric: 'federal_funds_purchased', displayName: 'Federal funds purchased and securities loaned or sold under repurchase agreements', format: 'currency', indent: 1 },
    { normalizedMetric: 'commercial_paper', displayName: 'Commercial paper', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_borrowed_funds', displayName: 'Other borrowed funds', format: 'currency', indent: 1 },
    { normalizedMetric: 'trading_liabilities', displayName: 'Trading liabilities', format: 'currency', indent: 1 },
    { normalizedMetric: 'accounts_payable_accrued_expenses', displayName: 'Accounts payable and other liabilities', format: 'currency', indent: 1 },
    { normalizedMetric: 'beneficial_interests_vie', displayName: 'Beneficial interests issued by consolidated VIEs', format: 'currency', indent: 1 },
    { normalizedMetric: 'long_term_debt', displayName: 'Long-term debt', format: 'currency', indent: 1 },
    
    // Total Liabilities
    { normalizedMetric: 'total_liabilities', displayName: 'Total liabilities', format: 'currency' },
    
    // STOCKHOLDERS' EQUITY
    { normalizedMetric: 'equity_header', displayName: "STOCKHOLDERS' EQUITY", isHeader: true },
    { normalizedMetric: 'preferred_stock', displayName: 'Preferred stock', format: 'currency', indent: 1 },
    { normalizedMetric: 'common_stock', displayName: 'Common stock', format: 'currency', indent: 1 },
    { normalizedMetric: 'additional_paid_in_capital', displayName: 'Additional paid-in capital', format: 'currency', indent: 1 },
    { normalizedMetric: 'retained_earnings', displayName: 'Retained earnings', format: 'currency', indent: 1 },
    { normalizedMetric: 'accumulated_other_comprehensive_income', displayName: 'Accumulated other comprehensive income (loss)', format: 'currency', indent: 1 },
    { normalizedMetric: 'treasury_stock', displayName: 'Treasury stock, at cost', format: 'currency', indent: 1 },
    { normalizedMetric: 'stockholders_equity', displayName: "Total stockholders' equity", format: 'currency' },
    { normalizedMetric: 'noncontrolling_interests', displayName: 'Noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_equity', displayName: 'Total equity', format: 'currency' },
    
    // Total Liabilities and Equity
    { normalizedMetric: 'total_liabilities_equity', displayName: 'Total liabilities and equity', format: 'currency' },
    
    // KEY BANK RATIOS
    { normalizedMetric: 'ratios_header', displayName: 'KEY BANK RATIOS', isHeader: true },
    { normalizedMetric: 'tier_1_capital_ratio', displayName: 'Tier 1 Capital Ratio', format: 'percentage' },
    { normalizedMetric: 'total_capital_ratio', displayName: 'Total Capital Ratio', format: 'percentage' },
    { normalizedMetric: 'leverage_ratio', displayName: 'Leverage Ratio', format: 'percentage' },
    { normalizedMetric: 'common_equity_tier_1_ratio', displayName: 'Common Equity Tier 1 Ratio', format: 'percentage' },
    { normalizedMetric: 'loan_to_deposit_ratio', displayName: 'Loan-to-Deposit Ratio', format: 'percentage' },
    { normalizedMetric: 'return_on_tangible_common_equity', displayName: 'Return on Tangible Common Equity', format: 'percentage' },
  ];

  // ============================================================
  // REIT (Real Estate Investment Trust) Balance Sheet Template
  // REITs have significant property and equipment assets (towers, buildings, land)
  // ============================================================
  static readonly REIT_BALANCE_SHEET: MetricDefinition[] = [
    // ASSETS
    { normalizedMetric: 'assets_header', displayName: 'ASSETS', isHeader: true },
    
    // Current Assets
    { normalizedMetric: 'current_assets_header', displayName: 'Current assets', isHeader: true, indent: 1 },
    { normalizedMetric: 'cash_and_cash_equivalents', displayName: 'Cash and cash equivalents', format: 'currency', indent: 2 },
    { normalizedMetric: 'restricted_cash', displayName: 'Restricted cash', format: 'currency', indent: 2 },
    { normalizedMetric: 'accounts_receivable_net', displayName: 'Accounts receivable, net', format: 'currency', indent: 2 },
    { normalizedMetric: 'prepaid_expenses_current', displayName: 'Prepaid and other current assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_assets', displayName: 'Total current assets', format: 'currency', indent: 1 },
    
    // Property and Equipment (major asset for REITs)
    { normalizedMetric: 'property_equipment_header', displayName: 'Property and equipment', isHeader: true, indent: 1 },
    { normalizedMetric: 'property_equipment_gross', displayName: 'Property and equipment, gross', format: 'currency', indent: 2 },
    { normalizedMetric: 'accumulated_depreciation', displayName: 'Less: Accumulated depreciation', format: 'currency', indent: 2 },
    { normalizedMetric: 'property_equipment_net', displayName: 'Property and equipment, net', format: 'currency', indent: 1 },
    
    // Intangible Assets
    { normalizedMetric: 'intangible_assets_header', displayName: 'Intangible assets', isHeader: true, indent: 1 },
    { normalizedMetric: 'goodwill', displayName: 'Goodwill', format: 'currency', indent: 2 },
    { normalizedMetric: 'intangible_assets_net', displayName: 'Other intangible assets, net', format: 'currency', indent: 2 },
    { normalizedMetric: 'intangible_assets_total', displayName: 'Total intangible assets, net', format: 'currency', indent: 1 },
    
    // Other Non-Current Assets
    { normalizedMetric: 'other_noncurrent_assets', displayName: 'Deferred financing costs and other non-current assets', format: 'currency', indent: 1 },
    
    // Total Assets
    { normalizedMetric: 'total_assets', displayName: 'Total assets', format: 'currency' },
    
    // LIABILITIES
    { normalizedMetric: 'liabilities_header', displayName: 'LIABILITIES', isHeader: true },
    
    // Current Liabilities
    { normalizedMetric: 'current_liabilities_header', displayName: 'Current liabilities', isHeader: true, indent: 1 },
    { normalizedMetric: 'accounts_payable_accrued_expenses', displayName: 'Accounts payable and accrued expenses', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_revenue_current', displayName: 'Deferred revenue', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_portion_long_term_debt', displayName: 'Current portion of long-term debt', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_current_liabilities', displayName: 'Other current liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_liabilities', displayName: 'Total current liabilities', format: 'currency', indent: 1 },
    
    // Non-Current Liabilities
    { normalizedMetric: 'long_term_debt', displayName: 'Long-term debt', format: 'currency', indent: 1 },
    { normalizedMetric: 'deferred_tax_liabilities', displayName: 'Deferred tax liabilities', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_noncurrent_liabilities', displayName: 'Other non-current liabilities', format: 'currency', indent: 1 },
    
    // Total Liabilities
    { normalizedMetric: 'total_liabilities', displayName: 'Total liabilities', format: 'currency' },
    
    // EQUITY
    { normalizedMetric: 'equity_header', displayName: 'EQUITY', isHeader: true },
    
    // Stockholders' Equity
    { normalizedMetric: 'stockholders_equity_header', displayName: "Stockholders' equity", isHeader: true, indent: 1 },
    { normalizedMetric: 'common_stock', displayName: 'Common stock', format: 'currency', indent: 2 },
    { normalizedMetric: 'additional_paid_in_capital', displayName: 'Additional paid-in capital', format: 'currency', indent: 2 },
    { normalizedMetric: 'accumulated_other_comprehensive_income', displayName: 'Accumulated other comprehensive loss', format: 'currency', indent: 2 },
    { normalizedMetric: 'retained_earnings', displayName: 'Retained earnings (accumulated deficit)', format: 'currency', indent: 2 },
    { normalizedMetric: 'stockholders_equity', displayName: "Total stockholders' equity", format: 'currency', indent: 1 },
    { normalizedMetric: 'noncontrolling_interests', displayName: 'Noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_equity', displayName: 'Total equity', format: 'currency' },
    
    // Total Liabilities and Equity
    { normalizedMetric: 'total_liabilities_equity', displayName: 'Total liabilities and equity', format: 'currency' },
  ];

  // ============================================================
  // UTILITY Balance Sheet Template
  // Utilities have significant property, plant and equipment (generation, transmission, distribution)
  // and regulatory assets/liabilities unique to rate-regulated utilities
  // ============================================================
  static readonly UTILITY_BALANCE_SHEET: MetricDefinition[] = [
    // ASSETS
    { normalizedMetric: 'assets_header', displayName: 'ASSETS', isHeader: true },
    
    // Current Assets
    { normalizedMetric: 'current_assets_header', displayName: 'Current assets', isHeader: true, indent: 1 },
    { normalizedMetric: 'cash_and_cash_equivalents', displayName: 'Cash and cash equivalents', format: 'currency', indent: 2 },
    { normalizedMetric: 'accounts_receivable_net', displayName: 'Customer receivables, net', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_receivables', displayName: 'Other receivables', format: 'currency', indent: 2 },
    { normalizedMetric: 'inventory', displayName: 'Materials, supplies and fossil fuel inventory', format: 'currency', indent: 2 },
    { normalizedMetric: 'regulatory_assets_current', displayName: 'Regulatory assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_current_assets', displayName: 'Other current assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_assets', displayName: 'Total current assets', format: 'currency', indent: 1 },
    
    // Property, Plant and Equipment (major utility asset)
    { normalizedMetric: 'property_plant_equipment_header', displayName: 'Property, plant and equipment', isHeader: true, indent: 1 },
    { normalizedMetric: 'property_plant_equipment_gross', displayName: 'Property, plant and equipment', format: 'currency', indent: 2 },
    { normalizedMetric: 'accumulated_depreciation', displayName: 'Less: Accumulated depreciation and amortization', format: 'currency', indent: 2 },
    { normalizedMetric: 'property_plant_equipment_net', displayName: 'Property, plant and equipment, net', format: 'currency', indent: 1 },
    
    // Other Assets (including regulatory assets)
    { normalizedMetric: 'other_assets_header', displayName: 'Other assets', isHeader: true, indent: 1 },
    { normalizedMetric: 'regulatory_assets_noncurrent', displayName: 'Regulatory assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'goodwill', displayName: 'Goodwill', format: 'currency', indent: 2 },
    { normalizedMetric: 'intangible_assets_net', displayName: 'Other intangible assets, net', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_noncurrent_assets', displayName: 'Other non-current assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_assets_total', displayName: 'Total other assets', format: 'currency', indent: 1 },
    
    // Total Assets
    { normalizedMetric: 'total_assets', displayName: 'Total assets', format: 'currency' },
    
    // LIABILITIES AND EQUITY
    { normalizedMetric: 'liabilities_equity_header', displayName: 'LIABILITIES AND EQUITY', isHeader: true },
    
    // Current Liabilities
    { normalizedMetric: 'current_liabilities_header', displayName: 'Current liabilities', isHeader: true, indent: 1 },
    { normalizedMetric: 'accounts_payable', displayName: 'Accounts payable', format: 'currency', indent: 2 },
    { normalizedMetric: 'customer_deposits', displayName: 'Customer deposits', format: 'currency', indent: 2 },
    { normalizedMetric: 'accrued_interest_taxes', displayName: 'Accrued interest and taxes', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_portion_long_term_debt', displayName: 'Current portion of long-term debt', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_current_liabilities', displayName: 'Other current liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_liabilities', displayName: 'Total current liabilities', format: 'currency', indent: 1 },
    
    // Other Liabilities and Deferred Credits
    { normalizedMetric: 'other_liabilities_header', displayName: 'Other liabilities and deferred credits', isHeader: true, indent: 1 },
    { normalizedMetric: 'long_term_debt', displayName: 'Long-term debt', format: 'currency', indent: 2 },
    { normalizedMetric: 'regulatory_liabilities', displayName: 'Regulatory liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_tax_liabilities', displayName: 'Deferred income taxes', format: 'currency', indent: 2 },
    { normalizedMetric: 'asset_retirement_obligations', displayName: 'Asset retirement obligations', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_noncurrent_liabilities', displayName: 'Other non-current liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_liabilities_total', displayName: 'Total other liabilities and deferred credits', format: 'currency', indent: 1 },
    
    // Total Liabilities
    { normalizedMetric: 'total_liabilities', displayName: 'Total liabilities', format: 'currency' },
    
    // Equity
    { normalizedMetric: 'equity_header', displayName: 'Equity', isHeader: true, indent: 1 },
    { normalizedMetric: 'common_stock', displayName: 'Common stock', format: 'currency', indent: 2 },
    { normalizedMetric: 'additional_paid_in_capital', displayName: 'Additional paid-in capital', format: 'currency', indent: 2 },
    { normalizedMetric: 'retained_earnings', displayName: 'Retained earnings', format: 'currency', indent: 2 },
    { normalizedMetric: 'accumulated_other_comprehensive_income', displayName: 'Accumulated other comprehensive loss', format: 'currency', indent: 2 },
    { normalizedMetric: 'stockholders_equity', displayName: 'Total equity attributable to NextEra Energy, Inc.', format: 'currency', indent: 1 },
    { normalizedMetric: 'noncontrolling_interests', displayName: 'Noncontrolling interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_equity', displayName: 'Total equity', format: 'currency' },
    
    // Total Liabilities and Equity
    { normalizedMetric: 'total_liabilities_equity', displayName: 'Total liabilities and equity', format: 'currency' },
  ];

  // Comprehensive Income Statement metrics (45+ line items)
  static readonly INCOME_STATEMENT_METRICS: MetricDefinition[] = [
    // Revenue Section
    { normalizedMetric: 'revenue_header', displayName: 'REVENUE', isHeader: true },
    { normalizedMetric: 'revenue', displayName: 'Total Revenue', format: 'currency' },
    { normalizedMetric: 'product_revenue', displayName: 'Product Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'service_revenue', displayName: 'Service Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'subscription_revenue', displayName: 'Subscription Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'advertising_revenue', displayName: 'Advertising Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'licensing_revenue', displayName: 'Licensing Revenue', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_revenue', displayName: 'Other Revenue', format: 'currency', indent: 1 },

    // Cost of Revenue Section
    { normalizedMetric: 'cost_header', displayName: 'COST OF REVENUE', isHeader: true },
    { normalizedMetric: 'cost_of_revenue', displayName: 'Total Cost of Revenue', format: 'currency' },
    { normalizedMetric: 'cost_of_products', displayName: 'Cost of Products', format: 'currency', indent: 1 },
    { normalizedMetric: 'cost_of_services', displayName: 'Cost of Services', format: 'currency', indent: 1 },

    // Gross Profit Section
    { normalizedMetric: 'gross_profit', displayName: 'Gross Profit', format: 'currency' },
    { normalizedMetric: 'gross_margin', displayName: 'Gross Margin %', format: 'percentage' },

    // Operating Expenses Section
    { normalizedMetric: 'opex_header', displayName: 'OPERATING EXPENSES', isHeader: true },
    { normalizedMetric: 'research_development', displayName: 'Research & Development', format: 'currency', indent: 1 },
    { normalizedMetric: 'research_and_development', displayName: 'Research & Development', format: 'currency', indent: 1 },
    { normalizedMetric: 'selling_general_administrative', displayName: 'Selling, General & Administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'sg_and_a', displayName: 'Selling, General & Administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'sales_and_marketing', displayName: 'Sales & Marketing', format: 'currency', indent: 1 },
    { normalizedMetric: 'marketing_expense', displayName: 'Marketing & Advertising', format: 'currency', indent: 1 },
    { normalizedMetric: 'general_administrative', displayName: 'General & Administrative', format: 'currency', indent: 1 },
    { normalizedMetric: 'depreciation_amortization_opex', displayName: 'Depreciation & Amortization', format: 'currency', indent: 1 },
    { normalizedMetric: 'restructuring_charges', displayName: 'Restructuring Charges', format: 'currency', indent: 1 },
    { normalizedMetric: 'impairment_charges', displayName: 'Impairment Charges', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_operating_expenses', displayName: 'Other Operating Expenses', format: 'currency', indent: 1 },
    { normalizedMetric: 'operating_expenses', displayName: 'Total Operating Expenses', format: 'currency' },

    // Operating Income Section
    { normalizedMetric: 'operating_income', displayName: 'Operating Income (EBIT)', format: 'currency' },
    { normalizedMetric: 'operating_margin', displayName: 'Operating Margin %', format: 'percentage' },
    { normalizedMetric: 'ebitda', displayName: 'EBITDA', format: 'currency' },
    { normalizedMetric: 'ebitda_margin', displayName: 'EBITDA Margin %', format: 'percentage' },

    // Non-Operating Section
    { normalizedMetric: 'nonop_header', displayName: 'NON-OPERATING ITEMS', isHeader: true },
    { normalizedMetric: 'interest_income', displayName: 'Interest Income', format: 'currency', indent: 1 },
    { normalizedMetric: 'interest_expense', displayName: 'Interest Expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_interest_expense', displayName: 'Net Interest Expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_income_expense', displayName: 'Other Income (Expense)', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_income', displayName: 'Other Income', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_expense', displayName: 'Other Expense', format: 'currency', indent: 1 },
    { normalizedMetric: 'equity_method_investments', displayName: 'Equity Method Investments', format: 'currency', indent: 1 },
    { normalizedMetric: 'foreign_exchange_gain_loss', displayName: 'Foreign Exchange Gain (Loss)', format: 'currency', indent: 1 },
    { normalizedMetric: 'gain_loss_investments', displayName: 'Gain (Loss) on Investments', format: 'currency', indent: 1 },

    // Pre-Tax Income Section
    { normalizedMetric: 'income_before_taxes', displayName: 'Income Before Taxes', format: 'currency' },
    { normalizedMetric: 'pretax_income', displayName: 'Income Before Taxes', format: 'currency' },
    { normalizedMetric: 'income_tax_expense', displayName: 'Income Tax Expense', format: 'currency' },
    { normalizedMetric: 'provision_for_income_taxes', displayName: 'Provision for Income Taxes', format: 'currency' },
    { normalizedMetric: 'effective_tax_rate', displayName: 'Effective Tax Rate %', format: 'percentage' },

    // Net Income Section
    { normalizedMetric: 'net_income_header', displayName: 'NET INCOME', isHeader: true },
    { normalizedMetric: 'net_income_continuing', displayName: 'Net Income from Continuing Operations', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_discontinued', displayName: 'Net Income from Discontinued Operations', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income', displayName: 'Net Income', format: 'currency' },
    { normalizedMetric: 'net_income_noncontrolling', displayName: 'Less: Net Income Attributable to Noncontrolling Interests', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income_attributable', displayName: 'Net Income Attributable to Common', format: 'currency' },
    { normalizedMetric: 'net_margin', displayName: 'Net Margin %', format: 'percentage' },

    // Per Share Data Section
    { normalizedMetric: 'eps_header', displayName: 'PER SHARE DATA', isHeader: true },
    { normalizedMetric: 'earnings_per_share_basic', displayName: 'Basic EPS', format: 'eps' },
    { normalizedMetric: 'eps_basic', displayName: 'Basic EPS', format: 'eps' },
    { normalizedMetric: 'earnings_per_share_diluted', displayName: 'Diluted EPS', format: 'eps' },
    { normalizedMetric: 'eps_diluted', displayName: 'Diluted EPS', format: 'eps' },
    { normalizedMetric: 'weighted_avg_shares_basic', displayName: 'Weighted Avg Shares (Basic)', format: 'number' },
    { normalizedMetric: 'weighted_avg_shares_diluted', displayName: 'Weighted Avg Shares (Diluted)', format: 'number' },
    { normalizedMetric: 'shares_outstanding', displayName: 'Shares Outstanding', format: 'number' },
    { normalizedMetric: 'dividends_per_share', displayName: 'Dividends Per Share', format: 'currency' },
  ];

  // Comprehensive Balance Sheet metrics (70+ line items)
  static readonly BALANCE_SHEET_METRICS: MetricDefinition[] = [
    // ASSETS
    { normalizedMetric: 'assets_header', displayName: 'ASSETS', isHeader: true },

    // Current Assets
    { normalizedMetric: 'current_assets_header', displayName: 'Current Assets', isHeader: true, indent: 1 },
    { normalizedMetric: 'cash_and_equivalents', displayName: 'Cash and Cash Equivalents', format: 'currency', indent: 2 },
    { normalizedMetric: 'cash', displayName: 'Cash and Cash Equivalents', format: 'currency', indent: 2 },
    { normalizedMetric: 'short_term_investments', displayName: 'Short-term Investments', format: 'currency', indent: 2 },
    { normalizedMetric: 'marketable_securities', displayName: 'Marketable Securities', format: 'currency', indent: 2 },
    { normalizedMetric: 'marketable_securities_current', displayName: 'Marketable Securities (Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'accounts_receivable', displayName: 'Accounts Receivable, Net', format: 'currency', indent: 2 },
    { normalizedMetric: 'accounts_receivable_net', displayName: 'Accounts Receivable, Net', format: 'currency', indent: 2 },
    { normalizedMetric: 'allowance_doubtful_accounts', displayName: 'Allowance for Doubtful Accounts', format: 'currency', indent: 3 },
    { normalizedMetric: 'inventory', displayName: 'Inventory', format: 'currency', indent: 2 },
    { normalizedMetric: 'inventories', displayName: 'Inventories', format: 'currency', indent: 2 },
    { normalizedMetric: 'raw_materials', displayName: 'Raw Materials', format: 'currency', indent: 3 },
    { normalizedMetric: 'work_in_progress', displayName: 'Work in Progress', format: 'currency', indent: 3 },
    { normalizedMetric: 'finished_goods', displayName: 'Finished Goods', format: 'currency', indent: 3 },
    { normalizedMetric: 'prepaid_expenses', displayName: 'Prepaid Expenses', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_tax_assets_current', displayName: 'Deferred Tax Assets (Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_current_assets', displayName: 'Other Current Assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_assets', displayName: 'Total Current Assets', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_current_assets', displayName: 'Total Current Assets', format: 'currency', indent: 1 },

    // Non-Current Assets
    { normalizedMetric: 'noncurrent_assets_header', displayName: 'Non-Current Assets', isHeader: true, indent: 1 },
    { normalizedMetric: 'property_plant_equipment_gross', displayName: 'Property, Plant & Equipment (Gross)', format: 'currency', indent: 2 },
    { normalizedMetric: 'accumulated_depreciation', displayName: 'Accumulated Depreciation', format: 'currency', indent: 2 },
    { normalizedMetric: 'property_plant_equipment', displayName: 'Property, Plant & Equipment (Net)', format: 'currency', indent: 2 },
    { normalizedMetric: 'ppe_net', displayName: 'Property, Plant & Equipment (Net)', format: 'currency', indent: 2 },
    { normalizedMetric: 'operating_lease_right_of_use', displayName: 'Operating Lease Right-of-Use Assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'goodwill', displayName: 'Goodwill', format: 'currency', indent: 2 },
    { normalizedMetric: 'intangible_assets', displayName: 'Intangible Assets, Net', format: 'currency', indent: 2 },
    { normalizedMetric: 'intangibles_net', displayName: 'Intangible Assets, Net', format: 'currency', indent: 2 },
    { normalizedMetric: 'long_term_investments', displayName: 'Long-term Investments', format: 'currency', indent: 2 },
    { normalizedMetric: 'marketable_securities_noncurrent', displayName: 'Marketable Securities (Non-Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_tax_assets_noncurrent', displayName: 'Deferred Tax Assets (Non-Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_tax_assets', displayName: 'Deferred Tax Assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_non_current_assets', displayName: 'Other Non-Current Assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_assets', displayName: 'Other Assets', format: 'currency', indent: 2 },
    { normalizedMetric: 'total_non_current_assets', displayName: 'Total Non-Current Assets', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_assets', displayName: 'TOTAL ASSETS', format: 'currency' },
    { normalizedMetric: 'assets', displayName: 'TOTAL ASSETS', format: 'currency' },

    // LIABILITIES
    { normalizedMetric: 'liabilities_header', displayName: 'LIABILITIES', isHeader: true },

    // Current Liabilities
    { normalizedMetric: 'current_liabilities_header', displayName: 'Current Liabilities', isHeader: true, indent: 1 },
    { normalizedMetric: 'accounts_payable', displayName: 'Accounts Payable', format: 'currency', indent: 2 },
    { normalizedMetric: 'accrued_liabilities', displayName: 'Accrued Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'accrued_expenses', displayName: 'Accrued Expenses', format: 'currency', indent: 2 },
    { normalizedMetric: 'accrued_compensation', displayName: 'Accrued Compensation', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_revenue_current', displayName: 'Deferred Revenue (Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_revenue', displayName: 'Deferred Revenue', format: 'currency', indent: 2 },
    { normalizedMetric: 'short_term_debt', displayName: 'Short-term Debt', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_portion_long_term_debt', displayName: 'Current Portion of Long-term Debt', format: 'currency', indent: 2 },
    { normalizedMetric: 'commercial_paper', displayName: 'Commercial Paper', format: 'currency', indent: 2 },
    { normalizedMetric: 'operating_lease_liabilities_current', displayName: 'Operating Lease Liabilities (Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'income_taxes_payable', displayName: 'Income Taxes Payable', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_current_liabilities', displayName: 'Other Current Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'current_liabilities', displayName: 'Total Current Liabilities', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_current_liabilities', displayName: 'Total Current Liabilities', format: 'currency', indent: 1 },

    // Non-Current Liabilities
    { normalizedMetric: 'noncurrent_liabilities_header', displayName: 'Non-Current Liabilities', isHeader: true, indent: 1 },
    { normalizedMetric: 'long_term_debt', displayName: 'Long-term Debt', format: 'currency', indent: 2 },
    { normalizedMetric: 'term_debt', displayName: 'Term Debt', format: 'currency', indent: 2 },
    { normalizedMetric: 'operating_lease_liabilities_noncurrent', displayName: 'Operating Lease Liabilities (Non-Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_revenue_noncurrent', displayName: 'Deferred Revenue (Non-Current)', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_tax_liabilities', displayName: 'Deferred Tax Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'pension_liabilities', displayName: 'Pension & Post-Retirement Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_non_current_liabilities', displayName: 'Other Non-Current Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_liabilities', displayName: 'Other Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'total_non_current_liabilities', displayName: 'Total Non-Current Liabilities', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_liabilities', displayName: 'TOTAL LIABILITIES', format: 'currency' },
    { normalizedMetric: 'liabilities', displayName: 'TOTAL LIABILITIES', format: 'currency' },

    // STOCKHOLDERS' EQUITY
    { normalizedMetric: 'equity_header', displayName: "STOCKHOLDERS' EQUITY", isHeader: true },
    { normalizedMetric: 'preferred_stock', displayName: 'Preferred Stock', format: 'currency', indent: 1 },
    { normalizedMetric: 'common_stock', displayName: 'Common Stock', format: 'currency', indent: 1 },
    { normalizedMetric: 'additional_paid_in_capital', displayName: 'Additional Paid-in Capital', format: 'currency', indent: 1 },
    { normalizedMetric: 'retained_earnings', displayName: 'Retained Earnings', format: 'currency', indent: 1 },
    { normalizedMetric: 'treasury_stock', displayName: 'Treasury Stock', format: 'currency', indent: 1 },
    { normalizedMetric: 'accumulated_other_comprehensive_income', displayName: 'Accumulated Other Comprehensive Income (Loss)', format: 'currency', indent: 1 },
    { normalizedMetric: 'aoci', displayName: 'Accumulated Other Comprehensive Income (Loss)', format: 'currency', indent: 1 },
    { normalizedMetric: 'shareholders_equity', displayName: "Total Stockholders' Equity", format: 'currency' },
    { normalizedMetric: 'stockholders_equity', displayName: "Total Stockholders' Equity", format: 'currency' },
    { normalizedMetric: 'noncontrolling_interest', displayName: 'Non-controlling Interest', format: 'currency', indent: 1 },
    { normalizedMetric: 'total_equity', displayName: 'Total Equity', format: 'currency' },
    { normalizedMetric: 'total_liabilities_equity', displayName: 'TOTAL LIABILITIES & EQUITY', format: 'currency' },
    { normalizedMetric: 'liabilities_and_equity', displayName: 'TOTAL LIABILITIES & EQUITY', format: 'currency' },

    // Key Ratios Section
    { normalizedMetric: 'ratios_header', displayName: 'KEY BALANCE SHEET RATIOS', isHeader: true },
    { normalizedMetric: 'current_ratio', displayName: 'Current Ratio', format: 'number' },
    { normalizedMetric: 'quick_ratio', displayName: 'Quick Ratio', format: 'number' },
    { normalizedMetric: 'debt_to_equity', displayName: 'Debt to Equity Ratio', format: 'number' },
    { normalizedMetric: 'debt_to_assets', displayName: 'Debt to Assets Ratio', format: 'percentage' },
    { normalizedMetric: 'working_capital', displayName: 'Working Capital', format: 'currency' },
    { normalizedMetric: 'book_value_per_share', displayName: 'Book Value Per Share', format: 'currency' },
    { normalizedMetric: 'tangible_book_value', displayName: 'Tangible Book Value', format: 'currency' },
  ];


  // Comprehensive Cash Flow Statement metrics (50+ line items)
  static readonly CASH_FLOW_METRICS: MetricDefinition[] = [
    // Operating Activities
    { normalizedMetric: 'operating_header', displayName: 'CASH FLOWS FROM OPERATING ACTIVITIES', isHeader: true },
    { normalizedMetric: 'net_income_cf', displayName: 'Net Income', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_income', displayName: 'Net Income', format: 'currency', indent: 1 },

    // Adjustments to reconcile net income
    { normalizedMetric: 'adjustments_header', displayName: 'Adjustments to Reconcile Net Income:', isHeader: true, indent: 1 },
    { normalizedMetric: 'depreciation_amortization', displayName: 'Depreciation & Amortization', format: 'currency', indent: 2 },
    { normalizedMetric: 'depreciation', displayName: 'Depreciation', format: 'currency', indent: 2 },
    { normalizedMetric: 'amortization', displayName: 'Amortization', format: 'currency', indent: 2 },
    { normalizedMetric: 'stock_based_compensation', displayName: 'Stock-Based Compensation', format: 'currency', indent: 2 },
    { normalizedMetric: 'share_based_compensation', displayName: 'Share-Based Compensation', format: 'currency', indent: 2 },
    { normalizedMetric: 'deferred_income_taxes', displayName: 'Deferred Income Taxes', format: 'currency', indent: 2 },
    { normalizedMetric: 'impairment_charges', displayName: 'Impairment Charges', format: 'currency', indent: 2 },
    { normalizedMetric: 'gain_loss_investments', displayName: 'Gain/Loss on Investments', format: 'currency', indent: 2 },
    { normalizedMetric: 'gain_loss_asset_sales', displayName: 'Gain/Loss on Asset Sales', format: 'currency', indent: 2 },
    { normalizedMetric: 'other_non_cash_items', displayName: 'Other Non-Cash Items', format: 'currency', indent: 2 },

    // Changes in working capital
    { normalizedMetric: 'working_capital_header', displayName: 'Changes in Working Capital:', isHeader: true, indent: 1 },
    { normalizedMetric: 'change_accounts_receivable', displayName: 'Change in Accounts Receivable', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_receivables', displayName: 'Change in Receivables', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_inventory', displayName: 'Change in Inventory', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_inventories', displayName: 'Change in Inventories', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_prepaid_expenses', displayName: 'Change in Prepaid Expenses', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_accounts_payable', displayName: 'Change in Accounts Payable', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_payables', displayName: 'Change in Payables', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_accrued_liabilities', displayName: 'Change in Accrued Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_deferred_revenue', displayName: 'Change in Deferred Revenue', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_other_working_capital', displayName: 'Change in Other Working Capital', format: 'currency', indent: 2 },
    { normalizedMetric: 'change_other_assets_liabilities', displayName: 'Change in Other Assets/Liabilities', format: 'currency', indent: 2 },
    { normalizedMetric: 'operating_cash_flow', displayName: 'Net Cash from Operating Activities', format: 'currency' },
    { normalizedMetric: 'cash_from_operations', displayName: 'Net Cash from Operating Activities', format: 'currency' },
    { normalizedMetric: 'net_cash_operating', displayName: 'Net Cash from Operating Activities', format: 'currency' },

    // Investing Activities
    { normalizedMetric: 'investing_header', displayName: 'CASH FLOWS FROM INVESTING ACTIVITIES', isHeader: true },
    { normalizedMetric: 'capital_expenditures', displayName: 'Capital Expenditures', format: 'currency', indent: 1 },
    { normalizedMetric: 'capex', displayName: 'Capital Expenditures', format: 'currency', indent: 1 },
    { normalizedMetric: 'acquisitions', displayName: 'Acquisitions, Net of Cash', format: 'currency', indent: 1 },
    { normalizedMetric: 'business_acquisitions', displayName: 'Business Acquisitions', format: 'currency', indent: 1 },
    { normalizedMetric: 'divestitures', displayName: 'Divestitures/Asset Sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'proceeds_asset_sales', displayName: 'Proceeds from Asset Sales', format: 'currency', indent: 1 },
    { normalizedMetric: 'purchases_investments', displayName: 'Purchases of Investments', format: 'currency', indent: 1 },
    { normalizedMetric: 'purchases_marketable_securities', displayName: 'Purchases of Marketable Securities', format: 'currency', indent: 1 },
    { normalizedMetric: 'sales_maturities_investments', displayName: 'Sales/Maturities of Investments', format: 'currency', indent: 1 },
    { normalizedMetric: 'proceeds_marketable_securities', displayName: 'Proceeds from Marketable Securities', format: 'currency', indent: 1 },
    { normalizedMetric: 'purchases_intangibles', displayName: 'Purchases of Intangible Assets', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_investing_activities', displayName: 'Other Investing Activities', format: 'currency', indent: 1 },
    { normalizedMetric: 'investing_cash_flow', displayName: 'Net Cash from Investing Activities', format: 'currency' },
    { normalizedMetric: 'cash_from_investing', displayName: 'Net Cash from Investing Activities', format: 'currency' },
    { normalizedMetric: 'net_cash_investing', displayName: 'Net Cash from Investing Activities', format: 'currency' },

    // Financing Activities
    { normalizedMetric: 'financing_header', displayName: 'CASH FLOWS FROM FINANCING ACTIVITIES', isHeader: true },
    { normalizedMetric: 'debt_issued', displayName: 'Proceeds from Debt Issuance', format: 'currency', indent: 1 },
    { normalizedMetric: 'proceeds_debt', displayName: 'Proceeds from Debt', format: 'currency', indent: 1 },
    { normalizedMetric: 'debt_repaid', displayName: 'Repayment of Debt', format: 'currency', indent: 1 },
    { normalizedMetric: 'repayment_debt', displayName: 'Repayment of Debt', format: 'currency', indent: 1 },
    { normalizedMetric: 'common_stock_issued', displayName: 'Proceeds from Stock Issuance', format: 'currency', indent: 1 },
    { normalizedMetric: 'proceeds_stock_issuance', displayName: 'Proceeds from Stock Issuance', format: 'currency', indent: 1 },
    { normalizedMetric: 'share_repurchases', displayName: 'Share Repurchases', format: 'currency', indent: 1 },
    { normalizedMetric: 'stock_repurchases', displayName: 'Stock Repurchases', format: 'currency', indent: 1 },
    { normalizedMetric: 'repurchase_common_stock', displayName: 'Repurchase of Common Stock', format: 'currency', indent: 1 },
    { normalizedMetric: 'dividends_paid', displayName: 'Dividends Paid', format: 'currency', indent: 1 },
    { normalizedMetric: 'cash_dividends', displayName: 'Cash Dividends Paid', format: 'currency', indent: 1 },
    { normalizedMetric: 'stock_option_exercises', displayName: 'Proceeds from Stock Option Exercises', format: 'currency', indent: 1 },
    { normalizedMetric: 'tax_withholding_stock_comp', displayName: 'Tax Withholding on Stock Compensation', format: 'currency', indent: 1 },
    { normalizedMetric: 'other_financing_activities', displayName: 'Other Financing Activities', format: 'currency', indent: 1 },
    { normalizedMetric: 'financing_cash_flow', displayName: 'Net Cash from Financing Activities', format: 'currency' },
    { normalizedMetric: 'cash_from_financing', displayName: 'Net Cash from Financing Activities', format: 'currency' },
    { normalizedMetric: 'net_cash_financing', displayName: 'Net Cash from Financing Activities', format: 'currency' },

    // Summary Section
    { normalizedMetric: 'summary_header', displayName: 'CASH FLOW SUMMARY', isHeader: true },
    { normalizedMetric: 'effect_exchange_rate', displayName: 'Effect of Exchange Rate Changes', format: 'currency', indent: 1 },
    { normalizedMetric: 'fx_effect', displayName: 'Effect of Exchange Rate Changes', format: 'currency', indent: 1 },
    { normalizedMetric: 'net_change_in_cash', displayName: 'Net Change in Cash', format: 'currency' },
    { normalizedMetric: 'change_in_cash', displayName: 'Net Change in Cash', format: 'currency' },
    { normalizedMetric: 'cash_beginning_period', displayName: 'Cash at Beginning of Period', format: 'currency', indent: 1 },
    { normalizedMetric: 'beginning_cash', displayName: 'Cash at Beginning of Period', format: 'currency', indent: 1 },
    { normalizedMetric: 'cash_end_period', displayName: 'Cash at End of Period', format: 'currency', indent: 1 },
    { normalizedMetric: 'ending_cash', displayName: 'Cash at End of Period', format: 'currency', indent: 1 },

    // Key Cash Flow Metrics
    { normalizedMetric: 'metrics_header', displayName: 'KEY CASH FLOW METRICS', isHeader: true },
    { normalizedMetric: 'free_cash_flow', displayName: 'Free Cash Flow (OCF - CapEx)', format: 'currency' },
    { normalizedMetric: 'fcf', displayName: 'Free Cash Flow', format: 'currency' },
    { normalizedMetric: 'free_cash_flow_margin', displayName: 'Free Cash Flow Margin %', format: 'percentage' },
    { normalizedMetric: 'fcf_margin', displayName: 'Free Cash Flow Margin %', format: 'percentage' },
    { normalizedMetric: 'levered_free_cash_flow', displayName: 'Levered Free Cash Flow', format: 'currency' },
    { normalizedMetric: 'unlevered_free_cash_flow', displayName: 'Unlevered Free Cash Flow', format: 'currency' },
    { normalizedMetric: 'cash_conversion_ratio', displayName: 'Cash Conversion Ratio (OCF/Net Income)', format: 'percentage' },
    { normalizedMetric: 'capex_to_revenue', displayName: 'CapEx as % of Revenue', format: 'percentage' },
    { normalizedMetric: 'capex_to_depreciation', displayName: 'CapEx to D&A Ratio', format: 'number' },
  ];

  /**
   * Get statement configuration by type
   */
  getStatementConfig(type: StatementType): StatementConfig {
    switch (type) {
      case StatementType.INCOME_STATEMENT:
        return {
          type,
          displayName: 'Income Statement',
          worksheetName: 'Income Statement',
          metricOrder: StatementMapper.INCOME_STATEMENT_METRICS,
        };
      case StatementType.BALANCE_SHEET:
        return {
          type,
          displayName: 'Balance Sheet',
          worksheetName: 'Balance Sheet',
          metricOrder: StatementMapper.BALANCE_SHEET_METRICS,
        };
      case StatementType.CASH_FLOW:
        return {
          type,
          displayName: 'Cash Flow Statement',
          worksheetName: 'Cash Flow',
          metricOrder: StatementMapper.CASH_FLOW_METRICS,
        };
      default:
        throw new Error(`Unknown statement type: ${type}`);
    }
  }

  /**
   * Map raw metrics to organized statement rows
   */
  mapMetricsToStatement(
    rawMetrics: RawMetric[],
    statementType: StatementType,
    periods: string[],
  ): MetricRow[] {
    const config = this.getStatementConfig(statementType);
    const rows: MetricRow[] = [];

    // Create lookup maps for raw metrics (values and reporting units)
    // CRITICAL: Convert Prisma Decimal values to JavaScript numbers
    // Prisma returns Decimal fields as strings or Decimal objects, not native numbers
    const metricLookup = new Map<string, Map<string, number>>();
    const reportingUnitLookup = new Map<string, Map<string, string>>();
    
    for (const metric of rawMetrics) {
      const normalizedName = metric.normalized_metric?.toLowerCase() || '';
      
      // Initialize maps if needed
      if (!metricLookup.has(normalizedName)) {
        metricLookup.set(normalizedName, new Map());
        reportingUnitLookup.set(normalizedName, new Map());
      }
      
      // Convert value to number - handles Prisma Decimal (string) and native numbers
      const numericValue = metric.value !== null && metric.value !== undefined 
        ? Number(metric.value) 
        : 0;
      metricLookup.get(normalizedName)!.set(metric.fiscal_period, numericValue);
      
      // Store reporting unit (default to 'units' if not provided)
      const reportingUnit = metric.reporting_unit || 'units';
      reportingUnitLookup.get(normalizedName)!.set(metric.fiscal_period, reportingUnit);
    }

    // Track which metrics we've already added (to avoid duplicates from aliases)
    const addedDisplayNames = new Set<string>();

    // Process each metric in the configured order
    for (const metricDef of config.metricOrder) {
      // Skip if we've already added a metric with this display name
      if (addedDisplayNames.has(metricDef.displayName)) {
        continue;
      }

      const normalizedName = metricDef.normalizedMetric.toLowerCase();
      const periodValues = metricLookup.get(normalizedName);
      const periodUnits = reportingUnitLookup.get(normalizedName);

      // For headers, always include them
      if (metricDef.isHeader) {
        rows.push({
          displayName: metricDef.displayName,
          normalizedMetric: metricDef.normalizedMetric,
          values: new Map(),
          reportingUnits: new Map(),
          isHeader: true,
          indent: metricDef.indent,
        });
        addedDisplayNames.add(metricDef.displayName);
        continue;
      }

      // For data rows, only include if we have data
      if (periodValues && periodValues.size > 0) {
        const values = new Map<string, number | null>();
        const reportingUnits = new Map<string, string>();
        
        for (const period of periods) {
          // Try to match period - handle different formats
          let value: number | null = null;
          let unit: string = 'units';
          
          for (const [key, val] of periodValues.entries()) {
            if (this.periodsMatch(key, period)) {
              value = val;
              unit = periodUnits?.get(key) || 'units';
              break;
            }
          }
          values.set(period, value);
          reportingUnits.set(period, unit);
        }

        rows.push({
          displayName: metricDef.displayName,
          normalizedMetric: metricDef.normalizedMetric,
          values,
          reportingUnits,
          isHeader: false,
          indent: metricDef.indent,
          format: metricDef.format,
        });
        addedDisplayNames.add(metricDef.displayName);
      }
    }

    this.logger.log(`Mapped ${rows.length} rows for ${statementType}`);
    return rows;
  }

  /**
   * Map raw metrics to organized statement rows with dynamic discovery
   * This enhanced version discovers metrics not in the predefined configuration
   */
  mapMetricsToStatementWithDiscovery(
    rawMetrics: RawMetric[],
    statementType: StatementType,
    periods: string[],
    industry?: IndustryType,
  ): MetricRow[] {
    const rows: MetricRow[] = [];

    // For Communication Services sector (GICS 50), use the dedicated MEDIA_INCOME_STATEMENT template
    // which has the correct SEC 10-K structure for media companies like CMCSA, DIS, etc.
    let allMetricDefs: MetricDefinition[];
    if (industry === 'communication_services' && statementType === StatementType.INCOME_STATEMENT) {
      allMetricDefs = StatementMapper.MEDIA_INCOME_STATEMENT;
      this.logger.log('Using MEDIA_INCOME_STATEMENT template for Communication Services sector');
    } else if (industry === 'financials' && statementType === StatementType.INCOME_STATEMENT) {
      // For Financials sector (GICS 40), use the dedicated BANK_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for banks like JPM, BAC, WFC, etc.
      allMetricDefs = StatementMapper.BANK_INCOME_STATEMENT;
      this.logger.log('Using BANK_INCOME_STATEMENT template for Financials sector');
    } else if (industry === 'information_technology' && statementType === StatementType.INCOME_STATEMENT) {
      // For Information Technology sector (GICS 45), use the dedicated TECH_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for tech companies like AAPL, MSFT, NVDA, etc.
      allMetricDefs = StatementMapper.TECH_INCOME_STATEMENT;
      this.logger.log('Using TECH_INCOME_STATEMENT template for Information Technology sector');
    } else if (industry === 'consumer_discretionary' && statementType === StatementType.INCOME_STATEMENT) {
      // For Consumer Discretionary sector (GICS 25), use the dedicated RETAIL_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for retail companies like AMZN, WMT, HD, etc.
      allMetricDefs = StatementMapper.RETAIL_INCOME_STATEMENT;
      this.logger.log('Using RETAIL_INCOME_STATEMENT template for Consumer Discretionary sector');
    } else if (industry === 'energy' && statementType === StatementType.INCOME_STATEMENT) {
      // For Energy sector (GICS 10), use the dedicated ENERGY_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for energy companies like XOM, CVX, COP, etc.
      allMetricDefs = StatementMapper.ENERGY_INCOME_STATEMENT;
      this.logger.log('Using ENERGY_INCOME_STATEMENT template for Energy sector');
    } else if (industry === 'utilities' && statementType === StatementType.INCOME_STATEMENT) {
      // For Utilities sector (GICS 55), use the dedicated UTILITY_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for utility companies like NEE, DUK, SO, etc.
      allMetricDefs = StatementMapper.UTILITY_INCOME_STATEMENT;
      this.logger.log('Using UTILITY_INCOME_STATEMENT template for Utilities sector');
    } else if (industry === 'health_care' && statementType === StatementType.INCOME_STATEMENT) {
      // For Health Care sector (GICS 35), use the dedicated HEALTHCARE_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for healthcare companies like UNH, JNJ, PFE, etc.
      allMetricDefs = StatementMapper.HEALTHCARE_INCOME_STATEMENT;
      this.logger.log('Using HEALTHCARE_INCOME_STATEMENT template for Health Care sector');
    } else if (industry === 'real_estate' && statementType === StatementType.INCOME_STATEMENT) {
      // For Real Estate sector (GICS 60), use the dedicated REIT_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for REITs like AMT, PLD, EQIX, etc.
      allMetricDefs = StatementMapper.REIT_INCOME_STATEMENT;
      this.logger.log('Using REIT_INCOME_STATEMENT template for Real Estate sector');
    } else if (industry === 'consumer_staples' && statementType === StatementType.INCOME_STATEMENT) {
      // For Consumer Staples sector (GICS 30), use the dedicated CONSUMER_STAPLES_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for consumer staples companies like PG, KO, PEP, etc.
      allMetricDefs = StatementMapper.CONSUMER_STAPLES_INCOME_STATEMENT;
      this.logger.log('Using CONSUMER_STAPLES_INCOME_STATEMENT template for Consumer Staples sector');
    } else if (industry === 'industrials' && statementType === StatementType.INCOME_STATEMENT) {
      // For Industrials sector (GICS 20), use the dedicated INDUSTRIALS_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for industrial companies like UNP, CAT, BA, etc.
      allMetricDefs = StatementMapper.INDUSTRIALS_INCOME_STATEMENT;
      this.logger.log('Using INDUSTRIALS_INCOME_STATEMENT template for Industrials sector');
    } else if (industry === 'materials' && statementType === StatementType.INCOME_STATEMENT) {
      // For Materials sector (GICS 15), use the dedicated MATERIALS_INCOME_STATEMENT template
      // which has the correct SEC 10-K structure for materials companies like LIN, APD, SHW, etc.
      allMetricDefs = StatementMapper.MATERIALS_INCOME_STATEMENT;
      this.logger.log('Using MATERIALS_INCOME_STATEMENT template for Materials sector');
    } else if (industry === 'financials' && statementType === StatementType.BALANCE_SHEET) {
      // For Financials sector (GICS 40) balance sheets, use the dedicated BANK_BALANCE_SHEET template
      // Banks have fundamentally different balance sheet structure (loans, deposits, trading assets, etc.)
      allMetricDefs = StatementMapper.BANK_BALANCE_SHEET;
      this.logger.log('Using BANK_BALANCE_SHEET template for Financials sector');
    } else if (industry === 'real_estate' && statementType === StatementType.BALANCE_SHEET) {
      // For Real Estate sector (GICS 60) balance sheets, use the dedicated REIT_BALANCE_SHEET template
      // REITs have significant property and equipment assets (towers, buildings, land)
      allMetricDefs = StatementMapper.REIT_BALANCE_SHEET;
      this.logger.log('Using REIT_BALANCE_SHEET template for Real Estate sector');
    } else if (industry === 'utilities' && statementType === StatementType.BALANCE_SHEET) {
      // For Utilities sector (GICS 55) balance sheets, use the dedicated UTILITY_BALANCE_SHEET template
      // Utilities have significant property, plant and equipment and regulatory assets/liabilities
      allMetricDefs = StatementMapper.UTILITY_BALANCE_SHEET;
      this.logger.log('Using UTILITY_BALANCE_SHEET template for Utilities sector');
    } else {
      const config = this.getStatementConfig(statementType);
      const industryAdditions = this.getIndustryAdditions(statementType, industry);
      allMetricDefs = [...config.metricOrder, ...industryAdditions];
    }

    // Create lookup maps for raw metrics
    const metricLookup = new Map<string, Map<string, number>>();
    const reportingUnitLookup = new Map<string, Map<string, string>>();
    
    for (const metric of rawMetrics) {
      const normalizedName = metric.normalized_metric?.toLowerCase() || '';
      
      if (!metricLookup.has(normalizedName)) {
        metricLookup.set(normalizedName, new Map());
        reportingUnitLookup.set(normalizedName, new Map());
      }
      
      const numericValue = metric.value !== null && metric.value !== undefined 
        ? Number(metric.value) 
        : 0;
      metricLookup.get(normalizedName)!.set(metric.fiscal_period, numericValue);
      
      const reportingUnit = metric.reporting_unit || 'units';
      reportingUnitLookup.get(normalizedName)!.set(metric.fiscal_period, reportingUnit);
    }

    // Track which metrics we've processed
    const processedMetrics = new Set<string>();
    const addedDisplayNames = new Set<string>();

    // Helper function to get value from primary metric or its aliases
    const getValueWithAliases = (
      primaryMetric: string,
      period: string,
      metricLookup: Map<string, Map<string, number>>,
      reportingUnitLookup: Map<string, Map<string, string>>,
    ): { value: number | null; unit: string } => {
      // First try the primary metric
      const primaryValues = metricLookup.get(primaryMetric);
      if (primaryValues) {
        for (const [key, val] of primaryValues.entries()) {
          if (this.periodsMatch(key, period)) {
            const unit = reportingUnitLookup.get(primaryMetric)?.get(key) || 'units';
            return { value: val, unit };
          }
        }
      }

      // If not found, try aliases
      const aliases = METRIC_ALIASES[primaryMetric] || [];
      for (const alias of aliases) {
        const aliasValues = metricLookup.get(alias);
        if (aliasValues) {
          for (const [key, val] of aliasValues.entries()) {
            if (this.periodsMatch(key, period)) {
              const unit = reportingUnitLookup.get(alias)?.get(key) || 'units';
              return { value: val, unit };
            }
          }
        }
      }

      return { value: null, unit: 'units' };
    };

    // Process configured metrics first (in order)
    for (const metricDef of allMetricDefs) {
      if (addedDisplayNames.has(metricDef.displayName)) {
        continue;
      }

      const normalizedName = metricDef.normalizedMetric.toLowerCase();
      processedMetrics.add(normalizedName);
      
      // Also mark aliases as processed to avoid duplicates
      const aliases = METRIC_ALIASES[normalizedName] || [];
      for (const alias of aliases) {
        processedMetrics.add(alias);
      }

      if (metricDef.isHeader) {
        rows.push({
          displayName: metricDef.displayName,
          normalizedMetric: metricDef.normalizedMetric,
          values: new Map(),
          reportingUnits: new Map(),
          isHeader: true,
          indent: metricDef.indent,
        });
        addedDisplayNames.add(metricDef.displayName);
        continue;
      }

      // Check if we have any data for this metric (including aliases)
      const hasAnyData = metricLookup.has(normalizedName) || 
        aliases.some(alias => metricLookup.has(alias));

      if (hasAnyData) {
        const values = new Map<string, number | null>();
        const reportingUnits = new Map<string, string>();
        
        for (const period of periods) {
          const { value, unit } = getValueWithAliases(
            normalizedName,
            period,
            metricLookup,
            reportingUnitLookup,
          );
          values.set(period, value);
          reportingUnits.set(period, unit);
        }

        rows.push({
          displayName: metricDef.displayName,
          normalizedMetric: metricDef.normalizedMetric,
          values,
          reportingUnits,
          isHeader: false,
          indent: metricDef.indent,
          format: metricDef.format,
        });
        addedDisplayNames.add(metricDef.displayName);
      } else {
        // Task 16.3: Log skipped metrics (missing data)
        this.logger.debug(`Skipping metric '${metricDef.normalizedMetric}' (${metricDef.displayName}) - no data available`);
      }
    }

    // DYNAMIC DISCOVERY DISABLED - Only use predefined metrics to match SEC 10-K structure
    // The parser tags many metrics as 'income_statement' that actually belong to notes,
    // comprehensive income, or other sections. To ensure 100% match with SEC filings,
    // we only include metrics that are explicitly defined in our configuration.
    //
    // If you need to add new metrics, add them to:
    // - INCOME_STATEMENT_METRICS (for all companies)
    // - MEDIA_INCOME_STATEMENT_ADDITIONS (for media companies like CMCSA)
    // - Other industry-specific additions as needed

    this.logger.log(`Mapped ${rows.length} rows for ${statementType} (predefined metrics only, no dynamic discovery)`);
    return rows;
  }

  /**
   * Get industry-specific metric additions based on GICS sector
   * Maps GICS sectors to appropriate financial statement templates
   */
  private getIndustryAdditions(statementType: StatementType, industry?: IndustryType): MetricDefinition[] {
    if (!industry) {
      return [];
    }

    switch (industry) {
      // GICS 50 - Communication Services (Media, Telecom, Interactive Media)
      case 'communication_services':
        if (statementType === StatementType.INCOME_STATEMENT) {
          // Combine media and telecom additions for Communication Services
          return [
            ...StatementMapper.MEDIA_INCOME_STATEMENT_ADDITIONS,
            ...StatementMapper.TELECOM_INCOME_STATEMENT_ADDITIONS,
          ];
        }
        break;
        
      // GICS 40 - Financials (Banks, Insurance, Diversified Financials)
      case 'financials':
        if (statementType === StatementType.INCOME_STATEMENT) {
          // Combine bank and insurance additions for Financials sector
          return [
            ...StatementMapper.BANK_INCOME_STATEMENT_ADDITIONS,
            ...StatementMapper.INSURANCE_INCOME_STATEMENT_ADDITIONS,
          ];
        }
        if (statementType === StatementType.BALANCE_SHEET) {
          return StatementMapper.BANK_BALANCE_SHEET_ADDITIONS;
        }
        break;
        
      // GICS 55 - Utilities
      case 'utilities':
        if (statementType === StatementType.INCOME_STATEMENT) {
          return StatementMapper.UTILITY_INCOME_STATEMENT_ADDITIONS;
        }
        break;
        
      // GICS 60 - Real Estate (REITs)
      case 'real_estate':
        if (statementType === StatementType.INCOME_STATEMENT) {
          return StatementMapper.REIT_INCOME_STATEMENT_ADDITIONS;
        }
        break;
        
      // GICS 10 - Energy
      case 'energy':
        // TODO: Add energy-specific metrics (upstream/downstream, reserves, etc.)
        break;
        
      // GICS 15 - Materials
      case 'materials':
        // TODO: Add materials-specific metrics (commodity prices, production volumes, etc.)
        break;
        
      // GICS 20 - Industrials
      case 'industrials':
        // TODO: Add industrials-specific metrics (backlog, order book, etc.)
        break;
        
      // GICS 25 - Consumer Discretionary
      case 'consumer_discretionary':
        // TODO: Add consumer discretionary metrics (same-store sales, etc.)
        break;
        
      // GICS 30 - Consumer Staples
      case 'consumer_staples':
        // TODO: Add consumer staples metrics (organic growth, market share, etc.)
        break;
        
      // GICS 35 - Health Care
      case 'health_care':
        // TODO: Add health care metrics (R&D pipeline, patient volumes, etc.)
        break;
        
      // GICS 45 - Information Technology
      case 'information_technology':
        // TODO: Add tech-specific metrics (ARR, DAU/MAU, cloud revenue, etc.)
        break;
    }

    return [];
  }

  /**
   * Convert snake_case metric name to human-readable Title Case
   * Handles common financial abbreviations
   */
  humanizeMetricName(metricName: string): string {
    if (!metricName) {
      return 'Unknown Metric';
    }

    // Full metric name mappings (check these first before splitting)
    const fullNameMappings: Record<string, string> = {
      'sg_and_a': 'SG&A',
      'r_and_d': 'R&D',
      'selling_general_administrative': 'Selling, General & Administrative',
      'research_and_development': 'Research & Development',
      'property_plant_equipment': 'Property, Plant & Equipment',
      'property_plant_equipment_net': 'Property, Plant & Equipment (Net)',
      'property_plant_equipment_gross': 'Property, Plant & Equipment (Gross)',
    };

    // Check for full name match first
    const lowerName = metricName.toLowerCase();
    if (fullNameMappings[lowerName]) {
      return fullNameMappings[lowerName];
    }

    // Common abbreviation mappings for individual words
    const abbreviations: Record<string, string> = {
      'eps': 'EPS',
      'ebitda': 'EBITDA',
      'ebit': 'EBIT',
      'sga': 'SG&A',
      'rd': 'R&D',
      'ppe': 'PP&E',
      'aoci': 'AOCI',
      'ocf': 'Operating Cash Flow',
      'fcf': 'Free Cash Flow',
      'capex': 'CapEx',
      'roe': 'ROE',
      'roa': 'ROA',
      'roic': 'ROIC',
      'noi': 'NOI',
      'ffo': 'FFO',
      'affo': 'AFFO',
      'arpu': 'ARPU',
      'cogs': 'COGS',
      'gaap': 'GAAP',
      'ifrs': 'IFRS',
      'ttm': 'TTM',
      'yoy': 'YoY',
      'qoq': 'QoQ',
      'mom': 'MoM',
      'ytd': 'YTD',
      'ltm': 'LTM',
      'ntm': 'NTM',
      'cf': 'Cash Flow',
      'bs': 'Balance Sheet',
      'is': 'Income Statement',
      'fx': 'FX',
      'us': 'US',
      'uk': 'UK',
      'eu': 'EU',
    };

    // Split by underscore and process each word
    const words = metricName.toLowerCase().split('_');
    
    const processedWords = words.map((word, index) => {
      // Check if it's a known abbreviation
      if (abbreviations[word]) {
        return abbreviations[word];
      }

      // Check for combined abbreviations (e.g., 'sganda' -> 'SG&A')
      for (const [abbr, full] of Object.entries(abbreviations)) {
        if (word === abbr.replace(/_/g, '')) {
          return full;
        }
      }

      // Handle 'and' specially - keep lowercase unless at start
      if (word === 'and') {
        return index === 0 ? 'And' : '&';
      }

      // Handle 'of', 'the', 'in', 'for', 'to' - keep lowercase unless at start
      const lowercaseWords = ['of', 'the', 'in', 'for', 'to', 'from', 'by', 'on', 'at', 'per'];
      if (lowercaseWords.includes(word) && index !== 0) {
        return word;
      }

      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1);
    });

    return processedWords.join(' ');
  }

  /**
   * Infer the format type from metric name
   */
  private inferMetricFormat(metricName: string): 'currency' | 'percentage' | 'number' | 'eps' {
    const name = metricName.toLowerCase();

    // Percentage metrics
    if (name.includes('margin') || 
        name.includes('ratio') || 
        name.includes('rate') ||
        name.includes('percentage') ||
        name.includes('percent') ||
        name.includes('growth') ||
        name.includes('yield') ||
        name.includes('return_on')) {
      return 'percentage';
    }

    // EPS metrics
    if (name.includes('eps') || 
        name.includes('per_share') ||
        name.includes('earnings_per')) {
      return 'eps';
    }

    // Share count metrics
    if (name.includes('shares') && !name.includes('per_share')) {
      return 'number';
    }

    // Count/number metrics
    if (name.includes('count') || 
        name.includes('number') ||
        name.includes('subscribers') ||
        name.includes('employees') ||
        name.includes('stores') ||
        name.includes('units_sold')) {
      return 'number';
    }

    // Default to currency for financial metrics
    return 'currency';
  }

  /**
   * Check if two period strings match (handles different formats)
   */
  private periodsMatch(period1: string, period2: string): boolean {
    // Normalize both periods
    const normalize = (p: string) => {
      return p
        .replace(/FY/gi, '')
        .replace(/\s+/g, '')
        .toLowerCase();
    };

    const p1 = normalize(period1);
    const p2 = normalize(period2);

    // Direct match
    if (p1 === p2) return true;

    // Extract year and check
    const year1 = period1.match(/(\d{4})/)?.[1];
    const year2 = period2.match(/(\d{4})/)?.[1];

    if (year1 && year2 && year1 === year2) {
      // Check if both are annual or both have same quarter
      const q1 = period1.match(/Q(\d)/i)?.[1];
      const q2 = period2.match(/Q(\d)/i)?.[1];

      if (!q1 && !q2) return true; // Both annual
      if (q1 && q2 && q1 === q2) return true; // Same quarter
    }

    return false;
  }

  /**
   * Detect GICS sector from ticker
   * Uses the same mapping as export.service.ts for consistency
   */
  detectIndustry(ticker: string): IndustryType | undefined {
    const upperTicker = ticker.toUpperCase();
    
    // GICS 50 - Communication Services (Media, Telecom, Interactive Media)
    const communicationServices = [
      'CMCSA', 'DIS', 'NFLX', 'WBD', 'PARA', 'FOX', 'FOXA', 'VIAC', 'LYV', 'ROKU',
      'SPOT', 'T', 'VZ', 'TMUS', 'LUMN', 'CHTR', 'FYBR', 'GOOGL', 'GOOG', 'META',
    ];
    if (communicationServices.includes(upperTicker)) return 'communication_services';
    
    // GICS 40 - Financials (Banks, Insurance, Diversified Financials)
    const financials = [
      'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC', 'COF', 'SCHW',
      'BRK.A', 'BRK.B', 'MET', 'PRU', 'AIG', 'ALL', 'TRV', 'PGR', 'AFL', 'HIG',
      'AXP', 'BLK', 'SPGI', 'V', 'MA',
    ];
    if (financials.includes(upperTicker)) return 'financials';
    
    // GICS 55 - Utilities
    const utilities = [
      'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'ED', 'WEC', 'ES', 'DTE',
    ];
    if (utilities.includes(upperTicker)) return 'utilities';
    
    // GICS 60 - Real Estate (REITs)
    const realEstate = [
      'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'SPG', 'O', 'WELL', 'DLR', 'AVB', 'EQR', 'VTR',
    ];
    if (realEstate.includes(upperTicker)) return 'real_estate';
    
    // GICS 10 - Energy
    const energy = ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX', 'VLO', 'OXY', 'PXD'];
    if (energy.includes(upperTicker)) return 'energy';
    
    // GICS 45 - Information Technology
    const infoTech = [
      'AAPL', 'MSFT', 'NVDA', 'AVGO', 'CSCO', 'ADBE', 'CRM', 'ACN', 'ORCL', 'INTC', 'AMD',
    ];
    if (infoTech.includes(upperTicker)) return 'information_technology';
    
    // GICS 35 - Health Care
    const healthCare = [
      'UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY',
    ];
    if (healthCare.includes(upperTicker)) return 'health_care';
    
    // GICS 25 - Consumer Discretionary
    const consumerDisc = ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG'];
    if (consumerDisc.includes(upperTicker)) return 'consumer_discretionary';
    
    // GICS 30 - Consumer Staples
    const consumerStaples = ['PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MO', 'MDLZ', 'CL'];
    if (consumerStaples.includes(upperTicker)) return 'consumer_staples';
    
    // GICS 20 - Industrials
    const industrials = ['UNP', 'HON', 'UPS', 'RTX', 'CAT', 'DE', 'BA', 'LMT', 'GE', 'MMM'];
    if (industrials.includes(upperTicker)) return 'industrials';
    
    // GICS 15 - Materials
    const materials = ['LIN', 'APD', 'SHW', 'ECL', 'FCX', 'NEM', 'NUE', 'DOW', 'DD', 'PPG'];
    if (materials.includes(upperTicker)) return 'materials';
    
    return undefined;
  }

  /**
   * Order metrics hierarchically, ensuring children appear after their parents.
   * This method takes a flat list of metrics and reorders them based on parent-child relationships.
   * 
   * @param metrics - Flat list of metric rows
   * @returns Hierarchically ordered list with proper indentation
   */
  orderMetricsHierarchically(metrics: MetricRow[]): MetricRow[] {
    // Build a map of metric name to row for quick lookup
    const metricMap = new Map<string, MetricRow>();
    for (const metric of metrics) {
      metricMap.set(metric.normalizedMetric.toLowerCase(), metric);
    }

    // Build parent-child relationships
    const childrenMap = new Map<string, MetricRow[]>();
    const rootMetrics: MetricRow[] = [];

    for (const metric of metrics) {
      if (metric.parentMetric) {
        const parentKey = metric.parentMetric.toLowerCase();
        if (!childrenMap.has(parentKey)) {
          childrenMap.set(parentKey, []);
        }
        childrenMap.get(parentKey)!.push(metric);
      } else {
        rootMetrics.push(metric);
      }
    }

    // Recursively build ordered list
    const orderedMetrics: MetricRow[] = [];
    
    const addMetricWithChildren = (metric: MetricRow, depth: number) => {
      // Set indent based on depth if not already set
      const metricWithIndent = {
        ...metric,
        indent: metric.indent ?? depth,
      };
      orderedMetrics.push(metricWithIndent);

      // Add children recursively
      const children = childrenMap.get(metric.normalizedMetric.toLowerCase()) || [];
      for (const child of children) {
        addMetricWithChildren(child, depth + 1);
      }
    };

    // Process root metrics first
    for (const metric of rootMetrics) {
      addMetricWithChildren(metric, metric.indent ?? 0);
    }

    // Add any orphaned children (parent not found) at the end
    const processedMetrics = new Set(orderedMetrics.map(m => m.normalizedMetric.toLowerCase()));
    for (const metric of metrics) {
      if (!processedMetrics.has(metric.normalizedMetric.toLowerCase())) {
        orderedMetrics.push(metric);
      }
    }

    return orderedMetrics;
  }

  /**
   * Detect parent metric from known hierarchy definitions.
   * This maps child metrics to their logical parents based on financial statement structure.
   */
  detectParentMetric(metricName: string, statementType: StatementType): string | undefined {
    const hierarchyMap: Record<string, Record<string, string>> = {
      [StatementType.INCOME_STATEMENT]: {
        // Revenue breakdown children
        'product_revenue': 'revenue',
        'service_revenue': 'revenue',
        'subscription_revenue': 'revenue',
        'advertising_revenue': 'revenue',
        'licensing_revenue': 'revenue',
        'other_revenue': 'revenue',
        // Cost breakdown children
        'cost_of_products': 'cost_of_revenue',
        'cost_of_services': 'cost_of_revenue',
        // Operating expense children
        'research_development': 'operating_expenses',
        'research_and_development': 'operating_expenses',
        'selling_general_administrative': 'operating_expenses',
        'sg_and_a': 'operating_expenses',
        'sales_and_marketing': 'operating_expenses',
        'marketing_expense': 'operating_expenses',
        'general_administrative': 'operating_expenses',
        'depreciation_amortization_opex': 'operating_expenses',
        'restructuring_charges': 'operating_expenses',
        'impairment_charges': 'operating_expenses',
        'other_operating_expenses': 'operating_expenses',
        // Media-specific
        'programming_costs': 'programming_and_production',
        'production_costs': 'programming_and_production',
        'content_amortization': 'content_costs',
        // Bank-specific
        'interest_income_loans': 'net_interest_income',
        'interest_income_securities': 'net_interest_income',
        'interest_expense_deposits': 'net_interest_income',
        'investment_banking_fees': 'noninterest_income',
        'trading_revenue': 'noninterest_income',
        'asset_management_fees': 'noninterest_income',
        'card_income': 'noninterest_income',
        'mortgage_banking_income': 'noninterest_income',
        'compensation_expense': 'noninterest_expense',
        'occupancy_expense': 'noninterest_expense',
        'technology_expense': 'noninterest_expense',
        'professional_fees': 'noninterest_expense',
      },
      [StatementType.BALANCE_SHEET]: {
        // Current asset children
        'cash_and_equivalents': 'current_assets',
        'cash': 'current_assets',
        'short_term_investments': 'current_assets',
        'marketable_securities': 'current_assets',
        'marketable_securities_current': 'current_assets',
        'accounts_receivable': 'current_assets',
        'accounts_receivable_net': 'current_assets',
        'inventory': 'current_assets',
        'inventories': 'current_assets',
        'prepaid_expenses': 'current_assets',
        'other_current_assets': 'current_assets',
        // Inventory breakdown
        'raw_materials': 'inventory',
        'work_in_progress': 'inventory',
        'finished_goods': 'inventory',
        // Non-current asset children
        'property_plant_equipment': 'total_non_current_assets',
        'ppe_net': 'total_non_current_assets',
        'goodwill': 'total_non_current_assets',
        'intangible_assets': 'total_non_current_assets',
        'long_term_investments': 'total_non_current_assets',
        'other_non_current_assets': 'total_non_current_assets',
        // Current liability children
        'accounts_payable': 'current_liabilities',
        'accrued_liabilities': 'current_liabilities',
        'accrued_expenses': 'current_liabilities',
        'deferred_revenue_current': 'current_liabilities',
        'short_term_debt': 'current_liabilities',
        'current_portion_long_term_debt': 'current_liabilities',
        'other_current_liabilities': 'current_liabilities',
        // Non-current liability children
        'long_term_debt': 'total_non_current_liabilities',
        'deferred_tax_liabilities': 'total_non_current_liabilities',
        'pension_liabilities': 'total_non_current_liabilities',
        'other_non_current_liabilities': 'total_non_current_liabilities',
        // Equity children
        'common_stock': 'shareholders_equity',
        'preferred_stock': 'shareholders_equity',
        'additional_paid_in_capital': 'shareholders_equity',
        'retained_earnings': 'shareholders_equity',
        'treasury_stock': 'shareholders_equity',
        'accumulated_other_comprehensive_income': 'shareholders_equity',
        // Bank-specific
        'commercial_loans': 'total_loans',
        'consumer_loans': 'total_loans',
        'mortgage_loans': 'total_loans',
        'demand_deposits': 'deposits',
        'savings_deposits': 'deposits',
        'time_deposits': 'deposits',
      },
      [StatementType.CASH_FLOW]: {
        // Operating adjustments
        'depreciation_amortization': 'operating_cash_flow',
        'depreciation': 'operating_cash_flow',
        'amortization': 'operating_cash_flow',
        'stock_based_compensation': 'operating_cash_flow',
        'share_based_compensation': 'operating_cash_flow',
        'deferred_income_taxes': 'operating_cash_flow',
        // Working capital changes
        'change_accounts_receivable': 'operating_cash_flow',
        'change_receivables': 'operating_cash_flow',
        'change_inventory': 'operating_cash_flow',
        'change_inventories': 'operating_cash_flow',
        'change_accounts_payable': 'operating_cash_flow',
        'change_payables': 'operating_cash_flow',
        'change_accrued_liabilities': 'operating_cash_flow',
        'change_deferred_revenue': 'operating_cash_flow',
        // Investing children
        'capital_expenditures': 'investing_cash_flow',
        'capex': 'investing_cash_flow',
        'acquisitions': 'investing_cash_flow',
        'business_acquisitions': 'investing_cash_flow',
        'divestitures': 'investing_cash_flow',
        'purchases_investments': 'investing_cash_flow',
        'sales_maturities_investments': 'investing_cash_flow',
        // Financing children
        'debt_issued': 'financing_cash_flow',
        'proceeds_debt': 'financing_cash_flow',
        'debt_repaid': 'financing_cash_flow',
        'repayment_debt': 'financing_cash_flow',
        'share_repurchases': 'financing_cash_flow',
        'stock_repurchases': 'financing_cash_flow',
        'dividends_paid': 'financing_cash_flow',
        'cash_dividends': 'financing_cash_flow',
      },
    };

    const statementHierarchy = hierarchyMap[statementType] || {};
    return statementHierarchy[metricName.toLowerCase()];
  }

  /**
   * Map raw metrics to organized statement rows with hierarchical ordering.
   * This enhanced version ensures children appear after their parents with proper indentation.
   */
  mapMetricsToStatementHierarchical(
    rawMetrics: RawMetric[],
    statementType: StatementType,
    periods: string[],
    industry?: IndustryType,
  ): MetricRow[] {
    // First, get the standard mapped metrics
    const rows = this.mapMetricsToStatementWithDiscovery(
      rawMetrics,
      statementType,
      periods,
      industry,
    );

    // Apply parent-child relationships from raw metrics if available
    const rawMetricParents = new Map<string, string>();
    for (const metric of rawMetrics) {
      if (metric.parent_metric) {
        rawMetricParents.set(metric.normalized_metric.toLowerCase(), metric.parent_metric);
      }
    }

    // Update rows with parent information
    for (const row of rows) {
      if (!row.isHeader) {
        // First check if raw metric had parent info
        const rawParent = rawMetricParents.get(row.normalizedMetric.toLowerCase());
        if (rawParent) {
          row.parentMetric = rawParent;
        } else {
          // Fall back to hierarchy detection
          const detectedParent = this.detectParentMetric(row.normalizedMetric, statementType);
          if (detectedParent) {
            row.parentMetric = detectedParent;
          }
        }
      }
    }

    // Order hierarchically
    const orderedRows = this.orderMetricsHierarchically(rows);

    this.logger.log(`Mapped ${orderedRows.length} rows for ${statementType} with hierarchical ordering`);
    return orderedRows;
  }
}
