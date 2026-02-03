# Requirements Document

## Introduction

This feature enables users to upload and process diverse document formats (PDF, PPTX, DOCX, images) that don't follow the structured SEC filing format. The system will intelligently extract text, tables, charts, and narratives using AWS services and LLMs, then make this content searchable and queryable through the existing RAG infrastructure.

Unlike SEC filings which have predictable XBRL tags and standardized sections, user-uploaded documents (investor decks, research reports, internal memos, earnings transcripts) require intelligent content extraction that can handle varied layouts, embedded visuals, and unstructured narratives.

## Glossary

- **Document_Processor**: The orchestration service that routes documents to appropriate extraction pipelines based on file type and content characteristics
- **Textract_Service**: AWS Textract integration for OCR, table extraction, and form analysis from PDFs and images
- **Content_Extractor**: Service that extracts and normalizes text, tables, and visual descriptions from various document formats
- **Table_Normalizer**: Component that converts extracted tables into structured JSON with row/column semantics preserved
- **Chart_Analyzer**: LLM-powered service that generates textual descriptions of charts and graphs for RAG indexing
- **Chunk_Generator**: Service that intelligently segments extracted content into semantically coherent chunks for vector embedding
- **Metadata_Enricher**: Service that uses LLM to infer document metadata (company, date, document type) when not explicitly provided
- **Processing_Queue**: SQS-based queue for async document processing with retry logic
- **Extraction_Result**: Structured output containing extracted text, tables, charts, and metadata from a processed document

## Requirements

### Requirement 1: Multi-Format File Upload

**User Story:** As a financial analyst, I want to upload documents in various formats (PDF, PPTX, DOCX, images), so that I can include diverse research materials in my analysis workflow.

#### Acceptance Criteria

1. WHEN a user uploads a PDF file, THE Document_Processor SHALL accept files up to 100MB and store them in S3 with appropriate metadata
2. WHEN a user uploads a PPTX file, THE Document_Processor SHALL accept files up to 100MB and store them in S3 with appropriate metadata
3. WHEN a user uploads a DOCX file, THE Document_Processor SHALL accept files up to 50MB and store them in S3 with appropriate metadata
4. WHEN a user uploads an image file (PNG, JPG, TIFF), THE Document_Processor SHALL accept files up to 20MB and store them in S3 with appropriate metadata
5. WHEN a user uploads an unsupported file type, THE Document_Processor SHALL reject the upload with a clear error message listing supported formats
6. WHEN a file upload succeeds, THE Document_Processor SHALL return a document ID and initiate async processing
7. WHEN a file exceeds the size limit for its type, THE Document_Processor SHALL reject the upload with a clear error message stating the limit

### Requirement 2: PDF Content Extraction

**User Story:** As a financial analyst, I want the system to extract all content from PDFs including scanned documents, so that I can search and query information from any PDF regardless of how it was created.

#### Acceptance Criteria

1. WHEN processing a text-based PDF, THE Textract_Service SHALL extract all text content preserving paragraph structure
2. WHEN processing a scanned PDF, THE Textract_Service SHALL perform OCR to extract text with confidence scores
3. WHEN a PDF contains tables, THE Textract_Service SHALL extract tables with row and column structure preserved
4. WHEN a PDF contains forms, THE Textract_Service SHALL extract form fields as key-value pairs
5. WHEN OCR confidence is below 80% for a text region, THE Content_Extractor SHALL flag the region for manual review
6. IF Textract processing fails, THEN THE Document_Processor SHALL retry up to 3 times with exponential backoff before marking as failed

### Requirement 3: PowerPoint Content Extraction

**User Story:** As a financial analyst, I want to extract content from investor presentations and pitch decks, so that I can query information from slide-based materials.

#### Acceptance Criteria

1. WHEN processing a PPTX file, THE Content_Extractor SHALL extract text from all slides including titles, body text, and speaker notes
2. WHEN a slide contains tables, THE Content_Extractor SHALL extract tables with structure preserved
3. WHEN a slide contains charts or graphs, THE Chart_Analyzer SHALL generate a textual description of the visual including data trends and key values
4. WHEN a slide contains images, THE Chart_Analyzer SHALL generate a description of the image content relevant to financial analysis
5. WHEN extracting content, THE Content_Extractor SHALL preserve slide order and associate content with slide numbers
6. WHEN a PPTX file is password-protected, THE Content_Extractor SHALL return an error indicating the file cannot be processed

### Requirement 4: Word Document Content Extraction

**User Story:** As a financial analyst, I want to extract content from Word documents like research reports and memos, so that I can include written analysis in my searchable knowledge base.

#### Acceptance Criteria

1. WHEN processing a DOCX file, THE Content_Extractor SHALL extract all text content preserving heading hierarchy
2. WHEN a document contains tables, THE Content_Extractor SHALL extract tables with structure preserved
3. WHEN a document contains embedded images, THE Chart_Analyzer SHALL generate descriptions for images that appear to contain charts or data
4. WHEN a document contains headers and footers, THE Content_Extractor SHALL extract them as separate metadata
5. WHEN a document contains comments or tracked changes, THE Content_Extractor SHALL extract the final accepted content only

### Requirement 5: Table Extraction and Normalization

**User Story:** As a financial analyst, I want tables from documents to be extracted in a structured format, so that I can query specific data points from financial tables.

#### Acceptance Criteria

1. WHEN a table is extracted from any document type, THE Table_Normalizer SHALL convert it to a structured JSON format with rows and columns
2. WHEN a table has merged cells, THE Table_Normalizer SHALL expand merged cells to preserve data relationships
3. WHEN a table contains numeric values, THE Table_Normalizer SHALL identify and tag numeric cells with their data type (currency, percentage, integer)
4. WHEN a table has header rows, THE Table_Normalizer SHALL identify headers and use them as column labels
5. WHEN a table spans multiple pages in a PDF, THE Table_Normalizer SHALL merge the table segments into a single coherent table
6. FOR ALL extracted tables, THE Table_Normalizer SHALL generate a natural language summary describing the table's content and structure

### Requirement 6: Chart and Visual Analysis

**User Story:** As a financial analyst, I want charts and graphs to be described in text, so that I can search for insights from visual data representations.

#### Acceptance Criteria

1. WHEN a chart is detected in a document, THE Chart_Analyzer SHALL identify the chart type (bar, line, pie, scatter, etc.)
2. WHEN analyzing a chart, THE Chart_Analyzer SHALL extract visible data labels, axis labels, and legend information
3. WHEN analyzing a chart, THE Chart_Analyzer SHALL generate a narrative description of trends, comparisons, and key insights
4. WHEN a chart contains financial data, THE Chart_Analyzer SHALL attempt to identify the metrics being displayed (revenue, growth rate, etc.)
5. IF chart analysis confidence is low, THEN THE Chart_Analyzer SHALL include a confidence indicator in the output
6. WHEN multiple charts appear on a single page or slide, THE Chart_Analyzer SHALL analyze each chart separately with clear delineation

### Requirement 7: Intelligent Chunking for RAG

**User Story:** As a system, I want extracted content to be chunked intelligently, so that RAG retrieval returns contextually complete and relevant results.

#### Acceptance Criteria

1. WHEN chunking extracted text, THE Chunk_Generator SHALL create chunks of 1000-1500 tokens with 200 token overlap
2. WHEN chunking content, THE Chunk_Generator SHALL preserve semantic boundaries (paragraphs, sections, slides)
3. WHEN a table is extracted, THE Chunk_Generator SHALL keep the table as a single chunk if under 2000 tokens, or split by logical row groups if larger
4. WHEN a chart description is generated, THE Chunk_Generator SHALL include the chart description with surrounding context in the same chunk
5. WHEN chunking slide content, THE Chunk_Generator SHALL keep each slide's content together when possible
6. FOR ALL chunks, THE Chunk_Generator SHALL attach source metadata (page number, slide number, section heading)

### Requirement 8: Metadata Inference and Enrichment

**User Story:** As a financial analyst, I want the system to automatically infer document metadata, so that I don't have to manually tag every upload.

#### Acceptance Criteria

1. WHEN a document is processed, THE Metadata_Enricher SHALL attempt to identify the company or companies mentioned
2. WHEN a document is processed, THE Metadata_Enricher SHALL attempt to identify the document date or time period
3. WHEN a document is processed, THE Metadata_Enricher SHALL classify the document type (investor presentation, research report, earnings transcript, internal memo, etc.)
4. WHEN metadata cannot be confidently inferred, THE Metadata_Enricher SHALL flag the field as "unconfirmed" and allow user override
5. WHEN a user provides explicit metadata during upload, THE Document_Processor SHALL use provided values over inferred values
6. WHEN ticker symbols are detected in content, THE Metadata_Enricher SHALL validate them against known ticker list

### Requirement 9: Async Processing Pipeline

**User Story:** As a system, I want document processing to happen asynchronously, so that users get immediate upload confirmation while heavy processing happens in the background.

#### Acceptance Criteria

1. WHEN a document is uploaded, THE Document_Processor SHALL immediately return a document ID and "processing" status
2. WHEN processing begins, THE Processing_Queue SHALL process documents in FIFO order with priority support
3. WHILE a document is processing, THE Document_Processor SHALL update status (queued, extracting, chunking, indexing, complete)
4. WHEN processing completes, THE Document_Processor SHALL update the document status to "ready" and make content searchable
5. IF processing fails after retries, THEN THE Document_Processor SHALL mark status as "failed" with error details
6. WHEN a user queries document status, THE Document_Processor SHALL return current status and any error messages

### Requirement 10: Integration with Existing RAG System

**User Story:** As a financial analyst, I want uploaded documents to be searchable alongside SEC filings, so that I can query all my research materials in one place.

#### Acceptance Criteria

1. WHEN document processing completes, THE Chunk_Generator SHALL store chunks in the same format as SEC filing chunks
2. WHEN chunks are created, THE Document_Processor SHALL sync them to Bedrock Knowledge Base for vector search
3. WHEN querying the RAG system, THE system SHALL include user-uploaded document chunks in retrieval results
4. WHEN displaying RAG results, THE system SHALL clearly indicate the source document type (SEC filing vs user upload)
5. WHEN filtering RAG queries, THE system SHALL support filtering by document type and upload source
6. FOR ALL user-uploaded content, THE system SHALL maintain the same metadata structure as SEC filings for consistent retrieval

### Requirement 11: Processing Status and Error Handling

**User Story:** As a financial analyst, I want to see the status of my document processing and understand any errors, so that I can take corrective action if needed.

#### Acceptance Criteria

1. WHEN viewing a document, THE system SHALL display current processing status with progress indicators
2. WHEN processing encounters an error, THE system SHALL display a user-friendly error message with suggested actions
3. WHEN a document fails processing, THE system SHALL allow the user to retry processing
4. WHEN a document is partially processed, THE system SHALL indicate which content was successfully extracted
5. WHEN OCR quality is poor, THE system SHALL warn the user and suggest uploading a higher quality scan
6. WHEN a document contains unsupported elements, THE system SHALL process supported elements and list what was skipped
