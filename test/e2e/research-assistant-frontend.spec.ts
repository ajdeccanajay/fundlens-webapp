/**
 * Playwright E2E Tests for Research Assistant Frontend
 * 
 * Tests the complete user journey through the Research Assistant interface:
 * - Page load and initialization
 * - Conversation creation and management
 * - Message sending and streaming
 * - Markdown rendering
 * - Pin/unpin/delete operations
 * - Welcome screen quick queries
 * - Keyboard shortcuts
 * - Responsive design
 * 
 * These tests verify the frontend works correctly end-to-end.
 */

import { test, expect, Page } from '@playwright/test';

// Test configuration
const TEST_USER = {
  email: 'test@example.com',
  tenantName: 'Test Tenant',
  tenantId: '00000000-0000-0000-0000-000000000000',
  userId: '00000000-0000-0000-0000-000000000001',
};

// Helper to setup mock authentication
async function setupMockAuth(page: Page) {
  // Mock localStorage with auth token
  await page.addInitScript(() => {
    localStorage.setItem('authToken', 'mock-jwt-token-for-testing');
  });

  // Mock API responses
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

test.describe('Research Assistant Frontend', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
  });

  test.describe('Page Load and Initialization', () => {
    test('should load the page successfully', async ({ page }) => {
      await page.goto('/app/research/');
      
      // Check page title
      await expect(page).toHaveTitle(/Research Assistant/);
      
      // Check main heading
      await expect(page.locator('h1')).toContainText('Research Assistant');
    });

    test('should display user information', async ({ page }) => {
      await page.goto('/app/research/');
      
      // Wait for auth check
      await page.waitForTimeout(500);
      
      // Check tenant name is displayed
      await expect(page.locator('text=Test Tenant')).toBeVisible();
      
      // Check user initials
      await expect(page.locator('text=TE')).toBeVisible(); // First 2 chars of email
    });

    test('should show welcome screen initially', async ({ page }) => {
      // Mock empty conversations list
      await page.route('**/research/conversations*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], success: true }),
        });
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Check welcome message
      await expect(page.locator('text=Welcome to Research Assistant')).toBeVisible();
      
      // Check quick-start cards
      await expect(page.locator('text=Compare Companies')).toBeVisible();
      await expect(page.locator('text=Risk Analysis')).toBeVisible();
      await expect(page.locator('text=Trend Analysis')).toBeVisible();
      await expect(page.locator('text=Deep Dive')).toBeVisible();
    });

    test('should show empty state in sidebar', async ({ page }) => {
      await page.route('**/research/conversations*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], success: true }),
        });
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      await expect(page.locator('text=No conversations yet')).toBeVisible();
    });
  });

  test.describe('Conversation Management', () => {
    test('should create new conversation', async ({ page }) => {
      let conversationCreated = false;

      await page.route('**/research/conversations*', async (route) => {
        if (route.request().method() === 'POST') {
          conversationCreated = true;
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'test-conv-id',
                title: 'Research ' + new Date().toLocaleDateString(),
                messageCount: 0,
                isPinned: false,
                isArchived: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: [], success: true }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Click "New Conversation" button
      await page.click('button:has-text("New Conversation")');
      
      // Wait for API call
      await page.waitForTimeout(500);
      
      expect(conversationCreated).toBe(true);
    });

    test('should display conversations in sidebar', async ({ page }) => {
      await page.route('**/research/conversations*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: 'conv-1',
                title: 'Test Conversation 1',
                messageCount: 5,
                isPinned: false,
                isArchived: false,
                updatedAt: new Date().toISOString(),
              },
              {
                id: 'conv-2',
                title: 'Test Conversation 2',
                messageCount: 3,
                isPinned: true,
                isArchived: false,
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
        });
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Check conversations are displayed
      await expect(page.locator('text=Test Conversation 1')).toBeVisible();
      await expect(page.locator('text=Test Conversation 2')).toBeVisible();
    });

    test('should select conversation and load messages', async ({ page }) => {
      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        
        if (url.includes('conv-1')) {
          // Get specific conversation
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                conversation: {
                  id: 'conv-1',
                  title: 'Test Conversation 1',
                },
                messages: [
                  {
                    id: 'msg-1',
                    role: 'user',
                    content: 'What is AAPL revenue?',
                    createdAt: new Date().toISOString(),
                  },
                  {
                    id: 'msg-2',
                    role: 'assistant',
                    content: 'Apple revenue for FY2024 was $385.6B.',
                    sources: [],
                    createdAt: new Date().toISOString(),
                  },
                ],
              },
            }),
          });
        } else {
          // List conversations
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [
                {
                  id: 'conv-1',
                  title: 'Test Conversation 1',
                  messageCount: 2,
                  isPinned: false,
                  isArchived: false,
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Click on conversation
      await page.click('text=Test Conversation 1');
      await page.waitForTimeout(500);
      
      // Check messages are displayed
      await expect(page.locator('text=What is AAPL revenue?')).toBeVisible();
      await expect(page.locator('text=Apple revenue for FY2024 was $385.6B.')).toBeVisible();
    });

    test('should pin conversation', async ({ page }) => {
      let pinned = false;

      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (method === 'PATCH' && url.includes('conv-1')) {
          pinned = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'conv-1',
                title: 'Test Conversation 1',
                isPinned: true,
              },
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [
                {
                  id: 'conv-1',
                  title: 'Test Conversation 1',
                  messageCount: 2,
                  isPinned: false,
                  isArchived: false,
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Click pin button
      await page.click('.fa-thumbtack');
      await page.waitForTimeout(500);
      
      expect(pinned).toBe(true);
    });

    test('should delete conversation with confirmation', async ({ page }) => {
      let deleted = false;

      // Mock window.confirm
      page.on('dialog', async (dialog) => {
        expect(dialog.message()).toContain('Delete this conversation');
        await dialog.accept();
      });

      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (method === 'DELETE' && url.includes('conv-1')) {
          deleted = true;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [
                {
                  id: 'conv-1',
                  title: 'Test Conversation 1',
                  messageCount: 2,
                  isPinned: false,
                  isArchived: false,
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Click delete button
      await page.click('.fa-trash');
      await page.waitForTimeout(500);
      
      expect(deleted).toBe(true);
    });
  });

  test.describe('Message Sending', () => {
    test('should send message via button click', async ({ page }) => {
      let messageSent = false;

      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (method === 'POST' && url.includes('/messages')) {
          messageSent = true;
          // Return streaming response
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: token\ndata: {"text":"Test"}\n\nevent: done\ndata: {"complete":true}\n\n',
          });
        } else if (method === 'POST') {
          // Create conversation
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: 'test-conv-id',
                title: 'Research ' + new Date().toLocaleDateString(),
                messageCount: 0,
              },
            }),
          });
        } else if (url.includes('test-conv-id')) {
          // Get conversation
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                conversation: { id: 'test-conv-id', title: 'Test' },
                messages: [],
              },
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
      
      // Create new conversation
      await page.click('button:has-text("New Conversation")');
      await page.waitForTimeout(500);
      
      // Type message
      await page.fill('textarea[placeholder*="Ask about"]', 'What is AAPL revenue?');
      
      // Click send button
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(500);
      
      expect(messageSent).toBe(true);
    });

    test('should send message via Enter key', async ({ page }) => {
      let messageSent = false;

      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (method === 'POST' && url.includes('/messages')) {
          messageSent = true;
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: token\ndata: {"text":"Test"}\n\nevent: done\ndata: {"complete":true}\n\n',
          });
        } else if (method === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: 'test-conv-id', title: 'Test', messageCount: 0 },
            }),
          });
        } else if (url.includes('test-conv-id')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { conversation: { id: 'test-conv-id' }, messages: [] },
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
      
      await page.click('button:has-text("New Conversation")');
      await page.waitForTimeout(500);
      
      // Type message and press Enter
      const textarea = page.locator('textarea[placeholder*="Ask about"]');
      await textarea.fill('What is AAPL revenue?');
      await textarea.press('Enter');
      await page.waitForTimeout(500);
      
      expect(messageSent).toBe(true);
    });

    test('should allow new line with Shift+Enter', async ({ page }) => {
      await page.route('**/research/conversations*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        });
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      const textarea = page.locator('textarea[placeholder*="Ask about"]');
      await textarea.fill('Line 1');
      await textarea.press('Shift+Enter');
      await textarea.type('Line 2');
      
      const value = await textarea.inputValue();
      expect(value).toContain('\n');
    });

    test('should disable send button while typing', async ({ page }) => {
      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (method === 'POST' && url.includes('/messages')) {
          // Simulate slow response
          await new Promise(resolve => setTimeout(resolve, 2000));
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"complete":true}\n\n',
          });
        } else if (method === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: 'test-conv-id', title: 'Test', messageCount: 0 },
            }),
          });
        } else if (url.includes('test-conv-id')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { conversation: { id: 'test-conv-id' }, messages: [] },
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
      
      await page.click('button:has-text("New Conversation")');
      await page.waitForTimeout(500);
      
      await page.fill('textarea[placeholder*="Ask about"]', 'Test message');
      await page.click('button:has(.fa-paper-plane)');
      
      // Check button is disabled
      const sendButton = page.locator('button:has(.fa-paper-plane)');
      await expect(sendButton).toBeDisabled();
    });
  });

  test.describe('Welcome Screen Quick Queries', () => {
    test('should trigger quick query on card click', async ({ page }) => {
      let queryTriggered = false;

      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        
        if (method === 'POST' && url.includes('/messages')) {
          const body = await route.request().postDataJSON();
          if (body.content.includes('Compare AAPL and MSFT')) {
            queryTriggered = true;
          }
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"complete":true}\n\n',
          });
        } else if (method === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: 'test-conv-id', title: 'Test', messageCount: 0 },
            }),
          });
        } else if (url.includes('test-conv-id')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { conversation: { id: 'test-conv-id' }, messages: [] },
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
      
      // Click on "Compare Companies" card
      await page.click('text=Compare AAPL and MSFT revenue growth');
      await page.waitForTimeout(1000);
      
      expect(queryTriggered).toBe(true);
    });
  });

  test.describe('Markdown Rendering', () => {
    test('should render markdown in assistant messages', async ({ page }) => {
      await page.route('**/research/conversations*', async (route) => {
        const url = route.request().url();
        
        if (url.includes('conv-1')) {
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
                    content: '**Bold text** and *italic text*\n\n- List item 1\n- List item 2',
                    createdAt: new Date().toISOString(),
                  },
                ],
              },
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: [
                {
                  id: 'conv-1',
                  title: 'Test Conversation',
                  messageCount: 1,
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
          });
        }
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      await page.click('text=Test Conversation');
      await page.waitForTimeout(500);
      
      // Check markdown is rendered
      await expect(page.locator('strong:has-text("Bold text")')).toBeVisible();
      await expect(page.locator('em:has-text("italic text")')).toBeVisible();
      await expect(page.locator('li:has-text("List item 1")')).toBeVisible();
    });
  });

  test.describe('Responsive Design', () => {
    test('should work on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

      await page.route('**/research/conversations*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        });
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Check page loads
      await expect(page.locator('h1')).toContainText('Research Assistant');
      
      // Check new conversation button is visible
      await expect(page.locator('button:has-text("New Conversation")')).toBeVisible();
    });

    test('should work on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 }); // iPad

      await page.route('**/research/conversations*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        });
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      await expect(page.locator('h1')).toContainText('Research Assistant');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle API errors gracefully', async ({ page }) => {
      page.on('dialog', async (dialog) => {
        expect(dialog.message()).toContain('Failed');
        await dialog.accept();
      });

      await page.route('**/research/conversations*', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Try to create conversation
      await page.click('button:has-text("New Conversation")');
      await page.waitForTimeout(500);
    });

    test('should handle network errors', async ({ page }) => {
      await page.route('**/research/conversations*', async (route) => {
        await route.abort('failed');
      });

      await page.goto('/app/research/');
      await page.waitForTimeout(500);
      
      // Page should still load (with error handling)
      await expect(page.locator('h1')).toContainText('Research Assistant');
    });
  });
});
