/**
 * Playwright E2E Tests for Research Assistant Scratchpad
 * 
 * Tests the scratchpad functionality:
 * - Opening/closing scratchpad panel
 * - Saving answers to scratchpad
 * - Adding user notes
 * - Viewing saved items
 * - Deleting items
 * - Exporting to Markdown
 */

import { test, expect, Page } from '@playwright/test';

// Helper to setup mock authentication
async function setupMockAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'mock-jwt-token-for-testing');
  });

  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        email: 'test@example.com',
        tenantName: 'Test Tenant',
        tenantId: '00000000-0000-0000-0000-000000000000',
        userId: '00000000-0000-0000-0000-000000000001',
      }),
    });
  });
}

test.describe('Research Assistant Scratchpad', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  test.describe('Scratchpad Panel', () => {
    test('should toggle scratchpad panel', async ({ page }) => {
      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/notebooks')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'scratchpad-1',
                title: 'Research Notes',
                insights: []
              }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      // Scratchpad should be hidden initially
      await expect(page.locator('text=Research Scratchpad')).not.toBeVisible();

      // Click scratchpad button
      await page.click('button:has-text("Scratchpad")');
      await page.waitForTimeout(300);

      // Scratchpad should be visible
      await expect(page.locator('text=Research Scratchpad')).toBeVisible();

      // Click close button
      await page.click('button:has(.fa-times)');
      await page.waitForTimeout(300);

      // Scratchpad should be hidden
      await expect(page.locator('text=Research Scratchpad')).not.toBeVisible();
    });

    test('should show empty state when no items', async ({ page }) => {
      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/notebooks')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'scratchpad-1',
                title: 'Research Notes',
                insights: []
              }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Scratchpad")');
      await page.waitForTimeout(300);

      await expect(page.locator('text=No saved items yet')).toBeVisible();
      await expect(page.locator('text=Click "Save" on any answer')).toBeVisible();
    });

    test('should display item count badge', async ({ page }) => {
      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/notebooks') && !url.includes('/insights')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'scratchpad-1',
                title: 'Research Notes',
                insights: [
                  { id: '1', content: 'Item 1' },
                  { id: '2', content: 'Item 2' },
                  { id: '3', content: 'Item 3' }
                ]
              }]
            }),
          });
        } else if (url.includes('scratchpad-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'scratchpad-1',
                insights: [
                  { id: '1', content: 'Item 1', createdAt: new Date().toISOString() },
                  { id: '2', content: 'Item 2', createdAt: new Date().toISOString() },
                  { id: '3', content: 'Item 3', createdAt: new Date().toISOString() }
                ]
              }
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      // Check badge shows count
      const badge = page.locator('button:has-text("Scratchpad") .bg-indigo-600');
      await expect(badge).toContainText('3');
    });
  });

  test.describe('Saving to Scratchpad', () => {
    test('should open save modal when clicking save button', async ({ page }) => {
      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (url.includes('/notebooks') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{ id: 'scratchpad-1', title: 'Research Notes', insights: [] }]
            }),
          });
        } else if (url.includes('conv-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                conversation: { id: 'conv-1', title: 'Test' },
                messages: [
                  {
                    id: 'msg-1',
                    role: 'assistant',
                    content: 'AAPL revenue was $385.6B in FY2024',
                    createdAt: new Date().toISOString()
                  }
                ]
              }
            }),
          });
        } else if (url.includes('/conversations') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'conv-1',
                title: 'Test Conversation',
                messageCount: 1,
                updatedAt: new Date().toISOString()
              }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      // Select conversation
      await page.click('text=Test Conversation');
      await page.waitForTimeout(500);

      // Click save button on message
      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);

      // Modal should be visible
      await expect(page.locator('text=Save to Scratchpad')).toBeVisible();
      await expect(page.locator('textarea[placeholder*="Add context"]')).toBeVisible();
    });

    test('should save item without notes', async ({ page }) => {
      let itemSaved = false;

      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (url.includes('/insights') && method === 'POST') {
          itemSaved = true;
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'insight-1',
                content: 'AAPL revenue was $385.6B',
                userNotes: '',
                createdAt: new Date().toISOString()
              }
            }),
          });
        } else if (url.includes('/notebooks') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{ id: 'scratchpad-1', title: 'Research Notes', insights: [] }]
            }),
          });
        } else if (url.includes('scratchpad-1') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: 'scratchpad-1', insights: [] }
            }),
          });
        } else if (url.includes('conv-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                conversation: { id: 'conv-1', title: 'Test' },
                messages: [{
                  id: 'msg-1',
                  role: 'assistant',
                  content: 'AAPL revenue was $385.6B',
                  createdAt: new Date().toISOString()
                }]
              }
            }),
          });
        } else if (url.includes('/conversations') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'conv-1',
                title: 'Test Conversation',
                messageCount: 1,
                updatedAt: new Date().toISOString()
              }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('text=Test Conversation');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);

      // Click save without adding notes
      await page.click('button:has-text("Save"):not(:has-text("to"))');
      await page.waitForTimeout(500);

      expect(itemSaved).toBe(true);
    });

    test('should save item with notes', async ({ page }) => {
      let savedNotes = '';

      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (url.includes('/insights') && method === 'POST') {
          const body = await route.request().postDataJSON();
          savedNotes = body.userNotes;
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'insight-1',
                content: 'AAPL revenue was $385.6B',
                userNotes: body.userNotes,
                createdAt: new Date().toISOString()
              }
            }),
          });
        } else if (url.includes('/notebooks') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{ id: 'scratchpad-1', title: 'Research Notes', insights: [] }]
            }),
          });
        } else if (url.includes('scratchpad-1') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: 'scratchpad-1', insights: [] }
            }),
          });
        } else if (url.includes('conv-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                conversation: { id: 'conv-1', title: 'Test' },
                messages: [{
                  id: 'msg-1',
                  role: 'assistant',
                  content: 'AAPL revenue was $385.6B',
                  createdAt: new Date().toISOString()
                }]
              }
            }),
          });
        } else if (url.includes('/conversations') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'conv-1',
                title: 'Test Conversation',
                messageCount: 1,
                updatedAt: new Date().toISOString()
              }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('text=Test Conversation');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);

      // Add notes
      await page.fill('textarea[placeholder*="Add context"]', 'Strong growth in services');

      // Click save
      await page.click('button:has-text("Save"):not(:has-text("to"))');
      await page.waitForTimeout(500);

      expect(savedNotes).toBe('Strong growth in services');
    });

    test('should close modal on cancel', async ({ page }) => {
      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/notebooks')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{ id: 'scratchpad-1', title: 'Research Notes', insights: [] }]
            }),
          });
        } else if (url.includes('conv-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                conversation: { id: 'conv-1', title: 'Test' },
                messages: [{
                  id: 'msg-1',
                  role: 'assistant',
                  content: 'Test content',
                  createdAt: new Date().toISOString()
                }]
              }
            }),
          });
        } else if (url.includes('/conversations')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'conv-1',
                title: 'Test Conversation',
                messageCount: 1,
                updatedAt: new Date().toISOString()
              }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('text=Test Conversation');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);

      // Modal should be visible
      await expect(page.locator('text=Save to Scratchpad')).toBeVisible();

      // Click cancel
      await page.click('button:has-text("Cancel")');
      await page.waitForTimeout(300);

      // Modal should be hidden
      await expect(page.locator('text=Save to Scratchpad')).not.toBeVisible();
    });
  });

  test.describe('Viewing Saved Items', () => {
    test('should display saved items in scratchpad', async ({ page }) => {
      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/notebooks') && !url.includes('scratchpad-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{
                id: 'scratchpad-1',
                title: 'Research Notes',
                insights: []
              }]
            }),
          });
        } else if (url.includes('scratchpad-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'scratchpad-1',
                insights: [
                  {
                    id: 'insight-1',
                    content: 'AAPL revenue was **$385.6B** in FY2024',
                    userNotes: 'Strong performance',
                    createdAt: new Date().toISOString()
                  },
                  {
                    id: 'insight-2',
                    content: 'MSFT cloud revenue grew 25% YoY',
                    userNotes: '',
                    createdAt: new Date().toISOString()
                  }
                ]
              }
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Scratchpad")');
      await page.waitForTimeout(500);

      // Check items are displayed
      await expect(page.locator('text=AAPL revenue was')).toBeVisible();
      await expect(page.locator('text=MSFT cloud revenue')).toBeVisible();
      
      // Check user notes are displayed
      await expect(page.locator('text=Strong performance')).toBeVisible();
    });

    test('should render markdown in saved items', async ({ page }) => {
      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        if (url.includes('scratchpad-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'scratchpad-1',
                insights: [{
                  id: 'insight-1',
                  content: '**Bold text** and *italic text*',
                  createdAt: new Date().toISOString()
                }]
              }
            }),
          });
        } else if (url.includes('/notebooks')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{ id: 'scratchpad-1', title: 'Research Notes' }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Scratchpad")');
      await page.waitForTimeout(500);

      // Check markdown is rendered
      await expect(page.locator('strong:has-text("Bold text")')).toBeVisible();
      await expect(page.locator('em:has-text("italic text")')).toBeVisible();
    });
  });

  test.describe('Deleting Items', () => {
    test('should delete item with confirmation', async ({ page }) => {
      let itemDeleted = false;

      page.on('dialog', async (dialog) => {
        expect(dialog.message()).toContain('Remove this item');
        await dialog.accept();
      });

      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (url.includes('/insights/insight-1') && method === 'DELETE') {
          itemDeleted = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
          });
        } else if (url.includes('scratchpad-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'scratchpad-1',
                insights: [{
                  id: 'insight-1',
                  content: 'Test item',
                  createdAt: new Date().toISOString()
                }]
              }
            }),
          });
        } else if (url.includes('/notebooks')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{ id: 'scratchpad-1', title: 'Research Notes' }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Scratchpad")');
      await page.waitForTimeout(500);

      // Click delete button
      await page.click('.fa-trash');
      await page.waitForTimeout(500);

      expect(itemDeleted).toBe(true);
    });
  });

  test.describe('Export', () => {
    test('should export scratchpad to markdown', async ({ page }) => {
      let exportRequested = false;

      await page.route('**/research/**', async (route) => {
        const url = route.request().url();
        
        if (url.includes('/export')) {
          exportRequested = true;
          await route.fulfill({
            status: 200,
            contentType: 'text/markdown',
            headers: {
              'Content-Disposition': 'attachment; filename="notebook.md"'
            },
            body: '# Research Notes\n\n## Insight 1\n\nTest content',
          });
        } else if (url.includes('scratchpad-1')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'scratchpad-1',
                insights: [{
                  id: 'insight-1',
                  content: 'Test content',
                  createdAt: new Date().toISOString()
                }]
              }
            }),
          });
        } else if (url.includes('/notebooks')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [{ id: 'scratchpad-1', title: 'Research Notes' }]
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [] }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);

      await page.click('button:has-text("Scratchpad")');
      await page.waitForTimeout(500);

      // Click export button
      const downloadPromise = page.waitForEvent('download');
      await page.click('button:has-text("Export to Markdown")');
      
      await page.waitForTimeout(500);
      expect(exportRequested).toBe(true);
    });
  });
});
