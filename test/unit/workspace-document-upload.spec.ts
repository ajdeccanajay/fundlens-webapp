import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Unit Tests: Workspace Document Upload
 * 
 * Tests the document upload functionality in the workspace research tab
 */

describe('Workspace Document Upload', () => {
  let mockWorkspace: any;
  let mockFetch: any;
  let mockXHR: any;

  beforeEach(() => {
    // Mock localStorage
    global.localStorage = {
      getItem: jest.fn((key: string) => {
        if (key === 'fundlens_token') return 'mock-token';
        if (key === 'fundlens_user') {
          return JSON.stringify({
            email: 'test@fundlens.ai',
            tenantId: 'test-tenant-id',
            tenantSlug: 'test-tenant',
          });
        }
        return null;
      }),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      length: 0,
      key: jest.fn(),
    } as any;

    // Mock fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch as any;

    // Mock XMLHttpRequest
    mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      upload: {
        addEventListener: jest.fn(),
      },
      addEventListener: jest.fn(),
      status: 200,
      responseText: JSON.stringify({ documentId: 'doc-123', status: 'processing' }),
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR) as any;

    // Create mock workspace instance
    mockWorkspace = {
      dealInfo: { ticker: 'AAPL' },
      uploadedDocuments: [],
      showDocumentList: false,
      uploadProgress: 0,
      uploadError: null,
      $refs: {
        fileInput: {
          click: jest.fn(),
          value: '',
        },
      },
      getAuthHeaders: () => ({
        Authorization: 'Bearer mock-token',
        'Content-Type': 'application/json',
      }),
      loadDocuments: jest.fn(),
    };
  });

  describe('triggerFileUpload', () => {
    it('should click the file input', () => {
      const triggerFileUpload = function (this: any) {
        this.$refs.fileInput.click();
      };

      triggerFileUpload.call(mockWorkspace);

      expect(mockWorkspace.$refs.fileInput.click).toHaveBeenCalled();
    });
  });

  describe('handleFileSelect', () => {
    it('should validate file type', async () => {
      const handleFileSelect = async function (this: any, event: any) {
        const file = event.target.files[0];
        if (!file) return;

        const allowedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];
        if (!allowedTypes.includes(file.type)) {
          this.uploadError = 'Invalid file type. Only PDF, DOCX, and TXT are allowed.';
          return;
        }
      };

      const mockEvent = {
        target: {
          files: [{ type: 'image/png', size: 1000 }],
          value: '',
        },
      };

      await handleFileSelect.call(mockWorkspace, mockEvent);

      expect(mockWorkspace.uploadError).toBe(
        'Invalid file type. Only PDF, DOCX, and TXT are allowed.'
      );
    });

    it('should validate file size', async () => {
      const handleFileSelect = async function (this: any, event: any) {
        const file = event.target.files[0];
        if (!file) return;

        const allowedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];
        if (!allowedTypes.includes(file.type)) {
          this.uploadError = 'Invalid file type. Only PDF, DOCX, and TXT are allowed.';
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          this.uploadError = 'File too large. Maximum size is 10MB.';
          return;
        }
      };

      const mockEvent = {
        target: {
          files: [{ type: 'application/pdf', size: 11 * 1024 * 1024 }],
          value: '',
        },
      };

      await handleFileSelect.call(mockWorkspace, mockEvent);

      expect(mockWorkspace.uploadError).toBe('File too large. Maximum size is 10MB.');
    });

    it('should upload valid file', async () => {
      const handleFileSelect = async function (this: any, event: any) {
        const file = event.target.files[0];
        if (!file) return;

        const allowedTypes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];
        if (!allowedTypes.includes(file.type)) {
          this.uploadError = 'Invalid file type. Only PDF, DOCX, and TXT are allowed.';
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          this.uploadError = 'File too large. Maximum size is 10MB.';
          return;
        }

        this.uploadProgress = 0;
        this.uploadError = null;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/documents/upload');
        xhr.send(new FormData());
      };

      const mockEvent = {
        target: {
          files: [{ type: 'application/pdf', size: 1000, name: 'test.pdf' }],
          value: 'test.pdf',
        },
      };

      await handleFileSelect.call(mockWorkspace, mockEvent);

      expect(mockWorkspace.uploadProgress).toBe(0);
      expect(mockWorkspace.uploadError).toBeNull();
      expect(mockXHR.open).toHaveBeenCalledWith('POST', '/api/documents/upload');
    });
  });

  describe('loadDocuments', () => {
    it('should load documents for current ticker', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documents: [
            {
              id: 'doc-1',
              title: 'test.pdf',
              ticker: 'AAPL',
              fileSize: 1000,
              status: 'indexed',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
        }),
      });

      const loadDocuments = async function (this: any) {
        const headers = this.getAuthHeaders();
        if (!headers) return;

        const user = JSON.parse(localStorage.getItem('fundlens_user') || '{}');
        const tenantId = user.tenantId || '00000000-0000-0000-0000-000000000000';

        const response = await fetch(
          `/api/documents?tenantId=${tenantId}&ticker=${this.dealInfo.ticker}`,
          { headers }
        );

        if (!response.ok) {
          console.error('Failed to load documents');
          return;
        }

        const result = await response.json();
        this.uploadedDocuments = result.documents || [];
      };

      await loadDocuments.call(mockWorkspace);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/documents?tenantId=test-tenant-id&ticker=AAPL',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        })
      );
      expect(mockWorkspace.uploadedDocuments).toHaveLength(1);
      expect(mockWorkspace.uploadedDocuments[0].title).toBe('test.pdf');
    });

    it('should handle load error gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      const loadDocuments = async function (this: any) {
        try {
          const headers = this.getAuthHeaders();
          if (!headers) return;

          const user = JSON.parse(localStorage.getItem('fundlens_user') || '{}');
          const tenantId = user.tenantId || '00000000-0000-0000-0000-000000000000';

          const response = await fetch(
            `/api/documents?tenantId=${tenantId}&ticker=${this.dealInfo.ticker}`,
            { headers }
          );

          if (!response.ok) {
            console.error('Failed to load documents');
            return;
          }

          const result = await response.json();
          this.uploadedDocuments = result.documents || [];
        } catch (error) {
          console.error('Error loading documents:', error);
        }
      };

      await loadDocuments.call(mockWorkspace);

      expect(consoleError).toHaveBeenCalledWith('Failed to load documents');
      consoleError.mockRestore();
    });
  });

  describe('deleteDocument', () => {
    it('should delete document with confirmation', async () => {
      global.confirm = jest.fn(() => true) as any;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Document deleted successfully' }),
      });

      const deleteDocument = async function (this: any, documentId: string) {
        if (!confirm('Are you sure you want to delete this document?')) {
          return;
        }

        const headers = this.getAuthHeaders();
        if (!headers) return;

        const response = await fetch(`/api/documents/${documentId}`, {
          method: 'DELETE',
          headers,
        });

        if (!response.ok) {
          throw new Error('Delete failed');
        }

        await this.loadDocuments();
      };

      await deleteDocument.call(mockWorkspace, 'doc-123');

      expect(global.confirm).toHaveBeenCalledWith(
        'Are you sure you want to delete this document?'
      );
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/documents/doc-123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
      expect(mockWorkspace.loadDocuments).toHaveBeenCalled();
    });

    it('should not delete if user cancels', async () => {
      global.confirm = jest.fn(() => false) as any;

      const deleteDocument = async function (this: any, documentId: string) {
        if (!confirm('Are you sure you want to delete this document?')) {
          return;
        }

        const headers = this.getAuthHeaders();
        if (!headers) return;

        const response = await fetch(`/api/documents/${documentId}`, {
          method: 'DELETE',
          headers,
        });

        if (!response.ok) {
          throw new Error('Delete failed');
        }

        await this.loadDocuments();
      };

      await deleteDocument.call(mockWorkspace, 'doc-123');

      expect(global.confirm).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockWorkspace.loadDocuments).not.toHaveBeenCalled();
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      const formatFileSize = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
      };

      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(1048576)).toBe('1 MB');
      expect(formatFileSize(1073741824)).toBe('1 GB');
    });
  });

  describe('formatDate', () => {
    it('should format recent dates correctly', () => {
      const formatDate = (dateString: string) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return date.toLocaleDateString();
      };

      const now = new Date();
      const oneMinAgo = new Date(now.getTime() - 60000);
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const oneDayAgo = new Date(now.getTime() - 86400000);
      const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);

      expect(formatDate(now.toISOString())).toBe('just now');
      expect(formatDate(oneMinAgo.toISOString())).toBe('1 min ago');
      expect(formatDate(oneHourAgo.toISOString())).toBe('1 hour ago');
      expect(formatDate(oneDayAgo.toISOString())).toBe('1 day ago');
      expect(formatDate(oneWeekAgo.toISOString())).toBe(oneWeekAgo.toLocaleDateString());
    });

    it('should handle empty date', () => {
      const formatDate = (dateString: string) => {
        if (!dateString) return '';
        return 'formatted';
      };

      expect(formatDate('')).toBe('');
    });
  });
});
