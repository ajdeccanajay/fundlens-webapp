import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data');

export interface VisionRenderResult {
  images: string[]; // base64-encoded PNG images
  pageCount: number;
  renderedCount: number;
  truncated: boolean;
  warnings: string[];
}

@Injectable()
export class VisionPipelineService {
  private readonly logger = new Logger(VisionPipelineService.name);
  private readonly pythonApiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.pythonApiUrl = this.configService.get<string>('PYTHON_PARSER_URL', 'http://localhost:8000');
  }

  /**
   * Render PDF pages to images at specified DPI for vision analysis.
   */
  async renderPDF(buffer: Buffer, fileName: string, dpi: number = 150): Promise<VisionRenderResult> {
    this.logger.log(`Rendering PDF: ${fileName} at ${dpi} DPI`);

    try {
      const formData = new FormData();
      formData.append('file', buffer, { filename: fileName, contentType: 'application/pdf' });

      const response = await axios.post(
        `${this.pythonApiUrl}/vision/render-pdf?dpi=${dpi}`,
        formData,
        {
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000, // 2 min timeout for large PDFs
        },
      );

      const result: VisionRenderResult = {
        images: response.data.images,
        pageCount: response.data.page_count,
        renderedCount: response.data.rendered_count,
        truncated: response.data.truncated,
        warnings: response.data.warnings || [],
      };

      this.logger.log(`PDF rendered: ${result.renderedCount}/${result.pageCount} pages`);
      return result;
    } catch (error) {
      this.logger.error(`PDF rendering failed for ${fileName}: ${error.message}`);
      throw new Error(`Vision pipeline PDF rendering failed: ${error.message}`);
    }
  }

  /**
   * Render PPTX slides to images at specified DPI for vision analysis.
   * Limits to first 100 slides.
   */
  async renderPPTX(buffer: Buffer, fileName: string, dpi: number = 150): Promise<VisionRenderResult> {
    this.logger.log(`Rendering PPTX: ${fileName} at ${dpi} DPI`);

    try {
      const formData = new FormData();
      formData.append('file', buffer, {
        filename: fileName,
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });

      const response = await axios.post(
        `${this.pythonApiUrl}/vision/render-pptx?dpi=${dpi}`,
        formData,
        {
          headers: formData.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000,
        },
      );

      const result: VisionRenderResult = {
        images: response.data.images,
        pageCount: response.data.page_count,
        renderedCount: response.data.rendered_count,
        truncated: response.data.truncated,
        warnings: response.data.warnings || [],
      };

      if (result.truncated) {
        this.logger.warn(`PPTX truncated: ${result.pageCount} slides, rendered ${result.renderedCount}`);
      }

      this.logger.log(`PPTX rendered: ${result.renderedCount}/${result.pageCount} slides`);
      return result;
    } catch (error) {
      this.logger.error(`PPTX rendering failed for ${fileName}: ${error.message}`);
      throw new Error(`Vision pipeline PPTX rendering failed: ${error.message}`);
    }
  }
}
