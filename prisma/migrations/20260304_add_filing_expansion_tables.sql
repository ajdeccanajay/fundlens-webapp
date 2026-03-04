-- Filing Expansion Phase 1: Add tables for 13F holdings, insider transactions, and IR page mappings
-- Spec: KIRO_SPEC_FILING_EXPANSION_AND_AGENTIC_ACQUISITION §4.1

-- Institutional Holdings (13F-HR filings)
CREATE TABLE IF NOT EXISTS institutional_holdings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                VARCHAR(10),
  holder_cik            TEXT NOT NULL,
  holder_name           TEXT NOT NULL,
  cusip                 VARCHAR(9) NOT NULL,
  issuer_name           TEXT NOT NULL,
  share_class           TEXT,
  shares_held           BIGINT NOT NULL,
  market_value          DECIMAL(20,2) NOT NULL,
  investment_discretion TEXT,
  voting_sole           BIGINT,
  voting_shared         BIGINT,
  voting_none           BIGINT,
  report_date           TIMESTAMP NOT NULL,
  filing_date           TIMESTAMP NOT NULL,
  accession_no          TEXT NOT NULL,
  quarter               VARCHAR(10) NOT NULL,
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_unique
  ON institutional_holdings (holder_cik, cusip, report_date, accession_no);
CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON institutional_holdings (ticker);
CREATE INDEX IF NOT EXISTS idx_holdings_holder_cik ON institutional_holdings (holder_cik);
CREATE INDEX IF NOT EXISTS idx_holdings_cusip ON institutional_holdings (cusip);
CREATE INDEX IF NOT EXISTS idx_holdings_report_date ON institutional_holdings (report_date);

-- Insider Transactions (Form 4 filings)
CREATE TABLE IF NOT EXISTS insider_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                VARCHAR(10) NOT NULL,
  insider_name          TEXT NOT NULL,
  insider_title         TEXT,
  insider_relationship  TEXT NOT NULL,
  transaction_date      TIMESTAMP NOT NULL,
  transaction_code      VARCHAR(5) NOT NULL,
  equity_swap           BOOLEAN DEFAULT FALSE,
  shares_transacted     DECIMAL(20,4) NOT NULL,
  price_per_share       DECIMAL(20,4),
  shares_owned_after    DECIMAL(20,4),
  is_derivative         BOOLEAN DEFAULT FALSE,
  derivative_title      TEXT,
  exercise_price        DECIMAL(20,4),
  expiration_date       TIMESTAMP,
  underlying_shares     DECIMAL(20,4),
  filing_date           TIMESTAMP NOT NULL,
  accession_no          TEXT NOT NULL,
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_insider_txn_unique
  ON insider_transactions (ticker, accession_no, insider_name, transaction_date, transaction_code, is_derivative);
CREATE INDEX IF NOT EXISTS idx_insider_txn_ticker ON insider_transactions (ticker);
CREATE INDEX IF NOT EXISTS idx_insider_txn_name ON insider_transactions (insider_name);
CREATE INDEX IF NOT EXISTS idx_insider_txn_date ON insider_transactions (transaction_date);
CREATE INDEX IF NOT EXISTS idx_insider_txn_ticker_date ON insider_transactions (ticker, transaction_date);

-- IR Page Mappings (for agentic transcript acquisition)
CREATE TABLE IF NOT EXISTS ir_page_mappings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                VARCHAR(10) UNIQUE NOT NULL,
  company_name          TEXT NOT NULL,
  ir_base_url           TEXT NOT NULL,
  earnings_page_url     TEXT,
  transcripts_page_url  TEXT,
  sec_filings_page_url  TEXT,
  press_releases_url    TEXT,
  webcasts_url          TEXT,
  confidence            DECIMAL(3,2),
  last_verified         TIMESTAMP NOT NULL,
  last_successful       TIMESTAMP,
  verification_failures INT DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ir_mappings_ticker ON ir_page_mappings (ticker);
