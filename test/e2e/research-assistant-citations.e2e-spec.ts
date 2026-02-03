/**
 * E2E Tests for Research Assistant Citations
 * 
 * Tests the full citation flow:
 * 1. Upload document
 * 2. Ask question
 * 3. Verify citations appear
 * 4. Click citation to preview
 * 5. Download document
 */

import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Test user credentials
const TEST_USER = {
  email: 'test@fundlens.com',
  password: 'TestPassword123!',
};

// Helper to create test PDF
function createTestPDF(): string {
  const pdfPath = path.join(__dirname, '../fixtures/test-document.pdf');
  
  // Simple PDF content (minimal valid PDF)
  const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Revenue increased to $2.5B in Q4 2023) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000317 00000 n
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
410
%%EOF`;

  fs.writeFileSync(pdfPath, pdfContent);
  return pdfPath;
}

test.describe('Research Assistant Citations E2E', () => {
  let authToken: string;
  let conversationId: string;
  let documentId: string;

  test.beforeAll(async ({ request }) => {
    // Login to get auth token
    const response = await request.post(`${API_BASE_URL}/auth/login`, {
      data: TEST_USER,
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    authToken = data.token;
  });

  test.beforeEach(async ({ page }) => {
    // Set auth token in localStorage
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.evaluate((token) => {
      localStorage.setItem('authToken', token);
    }, authToken);
  });

  test('should upload document successfully', async ({ request }) => {
    const pdfPath = createTestPDF();

    const response = await request.post(`${API_BASE_URL}/documents/upload`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
      multipart: {
        file: {
          name: 'test-document.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(pdfPath),
        },
        ticker: 'AAPL',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.id).toBeDefined();
    
    documentId = data.data.id;

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Clean up test file
    fs.unlinkSync(pdfPath);
  });

  test('should create conversation and send message', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Click "New Conversation" button
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);

    // Type message
    await page.fill('textarea[placeholder*="Ask about"]', 'What was the revenue in Q4 2023?');

    // Send message
    await page.click('button[class*="send-button"]');

    // Wait for response
    await page.waitForSelector('.message-assistant', { timeout: 30000 });

    // Verify message appears
    const assistantMessage = await page.textContent('.message-assistant');
    expect(assistantMessage).toBeTruthy();
  });

  test('should display citations in response', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Create conversation
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);

    // Send message
    await page.fill('textarea[placeholder*="Ask about"]', 'What was the revenue?');
    await page.click('button[class*="send-button"]');

    // Wait for response with citations
    await page.waitForSelector('.message-assistant', { timeout: 30000 });

    // Check for citation links
    const citationLinks = await page.$$('.citation-link');
    expect(citationLinks.length).toBeGreaterThan(0);

    // Check for citation sidebar
    const citationItems = await page.$$('.citation-item');
    expect(citationItems.length).toBeGreaterThan(0);

    // Verify citation metadata
    const firstCitation = citationItems[0];
    const filename = await firstCitation.$eval('.filename', el => el.textContent);
    expect(filename).toContain('.pdf');
  });

  test('should open document preview on citation click', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Create conversation and send message
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);
    await page.fill('textarea[placeholder*="Ask about"]', 'What was the revenue?');
    await page.click('button[class*="send-button"]');

    // Wait for citations
    await page.waitForSelector('.citation-item', { timeout: 30000 });

    // Click first citation
    await page.click('.citation-item:first-child');

    // Wait for modal to open
    await page.waitForSelector('.document-modal', { timeout: 5000 });

    // Verify modal content
    const modalVisible = await page.isVisible('.document-modal');
    expect(modalVisible).toBe(true);

    // Check for document details
    const filename = await page.textContent('.document-modal h3');
    expect(filename).toBeTruthy();

    // Check for highlighted text
    const highlightedText = await page.$$('.highlighted-text');
    expect(highlightedText.length).toBeGreaterThan(0);

    // Close modal
    await page.click('.document-modal button:has-text("Close")');
    await page.waitForTimeout(500);

    // Verify modal is closed
    const modalHidden = await page.isHidden('.document-modal');
    expect(modalHidden).toBe(true);
  });

  test('should handle multiple citations correctly', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Create conversation
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);

    // Send message that should generate multiple citations
    await page.fill('textarea[placeholder*="Ask about"]', 'Tell me about revenue and margins');
    await page.click('button[class*="send-button"]');

    // Wait for response
    await page.waitForSelector('.message-assistant', { timeout: 30000 });

    // Check for multiple citation links
    const citationLinks = await page.$$('.citation-link');
    
    if (citationLinks.length > 1) {
      // Verify citation numbers are sequential
      for (let i = 0; i < citationLinks.length; i++) {
        const text = await citationLinks[i].textContent();
        expect(text).toContain(`[${i + 1}]`);
      }

      // Click different citations
      await page.click('.citation-item:nth-child(1)');
      await page.waitForSelector('.document-modal');
      const firstFilename = await page.textContent('.document-modal h3');
      await page.click('.document-modal button:has-text("Close")');

      await page.waitForTimeout(500);

      await page.click('.citation-item:nth-child(2)');
      await page.waitForSelector('.document-modal');
      const secondFilename = await page.textContent('.document-modal h3');
      await page.click('.document-modal button:has-text("Close")');

      // Filenames might be the same or different depending on documents
      expect(firstFilename).toBeTruthy();
      expect(secondFilename).toBeTruthy();
    }
  });

  test('should display relevance score correctly', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Create conversation and send message
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);
    await page.fill('textarea[placeholder*="Ask about"]', 'What was the revenue?');
    await page.click('button[class*="send-button"]');

    // Wait for citations
    await page.waitForSelector('.citation-item', { timeout: 30000 });

    // Click citation to open modal
    await page.click('.citation-item:first-child');
    await page.waitForSelector('.document-modal');

    // Check for relevance score
    const scoreText = await page.textContent('.document-modal');
    expect(scoreText).toMatch(/\d+%\s+relevant/);
  });

  test('should handle no citations gracefully', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Create conversation
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);

    // Send message that won't have user document citations
    await page.fill('textarea[placeholder*="Ask about"]', 'What is 2+2?');
    await page.click('button[class*="send-button"]');

    // Wait for response
    await page.waitForSelector('.message-assistant', { timeout: 30000 });

    // Verify no citation sidebar appears
    const citationItems = await page.$$('.citation-item');
    expect(citationItems.length).toBe(0);

    // Verify message still displays correctly
    const messageContent = await page.textContent('.message-assistant');
    expect(messageContent).toBeTruthy();
  });

  test('should handle citation click errors gracefully', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Mock a citation with invalid document ID
    await page.evaluate(() => {
      const mockCitation = {
        citationNumber: 1,
        documentId: 'invalid-id',
        chunkId: 'invalid-chunk',
        filename: 'test.pdf',
        ticker: 'AAPL',
        pageNumber: 1,
        snippet: 'Test snippet',
        score: 0.95,
      };

      // Trigger preview with invalid data
      window.dispatchEvent(new CustomEvent('preview-citation', { 
        detail: mockCitation 
      }));
    });

    // Wait a bit
    await page.waitForTimeout(1000);

    // Modal should still open (even with invalid data)
    const modalVisible = await page.isVisible('.document-modal');
    expect(modalVisible).toBe(true);
  });

  test('should support keyboard navigation', async ({ page }) => {
    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Create conversation and send message
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);
    await page.fill('textarea[placeholder*="Ask about"]', 'What was the revenue?');
    await page.click('button[class*="send-button"]');

    // Wait for citations
    await page.waitForSelector('.citation-item', { timeout: 30000 });

    // Click citation to open modal
    await page.click('.citation-item:first-child');
    await page.waitForSelector('.document-modal');

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify modal is closed
    const modalHidden = await page.isHidden('.document-modal');
    expect(modalHidden).toBe(true);
  });

  test('should be mobile responsive', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Navigate to research assistant
    await page.goto(`${FRONTEND_URL}/app/research/index.html`);
    await page.waitForLoadState('networkidle');

    // Create conversation and send message
    await page.click('button:has-text("New Conversation")');
    await page.waitForTimeout(1000);
    await page.fill('textarea[placeholder*="Ask about"]', 'What was the revenue?');
    await page.click('button[class*="send-button"]');

    // Wait for response
    await page.waitForSelector('.message-assistant', { timeout: 30000 });

    // Check if citations are visible
    const citationItems = await page.$$('.citation-item');
    
    if (citationItems.length > 0) {
      // Click citation
      await page.click('.citation-item:first-child');
      await page.waitForSelector('.document-modal');

      // Verify modal fits on screen
      const modalBox = await page.$eval('.document-content', el => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
        };
      });

      expect(modalBox.width).toBeLessThanOrEqual(375);
    }
  });
});
