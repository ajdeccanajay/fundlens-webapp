import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VisionPipelineService } from '../../src/instant-rag/vision-pipeline.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock form-data as a constructor (form-data exports a class via module.exports)
const mockAppend = jest.fn();
const mockGetHeaders = jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' });
jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: mockAppend,
    getHeaders: mockGetHeaders,
  }));
});

describe('VisionPipelineService', () => {
  let service: VisionPipelineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisionPipelineService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:8000'),
          },
        },
      ],
    }).compile();

    service = module.get<VisionPipelineService>(VisionPipelineService);
    jest.clearAllMocks();
    // Re-setup the mock return value after clearAllMocks
    mockGetHeaders.mockReturnValue({ 'content-type': 'multipart/form-data' });
  });

  describe('renderPDF', () => {
    it('should render PDF pages to base64 images', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          images: ['base64img1', 'base64img2', 'base64img3'],
          page_count: 3,
          rendered_count: 3,
          truncated: false,
          warnings: [],
        },
      });

      const result = await service.renderPDF(Buffer.from('fake-pdf'), 'test.pdf');

      expect(result.images).toHaveLength(3);
      expect(result.pageCount).toBe(3);
      expect(result.renderedCount).toBe(3);
      expect(result.truncated).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it('should pass DPI parameter', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { images: ['img1'], page_count: 1, rendered_count: 1, truncated: false, warnings: [] },
      });

      await service.renderPDF(Buffer.from('pdf'), 'test.pdf', 300);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:8000/vision/render-pdf?dpi=300',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should default to 150 DPI', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { images: ['img1'], page_count: 1, rendered_count: 1, truncated: false, warnings: [] },
      });

      await service.renderPDF(Buffer.from('pdf'), 'test.pdf');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:8000/vision/render-pdf?dpi=150',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should throw on API error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

      await expect(service.renderPDF(Buffer.from('pdf'), 'test.pdf'))
        .rejects.toThrow('Vision pipeline PDF rendering failed: Connection refused');
    });

    it('should handle empty response', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { images: [], page_count: 0, rendered_count: 0, truncated: false, warnings: [] },
      });

      const result = await service.renderPDF(Buffer.from('pdf'), 'empty.pdf');
      expect(result.images).toHaveLength(0);
      expect(result.pageCount).toBe(0);
    });

    it('should set correct timeout and content length options', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { images: ['img1'], page_count: 1, rendered_count: 1, truncated: false, warnings: [] },
      });

      await service.renderPDF(Buffer.from('pdf'), 'test.pdf');

      const callArgs = mockedAxios.post.mock.calls[0][2];
      expect(callArgs.timeout).toBe(120000);
      expect(callArgs.maxContentLength).toBe(Infinity);
      expect(callArgs.maxBodyLength).toBe(Infinity);
    });
  });

  describe('renderPPTX', () => {
    it('should render PPTX slides to base64 images', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          images: ['slide1', 'slide2'],
          page_count: 2,
          rendered_count: 2,
          truncated: false,
          warnings: [],
        },
      });

      const result = await service.renderPPTX(Buffer.from('fake-pptx'), 'deck.pptx');

      expect(result.images).toHaveLength(2);
      expect(result.pageCount).toBe(2);
      expect(result.renderedCount).toBe(2);
      expect(result.truncated).toBe(false);
    });

    it('should handle truncated PPTX (>100 slides)', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          images: new Array(100).fill('slideimg'),
          page_count: 150,
          rendered_count: 100,
          truncated: true,
          warnings: ['PPTX has 150 slides, only first 100 rendered'],
        },
      });

      const result = await service.renderPPTX(Buffer.from('pptx'), 'big-deck.pptx');

      expect(result.truncated).toBe(true);
      expect(result.pageCount).toBe(150);
      expect(result.renderedCount).toBe(100);
      expect(result.images).toHaveLength(100);
      expect(result.warnings).toContain('PPTX has 150 slides, only first 100 rendered');
    });

    it('should pass DPI parameter for PPTX', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { images: ['s1'], page_count: 1, rendered_count: 1, truncated: false, warnings: [] },
      });

      await service.renderPPTX(Buffer.from('pptx'), 'deck.pptx', 200);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:8000/vision/render-pptx?dpi=200',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should throw on PPTX rendering error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Timeout'));

      await expect(service.renderPPTX(Buffer.from('pptx'), 'deck.pptx'))
        .rejects.toThrow('Vision pipeline PPTX rendering failed: Timeout');
    });

    it('should handle missing warnings field', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { images: ['s1'], page_count: 1, rendered_count: 1, truncated: false },
      });

      const result = await service.renderPPTX(Buffer.from('pptx'), 'deck.pptx');
      expect(result.warnings).toEqual([]);
    });

    it('should append file with correct content type', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { images: ['s1'], page_count: 1, rendered_count: 1, truncated: false, warnings: [] },
      });

      await service.renderPPTX(Buffer.from('pptx'), 'deck.pptx');

      expect(mockAppend).toHaveBeenCalledWith(
        'file',
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'deck.pptx',
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }),
      );
    });
  });
});
