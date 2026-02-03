/**
 * Documents Controller with Tenant Isolation
 * 
 * All endpoints are protected by TenantGuard for authentication.
 * Document operations are tenant-scoped through the service layer.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { DocumentProcessingService } from './document-processing.service';
import { TenantGuard } from '../tenant/tenant.guard';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(TenantGuard)
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly processingService: DocumentProcessingService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a document (tenant-scoped)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        ticker: {
          type: 'string',
          description: 'Company ticker (optional)',
        },
        documentType: {
          type: 'string',
          description: 'Type of document',
          enum: ['sec_filing', 'news', 'user_upload', 'earnings_transcript'],
        },
        title: {
          type: 'string',
          description: 'Document title (optional)',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source URL (optional)',
        },
      },
      required: ['file', 'documentType'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body('ticker') ticker?: string,
    @Body('documentType') documentType?: string,
    @Body('title') title?: string,
    @Body('sourceUrl') sourceUrl?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!documentType) {
      throw new BadRequestException('documentType is required');
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/html',
      'text/plain',
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} not supported. Allowed types: PDF, DOCX, PPTX, HTML, TXT`,
      );
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of 50MB`,
      );
    }

    const uploadResult = await this.documentsService.uploadDocument(file, {
      ticker,
      documentType,
      title,
      sourceUrl,
    });

    // Trigger async processing for user uploads
    if (documentType === 'user_upload') {
      // Process document asynchronously (don't await)
      setImmediate(async () => {
        try {
          // The file buffer is still in memory, pass it directly
          await this.processingService.processUploadedDocument(
            uploadResult.id,
            file.buffer,
            'basic'
          );
        } catch (error) {
          console.error(`Failed to process document ${uploadResult.id}:`, error);
        }
      });
    }

    return uploadResult;
  }

  @Get()
  @ApiOperation({ summary: 'List documents (tenant-scoped)' })
  async listDocuments(
    @Query('ticker') ticker?: string,
    @Query('documentType') documentType?: string,
    @Query('processed') processed?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.documentsService.listDocuments({
      ticker,
      documentType,
      processed: processed === 'true' ? true : processed === 'false' ? false : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get document statistics for current tenant' })
  async getStats() {
    const stats = await this.documentsService.getDocumentStats();
    return {
      ...stats,
      totalSize: stats.totalSize.toString(),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document by ID (tenant-scoped)' })
  async getDocument(@Param('id') id: string) {
    return this.documentsService.getDocument(id);
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Get signed download URL for document (tenant-scoped)' })
  async getDownloadUrl(
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const expires = expiresIn ? parseInt(expiresIn) : 3600;
    const url = await this.documentsService.getDownloadUrl(id, expires);
    return { url, expiresIn: expires };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a document (tenant-scoped)' })
  async deleteDocument(@Param('id') id: string) {
    await this.documentsService.deleteDocument(id);
    return { message: 'Document deleted successfully' };
  }

  @Get('download/:id')
  @ApiOperation({ summary: 'Download document directly (tenant-scoped)' })
  async downloadDocument(@Param('id') id: string, @Res() res: any) {
    const document = await this.documentsService.getDocument(id);
    const fileBuffer = await this.documentsService.getFileBuffer(id);
    
    res.setHeader('Content-Type', this.getContentType(document.fileType));
    res.setHeader('Content-Disposition', `attachment; filename="${document.title}"`);
    res.send(fileBuffer);
  }

  // Note: These endpoints are disabled as they require DocumentProcessorService
  // which depends on Python parser. Use automatic processing on upload instead.
  
  // @Post(':id/process')
  // @ApiOperation({ summary: 'Process a document (tenant-scoped)' })
  // async processDocument(@Param('id') id: string) {
  //   return this.processingService.processDocument(id);
  // }

  // @Post('process-batch')
  // @ApiOperation({ summary: 'Process multiple documents (tenant-scoped)' })
  // async processBatch(@Body('documentIds') documentIds: string[]) {
  //   return this.processingService.batchProcessDocuments(documentIds);
  // }

  // @Post('process-unprocessed')
  // @ApiOperation({ summary: 'Process all unprocessed documents for current tenant' })
  // async processUnprocessed() {
  //   return this.processingService.processUnprocessedDocuments();
  // }

  @Get(':id/chunks')
  @ApiOperation({ summary: 'Get document chunks (tenant-scoped)' })
  async getChunks(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const document = await this.documentsService.getDocument(id);
    
    const chunks = await this.documentsService.getDocumentChunks(
      id,
      limit ? parseInt(limit) : undefined,
      offset ? parseInt(offset) : undefined,
    );

    return {
      documentId: id,
      documentTitle: document.title,
      chunks,
    };
  }

  private getContentType(fileType: string): string {
    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      html: 'text/html',
      txt: 'text/plain',
    };
    return contentTypes[fileType] || 'application/octet-stream';
  }
}
