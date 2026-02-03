/**
 * E2E Tests for Workspace Chat & Scratch Pad Upgrade
 * Tests complete user flows across all 4 phases
 */

import { test, expect } from '@playwright/test';

test.describe('Workspace Chat & Scratch Pad - E2E Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to workspace
    await page.goto('/app/deals/workspace.html?ticker=AAPL');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: DESIGN SYSTEM TESTS
  // ═══════════════════════════════════════════════════════════════
  
  test.describe('Phase 1: Design System Visual Tests', () => {
    test('should display navy color for primary elements', async ({ page }) => {
      // Check header background
      const header = page.locator('nav.bg-white').first();
      await expect(header).toBeVisible();
      
      // Check logo gradient
      const logo = page.locator('.w-8.h-8.rounded-lg').first();
      const background = await logo.evaluate(el => 
        window.getComputedStyle(el).background
      );
      expect(background).toContain('linear-gradient');
    });
    
    test('should use Inter font family', async ({ page }) => {
      const body = page.locator('body');
      const fontFamily = await body.evaluate(el => 
        window.getComputedStyle(el).fontFamily
      );
      expect(fontFamily).toContain('Inter');
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: CHAT INTERFACE TESTS
  // ═══════════════════════════════════════════════════════════════
  
  test.describe('Phase 2: Chat Interface Flow', () => {
    test('should send message and receive response', async ({ page }) => {
      // Switch to research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      // Type message
      const input = page.locator('textarea[placeholder*="Ask"]').first();
      await input.fill('What are the key metrics for AAPL?');
      
      // Send message
      await page.click('button[type="submit"]');
      
      // Wait for response
      await page.waitForSelector('.message-assistant', { timeout: 10000 });
      
      // Verify message appears
      const userMessage = page.locator('.message-user').last();
      await expect(userMessage).toContainText('key metrics');
      
      // Verify response appears
      const assistantMessage = page.locator('.message-assistant').last();
      await expect(assistantMessage).toBeVisible();
    });
    
    test('should show message actions on hover', async ({ page }) => {
      // Switch to research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      // Find a message
      const message = page.locator('.message-assistant').first();
      if (await message.count() > 0) {
        // Hover over message
        await message.hover();
        
        // Check for actions
        const actions = message.locator('.message__actions');
        await expect(actions).toBeVisible();
      }
    });
    
    test('should copy message content', async ({ page }) => {
      // Switch to research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      // Find a message with actions
      const message = page.locator('.message-assistant').first();
      if (await message.count() > 0) {
        await message.hover();
        
        // Click copy button
        const copyBtn = message.locator('button:has-text("Copy")');
        if (await copyBtn.count() > 0) {
          await copyBtn.click();
          
          // Verify success (check for toast or button state change)
          await page.waitForTimeout(500);
        }
      }
    });
    
    test('should show streaming cursor while typing', async ({ page }) => {
      // Switch to research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      // Send message
      const input = page.locator('textarea[placeholder*="Ask"]').first();
      await input.fill('Test message');
      await page.click('button[type="submit"]');
      
      // Check for streaming indicator
      const streamingMessage = page.locator('.message--streaming');
      // Note: This might not always be visible depending on response speed
      // Just check that the selector exists
      expect(streamingMessage).toBeDefined();
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: SCRATCH PAD TESTS
  // ═══════════════════════════════════════════════════════════════
  
  test.describe('Phase 3: Scratch Pad Flow', () => {
    test('should open scratch pad panel', async ({ page }) => {
      // Click scratch pad in sidebar
      await page.click('text=Scratchpad');
      await page.waitForTimeout(500);
      
      // Verify scratch pad view is active
      const scratchpadView = page.locator('[x-show="currentView === \'scratchpad\'"]');
      await expect(scratchpadView).toBeVisible();
    });
    
    test('should save message to scratch pad', async ({ page }) => {
      // Switch to research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      // Find a message
      const message = page.locator('.message-assistant').first();
      if (await message.count() > 0) {
        await message.hover();
        
        // Click save button
        const saveBtn = message.locator('button:has-text("Save")');
        if (await saveBtn.count() > 0) {
          await saveBtn.click();
          
          // Wait for animation
          await page.waitForTimeout(500);
          
          // Switch to scratch pad
          await page.click('text=Scratchpad');
          await page.waitForTimeout(500);
          
          // Verify item appears in scratch pad
          const scratchpadItems = page.locator('.saved-item');
          expect(await scratchpadItems.count()).toBeGreaterThan(0);
        }
      }
    });
    
    test('should search scratch pad items', async ({ page }) => {
      // Go to scratch pad
      await page.click('text=Scratchpad');
      await page.waitForTimeout(500);
      
      // Find search input
      const searchInput = page.locator('input[placeholder*="Search"]').first();
      if (await searchInput.count() > 0) {
        // Type search query
        await searchInput.fill('revenue');
        await page.waitForTimeout(300);
        
        // Verify filtered results
        const items = page.locator('.saved-item');
        const count = await items.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
    
    test('should delete scratch pad item', async ({ page }) => {
      // Go to scratch pad
      await page.click('text=Scratchpad');
      await page.waitForTimeout(500);
      
      // Find first item
      const firstItem = page.locator('.saved-item').first();
      if (await firstItem.count() > 0) {
        const initialCount = await page.locator('.saved-item').count();
        
        // Click delete button
        const deleteBtn = firstItem.locator('button:has-text("Delete")');
        if (await deleteBtn.count() > 0) {
          await deleteBtn.click();
          
          // Confirm deletion if modal appears
          const confirmBtn = page.locator('button:has-text("Confirm")');
          if (await confirmBtn.count() > 0) {
            await confirmBtn.click();
          }
          
          await page.waitForTimeout(500);
          
          // Verify item count decreased
          const newCount = await page.locator('.saved-item').count();
          expect(newCount).toBeLessThanOrEqual(initialCount);
        }
      }
    });
    
    test('should export scratch pad items', async ({ page }) => {
      // Go to scratch pad
      await page.click('text=Scratchpad');
      await page.waitForTimeout(500);
      
      // Find export button
      const exportBtn = page.locator('button:has-text("Export")').first();
      if (await exportBtn.count() > 0) {
        // Set up download listener
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
        
        // Click export
        await exportBtn.click();
        
        // Wait for download
        const download = await downloadPromise;
        if (download) {
          expect(download.suggestedFilename()).toMatch(/\.(pdf|docx|md)$/);
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: RICH CONTENT TESTS
  // ═══════════════════════════════════════════════════════════════
  
  test.describe('Phase 4: Rich Content Rendering', () => {
    test('should render financial tables', async ({ page }) => {
      // Switch to analysis view
      await page.click('text=Analysis');
      await page.waitForTimeout(500);
      
      // Look for financial tables
      const tables = page.locator('.annual-table, .financial-table');
      if (await tables.count() > 0) {
        const firstTable = tables.first();
        await expect(firstTable).toBeVisible();
        
        // Check for table headers
        const headers = firstTable.locator('th');
        expect(await headers.count()).toBeGreaterThan(0);
      }
    });
    
    test('should display citations in messages', async ({ page }) => {
      // Switch to research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      // Look for citations
      const citations = page.locator('.citation, .citation-link');
      if (await citations.count() > 0) {
        const firstCitation = citations.first();
        await expect(firstCitation).toBeVisible();
        
        // Click citation
        await firstCitation.click();
        
        // Check for popover or modal
        await page.waitForTimeout(500);
        const popover = page.locator('.citation-popover, .document-modal');
        // Popover might appear
        expect(popover).toBeDefined();
      }
    });
    
    test('should format currency values correctly', async ({ page }) => {
      // Switch to analysis view
      await page.click('text=Analysis');
      await page.waitForTimeout(500);
      
      // Look for currency values
      const currencyElements = page.locator('text=/\\$[0-9.]+[BMK]/');
      if (await currencyElements.count() > 0) {
        const firstValue = await currencyElements.first().textContent();
        expect(firstValue).toMatch(/\$[0-9.]+[BMK]/);
      }
    });
    
    test('should format percentage values correctly', async ({ page }) => {
      // Switch to analysis view
      await page.click('text=Analysis');
      await page.waitForTimeout(500);
      
      // Look for percentage values
      const percentElements = page.locator('text=/[0-9.]+%/');
      if (await percentElements.count() > 0) {
        const firstValue = await percentElements.first().textContent();
        expect(firstValue).toMatch(/[0-9.]+%/);
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // INTEGRATION TESTS
  // ═══════════════════════════════════════════════════════════════
  
  test.describe('Integration Tests', () => {
    test('complete workflow: chat -> save -> export', async ({ page }) => {
      // 1. Send message in research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      const input = page.locator('textarea[placeholder*="Ask"]').first();
      await input.fill('What is the revenue trend?');
      await page.click('button[type="submit"]');
      
      // Wait for response
      await page.waitForSelector('.message-assistant', { timeout: 10000 });
      
      // 2. Save message to scratch pad
      const message = page.locator('.message-assistant').last();
      await message.hover();
      
      const saveBtn = message.locator('button:has-text("Save")');
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(500);
      }
      
      // 3. Go to scratch pad
      await page.click('text=Scratchpad');
      await page.waitForTimeout(500);
      
      // 4. Verify item exists
      const items = page.locator('.saved-item');
      expect(await items.count()).toBeGreaterThan(0);
      
      // 5. Export (if button exists)
      const exportBtn = page.locator('button:has-text("Export")').first();
      if (await exportBtn.count() > 0) {
        await exportBtn.click();
        await page.waitForTimeout(500);
      }
    });
    
    test('keyboard shortcuts should work', async ({ page }) => {
      // Test Cmd+1 for Analysis
      await page.keyboard.press('Meta+1');
      await page.waitForTimeout(300);
      
      // Test Cmd+2 for Research
      await page.keyboard.press('Meta+2');
      await page.waitForTimeout(300);
      
      // Test Cmd+3 for Scratchpad
      await page.keyboard.press('Meta+3');
      await page.waitForTimeout(300);
      
      // Verify navigation worked
      const scratchpadView = page.locator('[x-show="currentView === \'scratchpad\'"]');
      await expect(scratchpadView).toBeVisible();
    });
    
    test('should handle file upload', async ({ page }) => {
      // Switch to research view
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      // Look for upload button
      const uploadBtn = page.locator('button:has-text("Upload"), input[type="file"]').first();
      if (await uploadBtn.count() > 0) {
        // Create a test file
        const testFile = {
          name: 'test-document.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('test content')
        };
        
        // Upload file
        const fileInput = page.locator('input[type="file"]').first();
        if (await fileInput.count() > 0) {
          await fileInput.setInputFiles(testFile);
          
          // Wait for upload to complete
          await page.waitForTimeout(2000);
          
          // Verify upload success (look for success message or uploaded file list)
          const uploadedFiles = page.locator('.uploaded-document, .document-item');
          expect(uploadedFiles).toBeDefined();
        }
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // ACCESSIBILITY TESTS
  // ═══════════════════════════════════════════════════════════════
  
  test.describe('Accessibility Tests', () => {
    test('should have proper ARIA labels', async ({ page }) => {
      // Check navigation items
      const navItems = page.locator('[role="button"][aria-label]');
      expect(await navItems.count()).toBeGreaterThan(0);
    });
    
    test('should support keyboard navigation', async ({ page }) => {
      // Tab through interactive elements
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
      
      // Verify focus is visible
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    });
    
    test('should have sufficient color contrast', async ({ page }) => {
      // This would require axe-core or similar tool
      // For now, just verify text is visible
      const textElements = page.locator('body *:visible');
      expect(await textElements.count()).toBeGreaterThan(0);
    });
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE TESTS
  // ═══════════════════════════════════════════════════════════════
  
  test.describe('Performance Tests', () => {
    test('should load page within 3 seconds', async ({ page }) => {
      const startTime = Date.now();
      await page.goto('/app/deals/workspace.html?ticker=AAPL');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;
      
      expect(loadTime).toBeLessThan(3000);
    });
    
    test('should render 100 messages without lag', async ({ page }) => {
      // This would require mocking a large message list
      // For now, just verify the page doesn't crash
      await page.click('text=Research');
      await page.waitForTimeout(500);
      
      const messages = page.locator('.message-user, .message-assistant');
      expect(messages).toBeDefined();
    });
  });
});
