import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentProcessingService } from './document-processing.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/documents')
export class DocumentUploadController {
  constructor(
    private readonly processingService: DocumentProcessingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (req, file, cb) => {
        const allowed = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];
        if (!allowed.includes(file.mimetype)) {
          cb(
            new BadRequestException(
              'Invalid file type. Only PDF, DOCX, and TXT are allowed.',
            ),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      tenantId: string;
      ticker: string;
      extractionTier?: 'basic' | 'advanced';
      userId?: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!body.tenantId || !body.ticker) {
      throw new BadRequestException('tenantId and ticker are required');
    }

    // Validate tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: body.tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Check document limit (25 per tenant)
    const documentCount = await this.prisma.document.count({
      where: {
        tenantId: body.tenantId,
        sourceType: 'USER_UPLOAD',
      },
    });

    if (documentCount >= 25) {
      throw new BadRequestException(
        'Document limit reached. Maximum 25 documents per tenant.',
      );
    }

    // Process document
    const document = await this.processingService.processDocument({
      file,
      tenantId: body.tenantId,
      ticker: body.ticker,
      extractionTier: body.extractionTier || 'basic',
      userId: body.userId || 'system',
    });

    return {
      documentId: document.id,
      status: 'processing',
      message: 'Document uploaded successfully',
      extractionTier: body.extractionTier || 'basic',
    };
  }

  @Get()
  async listDocuments(
    @Query('tenantId') tenantId: string,
    @Query('ticker') ticker?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    const where: any = {
      tenantId,
      sourceType: 'USER_UPLOAD',
    };

    if (ticker) {
      where.ticker = ticker;
    }

    const documents = await this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        ticker: true,
        fileType: true,
        fileSize: true,
        processed: true,
        processingError: true,
        createdAt: true,
        createdBy: true,
        metadata: true,
      },
    });

    return {
      documents: documents.map((doc) => ({
        ...doc,
        fileSize: Number(doc.fileSize),
        status: doc.processed
          ? doc.processingError
            ? 'failed'
            : 'indexed'
          : 'processing',
      })),
      total: documents.length,
    };
  }

  @Get(':id')
  async getDocument(@Param('id') id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
        chunks: {
          select: {
            id: true,
            chunkIndex: true,
            pageNumber: true,
            tokenCount: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return {
      ...document,
      fileSize: Number(document.fileSize),
      status: document.processed
        ? document.processingError
          ? 'failed'
          : 'indexed'
        : 'processing',
      chunkCount: document.chunks.length,
    };
  }

  @Get(':id/status')
  async getDocumentStatus(@Param('id') id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        processed: true,
        processingError: true,
        _count: {
          select: {
            chunks: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return {
      documentId: document.id,
      status: document.processed
        ? document.processingError
          ? 'failed'
          : 'indexed'
        : 'processing',
      error: document.processingError,
      chunkCount: document._count.chunks,
    };
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Delete from database (cascades to chunks)
    await this.prisma.document.delete({
      where: { id },
    });

    // TODO: Delete from S3 (implement in service)

    return {
      message: 'Document deleted successfully',
      documentId: id,
    };
  }
}
