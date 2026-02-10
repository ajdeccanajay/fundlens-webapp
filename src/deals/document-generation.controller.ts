import { Controller, Post, Get, Param, Body, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DocumentGenerationService } from './document-generation.service';
import type { DocumentGenerationRequest, PresentationGenerationRequest, MemoAnalysisRequest } from './document-generation.service';

/**
 * Document Generation Controller
 * Handles investment memo and presentation generation
 */
@Controller('deals')
export class DocumentGenerationController {
  private readonly logger = new Logger(DocumentGenerationController.name);

  constructor(
    private readonly documentGenerationService: DocumentGenerationService,
  ) {}

  /**
   * Generate investment memorandum with streaming
   * POST /api/deals/generate-memo
   */
  @Post('generate-memo')
  async generateInvestmentMemo(
    @Body() request: DocumentGenerationRequest,
    @Res() res: Response,
  ) {
    this.logger.log(`Generating investment memo for ticker: ${request.ticker}`);

    try {
      // Set headers for Server-Sent Events (SSE) streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Send initial status
      res.write(`data: ${JSON.stringify({ status: 'started', message: 'Gathering financial data...' })}\n\n`);

      // Stream the memo generation
      await this.documentGenerationService.generateInvestmentMemoStreaming(
        request,
        (chunk: { type: string; content?: string; status?: string; message?: string; data?: any }) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      );

      // Send completion event
      res.write(`data: ${JSON.stringify({ status: 'complete' })}\n\n`);
      res.end();

    } catch (error) {
      this.logger.error(`Failed to generate investment memo: ${error.message}`);
      res.write(`data: ${JSON.stringify({ 
        status: 'error', 
        error: error.message,
        message: 'Failed to generate investment memo'
      })}\n\n`);
      res.end();
    }
  }

  /**
   * Generate PowerPoint presentation
   * POST /api/deals/generate-presentation
   */
  @Post('generate-presentation')
  async generatePowerPointDeck(@Body() request: PresentationGenerationRequest) {
    this.logger.log(`Generating PowerPoint deck for deal: ${request.dealId}`);

    try {
      const result = await this.documentGenerationService.generatePowerPointDeck(request);

      return {
        success: true,
        data: result,
        message: 'PowerPoint presentation generated successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to generate PowerPoint deck: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to generate PowerPoint deck',
      };
    }
  }

  /**
   * Analyze memo with LLM for risks and compliance
   * POST /api/deals/analyze-memo
   */
  @Post('analyze-memo')
  async analyzeMemoWithLLM(@Body() request: MemoAnalysisRequest) {
    this.logger.log(`Analyzing memo with LLM for ticker: ${request.ticker}`);

    try {
      const result = await this.documentGenerationService.analyzeMemoWithLLM(request);

      return {
        success: true,
        data: result,
        message: 'Memo analysis completed successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to analyze memo: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to analyze memo',
      };
    }
  }

  /**
   * Download generated document
   * GET /api/deals/documents/:documentId/download
   */
  @Get('documents/:documentId/download')
  async downloadDocument(
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Downloading document: ${documentId}`);

    try {
      // For now, return a placeholder response
      // In production, this would retrieve the actual document from storage
      const mockDocument = this.generateMockDocument(documentId);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="investment-memo-${documentId}.docx"`);
      
      return res.send(mockDocument);
    } catch (error) {
      this.logger.error(`Failed to download document: ${error.message}`);
      return res.status(404).json({
        success: false,
        error: error.message,
        message: 'Document not found',
      });
    }
  }

  /**
   * Get document generation status
   * GET /api/deals/:dealId/documents
   */
  @Get(':dealId/documents')
  async getGeneratedDocuments(@Param('dealId') dealId: string) {
    this.logger.log(`Getting generated documents for deal: ${dealId}`);

    try {
      // Mock response - in production, this would query the database
      const documents = [
        {
          id: 'doc_1',
          type: 'memo',
          name: 'Investment Memo - AAPL Analysis',
          createdAt: new Date(),
          status: 'completed',
          downloadUrl: `/api/deals/documents/doc_1/download`
        },
        {
          id: 'doc_2',
          type: 'presentation',
          name: 'Investment Presentation - AAPL',
          createdAt: new Date(),
          status: 'completed',
          downloadUrl: `/api/deals/documents/doc_2/download`
        }
      ];

      return {
        success: true,
        data: documents,
        message: `Retrieved ${documents.length} documents`,
      };
    } catch (error) {
      this.logger.error(`Failed to get documents: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve documents',
      };
    }
  }

  /**
   * Generate document preview
   * POST /api/deals/:ticker/preview-memo
   */
  @Post(':ticker/preview-memo')
  async previewMemo(
    @Param('ticker') ticker: string,
    @Body() request: Partial<DocumentGenerationRequest>,
  ) {
    this.logger.log(`Generating memo preview for ticker: ${ticker}`);

    try {
      // Generate a shorter preview version
      const previewRequest: DocumentGenerationRequest = {
        ...request,
        ticker,
        content: request.content || '',
      };

      // For preview, we'll generate just the executive summary
      const result = await this.documentGenerationService.generateInvestmentMemo({
        ...previewRequest,
        structure: 'executive' // Force executive summary for preview
      });

      // Return just the first 500 words for preview
      const previewContent = result.content.split(' ').slice(0, 500).join(' ') + '...';

      return {
        success: true,
        data: {
          preview: previewContent,
          fullLength: result.content.split(' ').length,
        },
        message: 'Memo preview generated successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to generate memo preview: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to generate memo preview',
      };
    }
  }

  /**
   * Get available document templates
   * GET /api/deals/templates
   */
  @Get('templates')
  async getDocumentTemplates() {
    const templates = {
      memoStructures: [
        {
          id: 'standard',
          name: 'Standard Investment Memo',
          description: 'Executive Summary, Company Overview, Financial Analysis, Investment Thesis, Risks, Recommendation',
          sections: ['Executive Summary', 'Company Overview', 'Financial Analysis', 'Investment Thesis', 'Risk Assessment', 'Recommendation']
        },
        {
          id: 'detailed',
          name: 'Detailed Analysis Report',
          description: 'Comprehensive analysis with detailed financial modeling and competitive landscape',
          sections: ['Executive Summary', 'Investment Highlights', 'Company Overview', 'Market Analysis', 'Financial Performance', 'Competitive Position', 'Growth Strategy', 'Risk Factors', 'Valuation Analysis', 'Recommendation']
        },
        {
          id: 'executive',
          name: 'Executive Summary',
          description: 'Concise summary focusing on key investment highlights',
          sections: ['Investment Thesis', 'Key Metrics', 'Risk Summary', 'Recommendation']
        }
      ],
      presentationTypes: [
        {
          id: 'investment_committee',
          name: 'Investment Committee',
          description: 'Formal presentation for investment committee review',
          defaultSlides: 15
        },
        {
          id: 'board_presentation',
          name: 'Board Presentation',
          description: 'High-level presentation for board of directors',
          defaultSlides: 10
        },
        {
          id: 'client_pitch',
          name: 'Client Pitch',
          description: 'Client-facing investment opportunity presentation',
          defaultSlides: 12
        },
        {
          id: 'research_summary',
          name: 'Research Summary',
          description: 'Detailed research findings and analysis',
          defaultSlides: 20
        }
      ],
      voiceTones: [
        {
          id: 'professional',
          name: 'Professional & Formal',
          description: 'Objective, formal tone suitable for institutional investors'
        },
        {
          id: 'analytical',
          name: 'Analytical & Data-Driven',
          description: 'Quantitative focus with detailed analysis and metrics'
        },
        {
          id: 'persuasive',
          name: 'Persuasive & Compelling',
          description: 'Confident tone that builds a strong investment case'
        },
        {
          id: 'conservative',
          name: 'Conservative & Risk-Focused',
          description: 'Cautious tone emphasizing downside protection'
        }
      ]
    };

    return {
      success: true,
      data: templates,
      message: 'Document templates retrieved successfully',
    };
  }

  /**
   * Generate mock document for download (placeholder)
   */
  private generateMockDocument(documentId: string): Buffer {
    // This is a placeholder - in production, you would:
    // 1. Retrieve the document content from database
    // 2. Use a library like docx or pptx-generator to create actual files
    // 3. Return the generated file buffer

    const mockContent = `Investment Memorandum - Document ID: ${documentId}\n\nThis is a placeholder document. In production, this would be a properly formatted Word document or PowerPoint presentation generated from the LLM content.`;
    
    return Buffer.from(mockContent, 'utf-8');
  }
}