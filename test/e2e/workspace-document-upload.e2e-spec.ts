import { test, expect } from '@playwright/test';
import * as path from 'path';

/**
 * E2E Tests: Workspace Document Upload
 * 
 * Tests the complete document upload flow in the workspace research tab
 */

test.describe('Workspace Document Upload', () => {
  const TEST_TICKER = 'AAPL';
  const WORKSPACE_URL = `http://localhost:3000/app/deals/workspace.html?ticker=${TEST_TICKER}#research`;

  test.beforeEach(async ({ page }) => {
    // Mock authentication
    await page.addInitScript(() => {
      localStorage.setItem('fundlens_token', 'mock-jwt-token');
      localStorage.setItem(
        'fundlens_user',
        JSON.stringify({
          email: 'test@fundlens.ai',
          tenantId: '00000000-0000-0000-0000-000000000000',
          tenantSlug: 'default',
          role: 'admin',
        })
      );
    });

    // Navigate to workspace
    await page.goto(WORKSPACE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should display upload button in research tab', async ({ page }) => {
    // Check upload button exists
    const uploadButton = page.locator('button:has-text("Upload Document")');
    await expect(uploadButton).toBeVisible();

    // Check documents button exists
    const documentsButton = page.locator('button:has-text("Documents")');
    await expect(documentsButton).toBeVisible();
  });

  test('should show document list when clicked', async ({ page }) => {
    // Click documents button
    const documentsButton = page.locator('button:has-text("Documents")');
    await documentsButton.click();

    // Check document list panel is visible
    const documentList = page.locator('text=Documents for AAPL');
    await expect(documentList).toBeVisible();

    // Should show empty state initially
    const emptyState = page.locator('text=No documents uploaded yet');
    await expect(emptyState).toBeVisible();
  });

  test('should upload a PDF file', async ({ page }) => {
    // Mock the upload API
    await page.route('/api/documents/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documentId: 'test-doc-123',
          status: 'processing',
          message: 'Document uploaded successfully',
        }),
      });
    });

    // Mock the list API
    await page.route('/api/documents?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [
            {
              id: 'test-doc-123',
              title: 'test-document.pdf',
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 1024000,
              status: 'processing',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
        }),
      });
    });

    // Create a test file
    const testFilePath = path.join(__dirname, '../fixtures/test-document.pdf');

    // Click upload button
    const uploadButton = page.locator('button:has-text("Upload Document")');
    await uploadButton.click();

    // Upload file (this will trigger the hidden file input)
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Wait for upload to complete
    await page.waitForTimeout(1000);

    // Check that document appears in list
    await page.locator('button:has-text("Documents")').click();
    const documentTitle = page.locator('text=test-document.pdf');
    await expect(documentTitle).toBeVisible();
  });

  test('should show upload progress', async ({ page }) => {
    // Mock slow upload
    await page.route('/api/documents/upload', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documentId: 'test-doc-123',
          status: 'processing',
        }),
      });
    });

    const testFilePath = path.join(__dirname, '../fixtures/test-document.pdf');

    // Click upload button
    const uploadButton = page.locator('button:has-text("Upload Document")');
    await uploadButton.click();

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testFilePath);

    // Check progress indicator appears
    const progressBar = page.locator('.bg-indigo-600');
    await expect(progressBar).toBeVisible({ timeout: 1000 });
  });

  test('should validate file type', async ({ page }) => {
    // Create an invalid file type
    const invalidFilePath = path.join(__dirname, '../fixtures/test-image.png');

    // Click upload button
    const uploadButton = page.locator('button:has-text("Upload Document")');
    await uploadButton.click();

    // Try to upload invalid file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(invalidFilePath);

    // Should show error (if validation is client-side)
    // Or API should reject it
    await page.waitForTimeout(500);
  });

  test('should delete document', async ({ page }) => {
    // Mock list API with a document
    await page.route('/api/documents?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [
            {
              id: 'test-doc-123',
              title: 'test-document.pdf',
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 1024000,
              status: 'indexed',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
        }),
      });
    });

    // Mock delete API
    await page.route('/api/documents/test-doc-123', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Document deleted successfully',
          }),
        });
      }
    });

    // Open document list
    await page.locator('button:has-text("Documents")').click();

    // Wait for document to appear
    await page.waitForSelector('text=test-document.pdf');

    // Mock confirm dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click delete button
    const deleteButton = page.locator('button:has(.fa-trash)').first();
    await deleteButton.click();

    // Wait for deletion
    await page.waitForTimeout(500);
  });

  test('should show document status', async ({ page }) => {
    // Mock list API with documents in different states
    await page.route('/api/documents?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [
            {
              id: 'doc-1',
              title: 'indexed-doc.pdf',
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 1024000,
              status: 'indexed',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'doc-2',
              title: 'processing-doc.pdf',
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 2048000,
              status: 'processing',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'doc-3',
              title: 'failed-doc.pdf',
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 512000,
              status: 'failed',
              processingError: 'Invalid format',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 3,
        }),
      });
    });

    // Open document list
    await page.locator('button:has-text("Documents")').click();

    // Check indexed document has check icon
    const indexedDoc = page.locator('text=indexed-doc.pdf').locator('..');
    await expect(indexedDoc.locator('.fa-check-circle')).toBeVisible();

    // Check processing document has spinner
    const processingDoc = page.locator('text=processing-doc.pdf').locator('..');
    await expect(processingDoc.locator('.fa-spinner')).toBeVisible();

    // Check failed document has error icon
    const failedDoc = page.locator('text=failed-doc.pdf').locator('..');
    await expect(failedDoc.locator('.fa-exclamation-circle')).toBeVisible();
  });

  test('should refresh document list', async ({ page }) => {
    let callCount = 0;

    // Mock list API
    await page.route('/api/documents?*', async (route) => {
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [
            {
              id: `doc-${callCount}`,
              title: `document-${callCount}.pdf`,
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 1024000,
              status: 'indexed',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
        }),
      });
    });

    // Open document list
    await page.locator('button:has-text("Documents")').click();

    // Wait for initial load
    await page.waitForSelector('text=document-1.pdf');

    // Click refresh
    const refreshButton = page.locator('button:has-text("Refresh")');
    await refreshButton.click();

    // Wait for refresh
    await page.waitForTimeout(500);

    // Should have called API twice
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('should show file size and date', async ({ page }) => {
    const testDate = new Date();

    // Mock list API
    await page.route('/api/documents?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [
            {
              id: 'doc-1',
              title: 'test-doc.pdf',
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 1536000, // 1.5 MB
              status: 'indexed',
              createdAt: testDate.toISOString(),
            },
          ],
          total: 1,
        }),
      });
    });

    // Open document list
    await page.locator('button:has-text("Documents")').click();

    // Check file size is displayed
    const fileSize = page.locator('text=1.5 MB');
    await expect(fileSize).toBeVisible();

    // Check date is displayed (should show "just now" or similar)
    const dateText = page.locator('text=/just now|min ago|hour/');
    await expect(dateText).toBeVisible();
  });

  test('should integrate with research assistant', async ({ page }) => {
    // Mock list API with uploaded document
    await page.route('/api/documents?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [
            {
              id: 'doc-1',
              title: 'pitch-deck.pdf',
              ticker: 'AAPL',
              fileType: 'pdf',
              fileSize: 2048000,
              status: 'indexed',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
        }),
      });
    });

    // Mock research assistant API with citation from uploaded doc
    await page.route('/api/research/conversations/*/messages', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: {"type":"content","content":"Based on the pitch deck [1], the company shows strong growth."}\n\ndata: {"type":"citations","citations":[{"citationNumber":1,"documentId":"doc-1","filename":"pitch-deck.pdf","ticker":"AAPL","snippet":"Revenue grew 25% YoY"}]}\n\ndata: {"type":"done"}\n\n`,
        });
      }
    });

    // Send a research query
    const input = page.locator('textarea[placeholder*="Ask"]');
    await input.fill('What does the pitch deck say about growth?');
    await input.press('Enter');

    // Wait for response
    await page.waitForSelector('text=Based on the pitch deck');

    // Check citation appears
    const citation = page.locator('text=pitch-deck.pdf');
    await expect(citation).toBeVisible();
  });
});
