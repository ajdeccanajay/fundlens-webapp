/**
 * Initialize Comprehensive MVP Metrics in RDS
 * This ensures 100% coverage of common financial statement line items
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const comprehensiveMVPMetrics = [
  // ============ INCOME STATEMENT ============
  {
    normalizedMetric: 'revenue',
    displayName: 'Revenue',
    statementType: 'income_statement',
    synonyms: [
      'Revenue', 'Revenues', 'Net Revenue', 'Net Revenues',
      'Sales', 'Net Sales', 'Total Sales', 'Total Revenue',
      'Total Net Sales', 'Product Revenue', 'Service Revenue'
    ],
    xbrlTags: ['us-gaap:Revenues', 'us-gaap:SalesRevenueNet', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax'],
    description: 'Total income from sales of goods and services'
  },
  {
    normalizedMetric: 'cost_of_revenue',
    displayName: 'Cost of Revenue',
    statementType: 'income_statement',
    synonyms: [
      'Cost of Revenue', 'Cost of Sales', 'Cost of Goods Sold', 'COGS',
      'Cost of Products Sold', 'Cost of Services', 'Cost of Product Sales',
      'Total Cost of Revenue'
    ],
    xbrlTags: ['us-gaap:CostOfRevenue', 'us-gaap:CostOfGoodsSold', 'us-gaap:CostOfGoodsAndServicesSold'],
    description: 'Direct costs of producing goods/services sold'
  },
  {
    normalizedMetric: 'gross_profit',
    displayName: 'Gross Profit',
    statementType: 'income_statement',
    synonyms: [
      'Gross Profit', 'Gross Income', 'Gross Margin',
      'Total Gross Margin', 'Total Gross Profit'
    ],
    xbrlTags: ['us-gaap:GrossProfit'],
    description: 'Revenue minus cost of revenue',
    calculationFormula: 'revenue - cost_of_revenue'
  },
  {
    normalizedMetric: 'research_development',
    displayName: 'Research & Development',
    statementType: 'income_statement',
    synonyms: [
      'Research and Development', 'R&D', 'Research & Development',
      'Research and Development Expense'
    ],
    xbrlTags: ['us-gaap:ResearchAndDevelopmentExpense'],
    description: 'Research and development expenses'
  },
  {
    normalizedMetric: 'selling_general_administrative',
    displayName: 'Selling, General & Administrative',
    statementType: 'income_statement',
    synonyms: [
      'Selling General and Administrative', 'SG&A', 'Selling and Marketing',
      'General and Administrative', 'Selling, General and Administrative',
      'Sales and Marketing', 'Marketing and Sales'
    ],
    xbrlTags: ['us-gaap:SellingGeneralAndAdministrativeExpense'],
    description: 'Operating expenses for sales and administration'
  },
  {
    normalizedMetric: 'operating_expenses',
    displayName: 'Operating Expenses',
    statementType: 'income_statement',
    synonyms: [
      'Operating Expenses', 'Total Operating Expenses',
      'Operating Costs', 'Total Operating Costs'
    ],
    xbrlTags: ['us-gaap:OperatingExpenses'],
    description: 'Total expenses from operations'
  },
  {
    normalizedMetric: 'operating_income',
    displayName: 'Operating Income',
    statementType: 'income_statement',
    synonyms: [
      'Operating Income', 'Income from Operations', 'Operating Profit',
      'Operating Loss', 'Loss from Operations', 'Income (Loss) from Operations'
    ],
    xbrlTags: ['us-gaap:OperatingIncomeLoss'],
    description: 'Profit from core business operations'
  },
  {
    normalizedMetric: 'interest_income',
    displayName: 'Interest Income',
    statementType: 'income_statement',
    synonyms: [
      'Interest Income', 'Interest and Other Income',
      'Interest and Dividend Income'
    ],
    xbrlTags: ['us-gaap:InterestIncomeOperating', 'us-gaap:InterestAndDividendIncomeOperating'],
    description: 'Income from interest-bearing assets'
  },
  {
    normalizedMetric: 'interest_expense',
    displayName: 'Interest Expense',
    statementType: 'income_statement',
    synonyms: [
      'Interest Expense', 'Interest and Other Expense',
      'Interest Expense, Net'
    ],
    xbrlTags: ['us-gaap:InterestExpense'],
    description: 'Cost of borrowed funds'
  },
  {
    normalizedMetric: 'other_income_expense',
    displayName: 'Other Income (Expense)',
    statementType: 'income_statement',
    synonyms: [
      'Other Income', 'Other Income (Expense)', 'Other Income, Net',
      'Other Expense', 'Other Income (Loss)'
    ],
    xbrlTags: ['us-gaap:OtherNonoperatingIncomeExpense'],
    description: 'Non-operating income and expenses'
  },
  {
    normalizedMetric: 'income_before_taxes',
    displayName: 'Income Before Taxes',
    statementType: 'income_statement',
    synonyms: [
      'Income Before Provision for Income Taxes', 'Income Before Taxes',
      'Earnings Before Taxes', 'Pretax Income', 'Income Before Income Taxes'
    ],
    xbrlTags: ['us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
    description: 'Income before tax provision'
  },
  {
    normalizedMetric: 'income_tax_expense',
    displayName: 'Income Tax Expense',
    statementType: 'income_statement',
    synonyms: [
      'Provision for Income Taxes', 'Income Tax Provision',
      'Tax Expense', 'Income Tax Expense', 'Provision for Taxes'
    ],
    xbrlTags: ['us-gaap:IncomeTaxExpenseBenefit'],
    description: 'Tax expense for the period'
  },
  {
    normalizedMetric: 'net_income',
    displayName: 'Net Income',
    statementType: 'income_statement',
    synonyms: [
      'Net Income', 'Net Earnings', 'Net Profit', 'Net Loss',
      'Net Income (Loss)', 'Net Earnings (Loss)'
    ],
    xbrlTags: ['us-gaap:NetIncomeLoss', 'us-gaap:ProfitLoss'],
    description: 'Bottom line profit after all expenses'
  },
  {
    normalizedMetric: 'earnings_per_share_basic',
    displayName: 'Basic EPS',
    statementType: 'income_statement',
    synonyms: [
      'Basic Earnings Per Share', 'Earnings Per Share - Basic',
      'Basic EPS', 'EPS Basic'
    ],
    xbrlTags: ['us-gaap:EarningsPerShareBasic'],
    description: 'Earnings per share (basic)'
  },
  {
    normalizedMetric: 'earnings_per_share_diluted',
    displayName: 'Diluted EPS',
    statementType: 'income_statement',
    synonyms: [
      'Diluted Earnings Per Share', 'Earnings Per Share - Diluted',
      'Diluted EPS', 'EPS Diluted'
    ],
    xbrlTags: ['us-gaap:EarningsPerShareDiluted'],
    description: 'Earnings per share (diluted)'
  },

  // ============ BALANCE SHEET ============
  {
    normalizedMetric: 'cash_and_equivalents',
    displayName: 'Cash and Cash Equivalents',
    statementType: 'balance_sheet',
    synonyms: [
      'Cash and Cash Equivalents', 'Cash and Equivalents',
      'Cash & Cash Equivalents', 'Cash'
    ],
    xbrlTags: ['us-gaap:CashAndCashEquivalentsAtCarryingValue'],
    description: 'Cash and highly liquid investments'
  },
  {
    normalizedMetric: 'marketable_securities',
    displayName: 'Marketable Securities',
    statementType: 'balance_sheet',
    synonyms: [
      'Marketable Securities', 'Short-term Investments',
      'Temporary Investments', 'Short-Term Marketable Securities'
    ],
    xbrlTags: ['us-gaap:MarketableSecuritiesCurrent'],
    description: 'Short-term investment securities'
  },
  {
    normalizedMetric: 'accounts_receivable',
    displayName: 'Accounts Receivable',
    statementType: 'balance_sheet',
    synonyms: [
      'Accounts Receivable', 'Trade Receivables', 'Receivables',
      'Accounts Receivable, Net', 'Trade Accounts Receivable'
    ],
    xbrlTags: ['us-gaap:AccountsReceivableNetCurrent'],
    description: 'Amounts owed by customers'
  },
  {
    normalizedMetric: 'inventory',
    displayName: 'Inventory',
    statementType: 'balance_sheet',
    synonyms: [
      'Inventory', 'Inventories'
    ],
    xbrlTags: ['us-gaap:InventoryNet'],
    description: 'Goods available for sale'
  },
  {
    normalizedMetric: 'current_assets',
    displayName: 'Total Current Assets',
    statementType: 'balance_sheet',
    synonyms: [
      'Total Current Assets', 'Current Assets'
    ],
    xbrlTags: ['us-gaap:AssetsCurrent'],
    description: 'Assets expected to be converted to cash within one year'
  },
  {
    normalizedMetric: 'property_plant_equipment',
    displayName: 'Property, Plant & Equipment',
    statementType: 'balance_sheet',
    synonyms: [
      'Property, Plant and Equipment', 'Property Plant and Equipment',
      'PP&E', 'Property and Equipment', 'Property, Plant and Equipment, Net'
    ],
    xbrlTags: ['us-gaap:PropertyPlantAndEquipmentNet'],
    description: 'Fixed assets net of depreciation'
  },
  {
    normalizedMetric: 'goodwill',
    displayName: 'Goodwill',
    statementType: 'balance_sheet',
    synonyms: [
      'Goodwill'
    ],
    xbrlTags: ['us-gaap:Goodwill'],
    description: 'Intangible asset from acquisitions'
  },
  {
    normalizedMetric: 'intangible_assets',
    displayName: 'Intangible Assets',
    statementType: 'balance_sheet',
    synonyms: [
      'Intangible Assets', 'Other Intangible Assets',
      'Intangible Assets, Net'
    ],
    xbrlTags: ['us-gaap:IntangibleAssetsNetExcludingGoodwill'],
    description: 'Non-physical assets'
  },
  {
    normalizedMetric: 'total_assets',
    displayName: 'Total Assets',
    statementType: 'balance_sheet',
    synonyms: [
      'Total Assets', 'Assets'
    ],
    xbrlTags: ['us-gaap:Assets'],
    description: 'Sum of all assets'
  },
  {
    normalizedMetric: 'accounts_payable',
    displayName: 'Accounts Payable',
    statementType: 'balance_sheet',
    synonyms: [
      'Accounts Payable', 'Trade Payables', 'Payables to Suppliers',
      'Trade and Other Payables', 'Trade Accounts Payable'
    ],
    xbrlTags: ['us-gaap:AccountsPayableCurrent'],
    description: 'Amounts owed to suppliers'
  },
  {
    normalizedMetric: 'accrued_liabilities',
    displayName: 'Accrued Liabilities',
    statementType: 'balance_sheet',
    synonyms: [
      'Accrued Liabilities', 'Accrued Expenses',
      'Other Accrued Liabilities', 'Accrued Expenses and Other Liabilities'
    ],
    xbrlTags: ['us-gaap:AccruedLiabilitiesCurrent'],
    description: 'Expenses incurred but not yet paid'
  },
  {
    normalizedMetric: 'deferred_revenue',
    displayName: 'Deferred Revenue',
    statementType: 'balance_sheet',
    synonyms: [
      'Deferred Revenue', 'Unearned Revenue', 'Contract Liabilities',
      'Deferred Income'
    ],
    xbrlTags: ['us-gaap:DeferredRevenueCurrent'],
    description: 'Revenue received but not yet earned'
  },
  {
    normalizedMetric: 'current_liabilities',
    displayName: 'Total Current Liabilities',
    statementType: 'balance_sheet',
    synonyms: [
      'Total Current Liabilities', 'Current Liabilities'
    ],
    xbrlTags: ['us-gaap:LiabilitiesCurrent'],
    description: 'Liabilities due within one year'
  },
  {
    normalizedMetric: 'long_term_debt',
    displayName: 'Long-term Debt',
    statementType: 'balance_sheet',
    synonyms: [
      'Long-term Debt', 'Term Debt', 'Notes Payable',
      'Long-Term Borrowings', 'Non-Current Debt'
    ],
    xbrlTags: ['us-gaap:LongTermDebtNoncurrent'],
    description: 'Debt due after one year'
  },
  {
    normalizedMetric: 'total_liabilities',
    displayName: 'Total Liabilities',
    statementType: 'balance_sheet',
    synonyms: [
      'Total Liabilities', 'Liabilities'
    ],
    xbrlTags: ['us-gaap:Liabilities'],
    description: 'Sum of all liabilities'
  },
  {
    normalizedMetric: 'common_stock',
    displayName: 'Common Stock',
    statementType: 'balance_sheet',
    synonyms: [
      'Common Stock', 'Common Shares', 'Common Stock Issued'
    ],
    xbrlTags: ['us-gaap:CommonStockValue'],
    description: 'Par value of common stock'
  },
  {
    normalizedMetric: 'retained_earnings',
    displayName: 'Retained Earnings',
    statementType: 'balance_sheet',
    synonyms: [
      'Retained Earnings', 'Accumulated Deficit'
    ],
    xbrlTags: ['us-gaap:RetainedEarningsAccumulatedDeficit'],
    description: 'Cumulative earnings retained in business'
  },
  {
    normalizedMetric: 'shareholders_equity',
    displayName: 'Total Shareholders Equity',
    statementType: 'balance_sheet',
    synonyms: [
      'Shareholders Equity', 'Stockholders Equity', 'Total Equity',
      'Total Shareholders Equity', 'Total Stockholders Equity',
      'Shareholders\' Equity', 'Stockholders\' Equity'
    ],
    xbrlTags: ['us-gaap:StockholdersEquity'],
    description: 'Owners equity in the company'
  },

  // ============ CASH FLOW STATEMENT ============
  {
    normalizedMetric: 'operating_cash_flow',
    displayName: 'Operating Cash Flow',
    statementType: 'cash_flow',
    synonyms: [
      'Operating Cash Flow', 'Cash from Operations',
      'Net Cash from Operating Activities',
      'Net Cash Provided by Operating Activities',
      'Cash Flows from Operating Activities'
    ],
    xbrlTags: ['us-gaap:NetCashProvidedByUsedInOperatingActivities'],
    description: 'Cash generated from operations'
  },
  {
    normalizedMetric: 'investing_cash_flow',
    displayName: 'Investing Cash Flow',
    statementType: 'cash_flow',
    synonyms: [
      'Investing Cash Flow', 'Cash from Investing Activities',
      'Net Cash from Investing Activities',
      'Net Cash Used in Investing Activities',
      'Cash Flows from Investing Activities'
    ],
    xbrlTags: ['us-gaap:NetCashProvidedByUsedInInvestingActivities'],
    description: 'Cash used for investments'
  },
  {
    normalizedMetric: 'financing_cash_flow',
    displayName: 'Financing Cash Flow',
    statementType: 'cash_flow',
    synonyms: [
      'Financing Cash Flow', 'Cash from Financing Activities',
      'Net Cash from Financing Activities',
      'Net Cash Used in Financing Activities',
      'Cash Flows from Financing Activities'
    ],
    xbrlTags: ['us-gaap:NetCashProvidedByUsedInFinancingActivities'],
    description: 'Cash from financing activities'
  },
  {
    normalizedMetric: 'depreciation_amortization',
    displayName: 'Depreciation & Amortization',
    statementType: 'cash_flow',
    synonyms: [
      'Depreciation and Amortization', 'Depreciation & Amortization',
      'D&A', 'Depreciation, Amortization and Other'
    ],
    xbrlTags: ['us-gaap:DepreciationDepletionAndAmortization'],
    description: 'Non-cash expense for asset depreciation'
  },
  {
    normalizedMetric: 'capital_expenditures',
    displayName: 'Capital Expenditures',
    statementType: 'cash_flow',
    synonyms: [
      'Capital Expenditures', 'CapEx', 'Payments for Acquisition of Property Plant and Equipment',
      'Purchases of Property and Equipment', 'Payments for Property, Plant and Equipment'
    ],
    xbrlTags: ['us-gaap:PaymentsToAcquirePropertyPlantAndEquipment'],
    description: 'Cash spent on fixed assets'
  }
];

async function initializeMVPMetrics() {
  console.log('🚀 Initializing Comprehensive MVP Metrics...\n');

  let created = 0;
  let updated = 0;

  for (const metric of comprehensiveMVPMetrics) {
    try {
      const result = await prisma.metricMapping.upsert({
        where: { normalizedMetric: metric.normalizedMetric },
        update: metric,
        create: metric,
      });

      if (result.createdAt === result.updatedAt) {
        created++;
      } else {
        updated++;
      }

      console.log(`✅ ${metric.displayName} (${metric.normalizedMetric})`);
    } catch (error) {
      console.error(`❌ Error with ${metric.normalizedMetric}:`, error.message);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Total: ${comprehensiveMVPMetrics.length}`);
  console.log(`\n✅ MVP Metrics initialization complete!`);
}

initializeMVPMetrics()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
