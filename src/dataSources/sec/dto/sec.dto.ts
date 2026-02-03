import { ApiProperty } from '@nestjs/swagger';

export class CikResponseDto {
  @ApiProperty({ example: 'AAPL', description: 'Stock ticker symbol' })
  ticker: string;

  @ApiProperty({ example: '0000320193', description: '10-digit padded CIK' })
  cik: string;

  @ApiProperty({ example: 320193, description: 'Numeric CIK value' })
  cik_numeric: number;

  @ApiProperty({ example: 'Apple Inc.', description: 'Company name' })
  name: string;
}

export class SubmissionsResponseDto {
  @ApiProperty({ description: 'Company CIK' })
  cik: string;

  @ApiProperty({ description: 'Company name' })
  name: string;

  @ApiProperty({ description: 'Company ticker' })
  ticker: string;

  @ApiProperty({ description: 'Company exchanges' })
  exchanges: string[];

  @ApiProperty({ description: 'Company SIC' })
  sic: string;

  @ApiProperty({ description: 'Company SIC description' })
  sicDescription: string;

  @ApiProperty({ description: 'Company category' })
  category: string;

  @ApiProperty({ description: 'Company flags' })
  flags: string;

  @ApiProperty({ description: 'Company description' })
  description: string;

  @ApiProperty({ description: 'Company website' })
  website: string;

  @ApiProperty({ description: 'Company employees' })
  employees: number;

  @ApiProperty({ description: 'Company state' })
  state: string;

  @ApiProperty({ description: 'Company city' })
  city: string;

  @ApiProperty({ description: 'Company zip' })
  zip: string;

  @ApiProperty({ description: 'Company address' })
  address: string;

  @ApiProperty({ description: 'Company phone' })
  phone: string;

  @ApiProperty({ description: 'Company sector' })
  sector: string;

  @ApiProperty({ description: 'Company industry' })
  industry: string;

  @ApiProperty({ description: 'Company filings' })
  filings: any;
}

export class CompanyFactsResponseDto {
  @ApiProperty({ description: 'Company CIK' })
  cik: string;

  @ApiProperty({ description: 'Company name' })
  name: string;

  @ApiProperty({ description: 'Company facts data' })
  facts: any;
}

export class CompanyConceptResponseDto {
  @ApiProperty({ description: 'Company CIK' })
  cik: string;

  @ApiProperty({ description: 'Taxonomy used' })
  taxonomy: string;

  @ApiProperty({ description: 'Concept tag' })
  tag: string;

  @ApiProperty({ description: 'Concept units' })
  units: any;

  @ApiProperty({ description: 'Concept description' })
  description: string;
}

export class FramesResponseDto {
  @ApiProperty({ description: 'Taxonomy used' })
  taxonomy: string;

  @ApiProperty({ description: 'Concept tag' })
  tag: string;

  @ApiProperty({ description: 'Unit of measurement' })
  unit: string;

  @ApiProperty({ description: 'Time frame' })
  frame: string;

  @ApiProperty({ description: 'Frames data' })
  data: any[];
}

export class AggregateResponseDto {
  @ApiProperty({ example: '0000320193', description: 'Company CIK' })
  cik: string;

  @ApiProperty({ example: 'AAPL', description: 'Company ticker' })
  ticker: string;

  @ApiProperty({ description: 'Requested parameters' })
  requested: {
    tag: string;
    unit: string;
    frame: string;
  };

  @ApiProperty({ description: 'Submissions summary' })
  submissions_summary: {
    forms: string[];
    filingDates: string[];
  };

  @ApiProperty({ description: 'Raw data from all sources' })
  raw: {
    submissions: any;
    facts: any;
    concept: any;
    frames: any;
  };
}

export class FilingRowDto {
  @ApiProperty({ example: '10-K', description: 'SEC form type' })
  form: string;

  @ApiProperty({ example: '2024-01-15', description: 'Filing date' })
  filingDate: string;

  @ApiProperty({ example: '2023-12-31', description: 'Report date' })
  reportDate: string;

  @ApiProperty({ example: '0000320193-24-000004', description: 'SEC accession number' })
  accessionNumber: string;

  @ApiProperty({ example: 'aapl-20231231.htm', description: 'Primary document filename' })
  primaryDocument: string;

  @ApiProperty({ example: 'Item 1.01', description: '8-K item description', required: false })
  items?: string;

  @ApiProperty({ example: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000004/aapl-20231231.htm', description: 'Direct URL to the filing document' })
  url: string | null;
}

export class FillingsMetadataDto {
  @ApiProperty({ example: '0000320193', description: 'Company CIK' })
  cik: string;

  @ApiProperty({ example: 'AAPL', description: 'Company ticker symbol' })
  ticker: string | null;

  @ApiProperty({ example: 'Apple Inc.', description: 'Company name' })
  companyName: string | null;

  @ApiProperty({ description: 'Date range for the search' })
  dateRange: {
    startDate: string;
    endDate: string;
  };

  @ApiProperty({ example: '10-K', description: 'Form type filter applied' })
  formType: string;

  @ApiProperty({ example: false, description: 'Whether older filing pages were included' })
  includeOlderPages: boolean;
}

export class FillingsSummaryDto {
  @ApiProperty({ example: 150, description: 'Total filings found' })
  totalFilings: number;

  @ApiProperty({ example: 120, description: 'Filings within the specified date range' })
  filingsInDateRange: number;

  @ApiProperty({ example: 120, description: 'Final results after all filtering' })
  finalResults: number;

  @ApiProperty({ example: 20, description: 'Number of 10-K filings' })
  tenKCount: number;

  @ApiProperty({ example: 60, description: 'Number of 10-Q filings' })
  tenQCount: number;

  @ApiProperty({ example: 40, description: 'Number of 8-K filings' })
  eightKCount: number;
}

export class FillingsResponseDto {
  @ApiProperty({ description: 'Metadata about the request and company' })
  metadata: FillingsMetadataDto;

  @ApiProperty({ description: 'Summary statistics of the filings' })
  summary: FillingsSummaryDto;

  @ApiProperty({ description: 'Filings organized by form type', type: [FilingRowDto] })
  filings: {
    tenK: FilingRowDto[];
    tenQ: FilingRowDto[];
    eightK: FilingRowDto[];
  };

  @ApiProperty({ description: 'All filings after filtering', type: [FilingRowDto] })
  allFilings: FilingRowDto[];
} 