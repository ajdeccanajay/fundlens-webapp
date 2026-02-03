/**
 * E2E Tests for Workspace Research Citations
 * Tests the citation functionality in the Deals Workspace Research tab
 */

import { test, expect } from '@playwright/test';

test.describe('Workspace Research Citations', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to workspace with a ticker
    await page.goto('http://localhost:3000/app/deals/workspace.html?ticker=AAPL#research');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Wait for research view to be visible
    await page.waitForSelector('[x-show="currentView === \'research\'"]', { state: 'visible' });
  });

  test('should display research assistant interface', async ({ page }) => {
    // Check for research assistant title
    await expect(page.locator('h2:has-text("Research Assistant")')).toBeVisible();
    
    // Check for input textarea
    await expect(page.locator('textarea[placeholder*="Ask about"]')).toBeVisible();
    
    // Check for send button
    await expect(page.locator('button:has-text("paper-plane")')).toBeVisible();
  });

  test('should send message and receive response', async ({ page }) => {
    // Type a message
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('What are the key risks for AAPL?');
    
    // Send message
    await page.locator('button:has(i.fa-paper-plane)').click();
    
    // Wait for user message to appear
    await expect(page.locator('.message-user:has-text("What are the key risks")')).toBeVisible();
    
    // Wait for assistant response (with timeout)
    await expect(page.locator('.message-assistant')).toBeVisible({ timeout: 30000 });
  });

  test('should display citations when available', async ({ page }) => {
    // Mock the SSE response with citations
    await page.route('**/api/research/conversations/*/messages', async (route) => {
      const response = `event: token
data: {"text":"Based on the documents "}

event: token
data: {"text":"[1]"}

event: token
data: {"text":", the key risks include market competition."}

event: citations
data: {"citations":[{"citationNumber":1,"documentId":"doc-123","chunkId":"chunk-456","filename":"risk-analysis.pdf","ticker":"AAPL","pageNumber":5,"snippet":"Market competition from Android devices","score":0.92}]}

event: done
data: {"complete":true}

`;
      
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: response
      });
    });
    
    // Send a message
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('What are the risks?');
    await page.locator('button:has(i.fa-paper-plane)').click();
    
    // Wait for response
    await page.waitForSelector('.message-assistant', { timeout: 10000 });
    
    // Check for citations section
    await expect(page.locator('text=Citations')).toBeVisible();
    
    // Check for citation item
    await expect(page.locator('.citation-item')).toBeVisible();
    
    // Check for citation number
    await expect(page.locator('.citation-number:has-text("1")')).toBeVisible();
    
    // Check for filename
    await expect(page.locator('text=risk-analysis.pdf')).toBeVisible();
  });

  test('should open document preview on citation click', async ({ page }) => {
    // Mock response with citations
    await page.route('**/api/research/conversations/*/messages', async (route) => {
      const response = `event: token
data: {"text":"Revenue increased [1]"}

event: citations
data: {"citations":[{"citationNumber":1,"documentId":"doc-123","filename":"report.pdf","snippet":"Revenue data","score":0.95}]}

event: done
data: {"complete":true}

`;
      
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: response
      });
    });
    
    // Send message
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('Show revenue');
    await page.locator('button:has(i.fa-paper-plane)').click();
    
    // Wait for citation to appear
    await page.waitForSelector('.citation-item', { timeout: 10000 });
    
    // Click on citation
    await page.locator('.citation-item').first().click();
    
    // Check if modal is visible
    await expect(page.locator('.document-modal')).toBeVisible();
    
    // Check modal content
    await expect(page.locator('text=report.pdf')).toBeVisible();
    await expect(page.locator('text=Revenue data')).toBeVisible();
  });

  test('should close document preview with Escape key', async ({ page }) => {
    // Mock response with citations
    await page.route('**/api/research/conversations/*/messages', async (route) => {
      const response = `event: token
data: {"text":"Data [1]"}

event: citations
data: {"citations":[{"citationNumber":1,"documentId":"doc-1","filename":"test.pdf","snippet":"Test"}]}

event: done
data: {"complete":true}

`;
      
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: response
      });
    });
    
    // Send message and open modal
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('Test');
    await page.locator('button:has(i.fa-paper-plane)').click();
    await page.waitForSelector('.citation-item', { timeout: 10000 });
    await page.locator('.citation-item').first().click();
    
    // Wait for modal
    await expect(page.locator('.document-modal')).toBeVisible();
    
    // Press Escape
    await page.keyboard.press('Escape');
    
    // Modal should be hidden
    await expect(page.locator('.document-modal')).not.toBeVisible();
  });

  test('should display citation metadata correctly', async ({ page }) => {
    // Mock response with full citation metadata
    await page.route('**/api/research/conversations/*/messages', async (route) => {
      const response = `event: token
data: {"text":"Analysis [1]"}

event: citations
data: {"citations":[{"citationNumber":1,"documentId":"doc-1","chunkId":"chunk-1","filename":"annual-report.pdf","ticker":"AAPL","pageNumber":15,"snippet":"Detailed financial analysis","score":0.88}]}

event: done
data: {"complete":true}

`;
      
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: response
      });
    });
    
    // Send message
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('Analysis');
    await page.locator('button:has(i.fa-paper-plane)').click();
    
    // Wait for citation
    await page.waitForSelector('.citation-item', { timeout: 10000 });
    
    // Check metadata
    await expect(page.locator('text=annual-report.pdf')).toBeVisible();
    await expect(page.locator('text=AAPL')).toBeVisible();
    await expect(page.locator('text=Page 15')).toBeVisible();
    await expect(page.locator('text=Detailed financial analysis')).toBeVisible();
  });

  test('should handle multiple citations', async ({ page }) => {
    // Mock response with multiple citations
    await page.route('**/api/research/conversations/*/messages', async (route) => {
      const response = `event: token
data: {"text":"Revenue [1] and profit [2] increased"}

event: citations
data: {"citations":[{"citationNumber":1,"documentId":"doc-1","filename":"revenue.pdf","snippet":"Revenue data"},{"citationNumber":2,"documentId":"doc-2","filename":"profit.pdf","snippet":"Profit data"}]}

event: done
data: {"complete":true}

`;
      
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: response
      });
    });
    
    // Send message
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('Show data');
    await page.locator('button:has(i.fa-paper-plane)').click();
    
    // Wait for citations
    await page.waitForSelector('.citation-item', { timeout: 10000 });
    
    // Check for both citations
    const citationItems = page.locator('.citation-item');
    await expect(citationItems).toHaveCount(2);
    
    // Check citation numbers
    await expect(page.locator('.citation-number:has-text("1")')).toBeVisible();
    await expect(page.locator('.citation-number:has-text("2")')).toBeVisible();
  });

  test('should handle messages without citations gracefully', async ({ page }) => {
    // Mock response without citations
    await page.route('**/api/research/conversations/*/messages', async (route) => {
      const response = `event: token
data: {"text":"This is a response without citations"}

event: done
data: {"complete":true}

`;
      
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: response
      });
    });
    
    // Send message
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('Simple question');
    await page.locator('button:has(i.fa-paper-plane)').click();
    
    // Wait for response
    await page.waitForSelector('.message-assistant', { timeout: 10000 });
    
    // Citations section should not be visible
    await expect(page.locator('text=Citations')).not.toBeVisible();
  });

  test('should maintain existing scratchpad functionality', async ({ page }) => {
    // Mock response
    await page.route('**/api/research/conversations/*/messages', async (route) => {
      const response = `event: token
data: {"text":"Test response"}

event: done
data: {"complete":true}

`;
      
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: response
      });
    });
    
    // Send message
    const input = page.locator('textarea[placeholder*="Ask about"]');
    await input.fill('Test');
    await page.locator('button:has(i.fa-paper-plane)').click();
    
    // Wait for response
    await page.waitForSelector('.message-assistant', { timeout: 10000 });
    
    // Check for "Save to Scratchpad" button
    await expect(page.locator('button:has-text("Save to Scratchpad")')).toBeVisible();
  });

  test('should be mobile responsive', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check if interface is still usable
    await expect(page.locator('textarea[placeholder*="Ask about"]')).toBeVisible();
    await expect(page.locator('button:has(i.fa-paper-plane)').click();
  });
});
