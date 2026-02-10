/**
 * SEC Filing Metadata Interface
 * 
 * Defines the structure of the metadata JSONB field in the data_sources table
 * for SEC filing records. This metadata is used by the FilingDetectorService
 * to track which filings have been processed and to store filing-specific information.
 * 
 * @see .kiro/specs/automatic-filing-detection/DATA_SOURCES_METADATA_SPEC.md
 */

/**
 * Required metadata fields for SEC filings stored in data_sources table
 */
export interface SECFilingMetadata {
  /**
   * Stock ticker symbol (uppercase)
   * @example "AAPL"
   * @pattern ^[A-Z]{1,5}$
   */
  ticker: string;

  /**
   * SEC form type
   * @example "10-K"
   * @enum "10-K" | "10-Q" | "8-K"
   */
  filingType: '10-K' | '10-Q' | '8-K';

  /**
   * SEC accession number (unique identifier for the filing)
   * @example "0000320193-24-000123"
   * @pattern XXXXXXXXXX-XX-XXXXXX
   */
  accessionNumber: string;

  /**
   * Date the filing was submitted to SEC (ISO 8601 date string)
   * @example "2024-11-01"
   * @format YYYY-MM-DD
   */
  filingDate: string;

  /**
   * Period end date covered by the filing (ISO 8601 date string)
   * @example "2024-09-30"
   * @format YYYY-MM-DD
   */
  reportDate: string;

  /**
   * Whether metrics and narratives have been extracted
   * @default false
   */
  processed: boolean;

  /**
   * Timestamp when the filing was downloaded from SEC EDGAR (ISO 8601 with timezone)
   * @example "2024-11-02T06:15:00.000Z"
   * @format YYYY-MM-DDTHH:mm:ss.sssZ
   */
  downloadedAt: string;

  /**
   * Timestamp when processing completed successfully (ISO 8601 with timezone)
   * @example "2024-11-02T06:20:00.000Z"
   * @format YYYY-MM-DDTHH:mm:ss.sssZ
   * @optional
   */
  processedAt?: string;

  /**
   * Alternative name for filing type (usually same as filingType)
   * @example "10-K"
   * @optional
   */
  form?: string;

  /**
   * File size in bytes
   * @example 1234567
   * @optional
   */
  size?: number;

  /**
   * Central Index Key (SEC company identifier)
   * @example "0000320193"
   * @optional
   */
  cik?: string;

  /**
   * Name of the primary document file
   * @example "aapl-20240930.htm"
   * @optional
   */
  primaryDocument?: string;

  /**
   * SEC EDGAR URL for the filing
   * @example "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240930.htm"
   * @optional
   */
  url?: string;
}

/**
 * Type guard to check if metadata is valid SEC filing metadata
 */
export function isSECFilingMetadata(metadata: any): metadata is SECFilingMetadata {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    typeof metadata.ticker === 'string' &&
    typeof metadata.filingType === 'string' &&
    typeof metadata.accessionNumber === 'string' &&
    typeof metadata.filingDate === 'string' &&
    typeof metadata.reportDate === 'string' &&
    typeof metadata.processed === 'boolean' &&
    typeof metadata.downloadedAt === 'string'
  );
}

/**
 * Validation error for SEC filing metadata
 */
export class SECFilingMetadataValidationError extends Error {
  constructor(message: string) {
    super(`SEC Filing Metadata Validation Error: ${message}`);
    this.name = 'SECFilingMetadataValidationError';
  }
}

/**
 * Validates SEC filing metadata and throws if invalid
 * @throws {SECFilingMetadataValidationError}
 */
export function validateSECFilingMetadata(metadata: any): asserts metadata is SECFilingMetadata {
  // Check required fields
  const requiredFields = [
    'ticker',
    'filingType',
    'accessionNumber',
    'filingDate',
    'reportDate',
    'processed',
    'downloadedAt',
  ];

  for (const field of requiredFields) {
    if (!(field in metadata)) {
      throw new SECFilingMetadataValidationError(`Missing required field: ${field}`);
    }
  }

  // Validate ticker format (1-5 uppercase letters)
  if (!/^[A-Z]{1,5}$/.test(metadata.ticker)) {
    throw new SECFilingMetadataValidationError(
      `Invalid ticker format: ${metadata.ticker}. Must be 1-5 uppercase letters.`
    );
  }

  // Validate accession number format (XXXXXXXXXX-XX-XXXXXX)
  if (!/^\d{10}-\d{2}-\d{6}$/.test(metadata.accessionNumber)) {
    throw new SECFilingMetadataValidationError(
      `Invalid accession number format: ${metadata.accessionNumber}. Must match format XXXXXXXXXX-XX-XXXXXX`
    );
  }

  // Validate filing type
  const validFilingTypes = ['10-K', '10-Q', '8-K'];
  if (!validFilingTypes.includes(metadata.filingType)) {
    throw new SECFilingMetadataValidationError(
      `Invalid filing type: ${metadata.filingType}. Must be one of: ${validFilingTypes.join(', ')}`
    );
  }

  // Validate filing date
  if (isNaN(Date.parse(metadata.filingDate))) {
    throw new SECFilingMetadataValidationError(
      `Invalid filing date: ${metadata.filingDate}. Must be a valid ISO 8601 date.`
    );
  }

  // Validate report date
  if (isNaN(Date.parse(metadata.reportDate))) {
    throw new SECFilingMetadataValidationError(
      `Invalid report date: ${metadata.reportDate}. Must be a valid ISO 8601 date.`
    );
  }

  // Validate report date is before or equal to filing date
  const reportTime = new Date(metadata.reportDate).getTime();
  const filingTime = new Date(metadata.filingDate).getTime();
  if (reportTime > filingTime) {
    throw new SECFilingMetadataValidationError(
      `Report date (${metadata.reportDate}) cannot be after filing date (${metadata.filingDate})`
    );
  }

  // Validate processed is boolean
  if (typeof metadata.processed !== 'boolean') {
    throw new SECFilingMetadataValidationError(
      `Invalid processed value: ${metadata.processed}. Must be a boolean.`
    );
  }

  // Validate downloadedAt timestamp
  if (isNaN(Date.parse(metadata.downloadedAt))) {
    throw new SECFilingMetadataValidationError(
      `Invalid downloadedAt timestamp: ${metadata.downloadedAt}. Must be a valid ISO 8601 timestamp.`
    );
  }

  // Validate optional processedAt timestamp if present
  if (metadata.processedAt !== undefined && isNaN(Date.parse(metadata.processedAt))) {
    throw new SECFilingMetadataValidationError(
      `Invalid processedAt timestamp: ${metadata.processedAt}. Must be a valid ISO 8601 timestamp.`
    );
  }

  // Validate processedAt is after downloadedAt if both present
  if (metadata.processedAt) {
    const downloadedTime = new Date(metadata.downloadedAt).getTime();
    const processedTime = new Date(metadata.processedAt).getTime();
    if (processedTime < downloadedTime) {
      throw new SECFilingMetadataValidationError(
        `processedAt (${metadata.processedAt}) must be after downloadedAt (${metadata.downloadedAt})`
      );
    }
  }

  // Validate optional size field
  if (metadata.size !== undefined) {
    if (typeof metadata.size !== 'number' || metadata.size < 0) {
      throw new SECFilingMetadataValidationError(
        `Invalid size value: ${metadata.size}. Must be a non-negative number.`
      );
    }
  }

  // Validate optional cik field
  if (metadata.cik !== undefined) {
    if (typeof metadata.cik !== 'string' || !/^\d{10}$/.test(metadata.cik)) {
      throw new SECFilingMetadataValidationError(
        `Invalid CIK format: ${metadata.cik}. Must be a 10-digit string.`
      );
    }
  }

  // Validate optional url field
  if (metadata.url !== undefined) {
    if (typeof metadata.url !== 'string') {
      throw new SECFilingMetadataValidationError(
        `Invalid URL: ${metadata.url}. Must be a string.`
      );
    }
    try {
      new URL(metadata.url);
    } catch {
      throw new SECFilingMetadataValidationError(
        `Invalid URL format: ${metadata.url}. Must be a valid URL.`
      );
    }
  }

  // Validate optional form field matches filingType
  if (metadata.form !== undefined) {
    if (typeof metadata.form !== 'string') {
      throw new SECFilingMetadataValidationError(
        `Invalid form value: ${metadata.form}. Must be a string.`
      );
    }
  }

  // Validate optional primaryDocument field
  if (metadata.primaryDocument !== undefined) {
    if (typeof metadata.primaryDocument !== 'string' || metadata.primaryDocument.length === 0) {
      throw new SECFilingMetadataValidationError(
        `Invalid primaryDocument value: ${metadata.primaryDocument}. Must be a non-empty string.`
      );
    }
  }
}

/**
 * Creates a new SEC filing metadata object with required fields
 */
export function createSECFilingMetadata(params: {
  ticker: string;
  filingType: '10-K' | '10-Q' | '8-K';
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form?: string;
  size?: number;
  cik?: string;
  primaryDocument?: string;
  url?: string;
}): SECFilingMetadata {
  const metadata: SECFilingMetadata = {
    ticker: params.ticker.toUpperCase(), // Normalize to uppercase
    filingType: params.filingType,
    accessionNumber: params.accessionNumber,
    filingDate: params.filingDate,
    reportDate: params.reportDate,
    processed: false, // Always start as unprocessed
    downloadedAt: new Date().toISOString(), // Current timestamp in UTC
  };

  // Add optional fields if provided
  if (params.form) metadata.form = params.form;
  if (params.size) metadata.size = params.size;
  if (params.cik) metadata.cik = params.cik;
  if (params.primaryDocument) metadata.primaryDocument = params.primaryDocument;
  if (params.url) metadata.url = params.url;

  // Validate before returning
  validateSECFilingMetadata(metadata);

  return metadata;
}

/**
 * Marks a filing as processed and adds processedAt timestamp
 */
export function markAsProcessed(metadata: SECFilingMetadata): SECFilingMetadata {
  return {
    ...metadata,
    processed: true,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Helper to extract ticker from data source metadata safely
 */
export function getTickerFromMetadata(metadata: any): string | null {
  if (isSECFilingMetadata(metadata)) {
    return metadata.ticker;
  }
  return null;
}

/**
 * Helper to check if a filing has been processed
 */
export function isFilingProcessed(metadata: any): boolean {
  if (isSECFilingMetadata(metadata)) {
    return metadata.processed === true;
  }
  return false;
}
