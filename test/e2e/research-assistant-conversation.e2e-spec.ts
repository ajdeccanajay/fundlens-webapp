/**
 * Playwright E2E Tests for Research Assistant Conversation Features
 * 
 * Tests the new ChatGPT-style conversation features:
 * - Conversation creation on first message
 * - Conversation memory (follow-up questions with context)
 * - Scratchpad validation (valid vs invalid messages)
 * - "New Conversation" button functionality
 * - SSE streaming behavior
 * - Authentication error handling (401 redirects)
 * 
 * These tests verify the conversation management implementation works correctly.
 */

import { test, expect, Page } from '@playwright/test';

// Test configuration
const TEST_USER = {
  email: 'test@example.com',
  tenantName: 'Test Tenant',
  tenantId: '00000000-0000-0000-0000-000000000000',
  userId: '00000000-0000-0000-0000-000000000001',
};

const TEST_DEAL = {
  ticker: 'AAPL',
  name: 'Apple Inc.',
};

// Helper to setup mock authentication
async function setupMockAuth(page: Page) {
  // Mock localStorage with auth token
  await page.addInitScript(() => {
    localStorage.setItem('fundlens_token', 'mock-jwt-token-for-testing');
    localStorage.setItem('authToken', 'mock-jwt-token-for-testing');
  });

  // Mock auth check
  await page.route('**/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEST_USER),
    });
  });
}

// Helper to setup deal data
async function setupDealData(page: Page) {
  await page.route('**/deals/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          ticker: TEST_DEAL.ticker,
          name: TEST_DEAL.name,
        },
      }),
    });
  });
}

test.describe('Research Assistant Conversation Features', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockAuth(page);
    await setupDealData(page);
  });

  test.describe('Conversation Creation', () => {
    test('should create conversation on first message', async ({ page }) => {
      let conversationCreated = false;
      let conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          conversationCreated = true;
          const body = await route.request().postDataJSON();
          
          // Verify conversation title includes ticker
          expect(body.title).toContain(TEST_DEAL.ticker);
          
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: conversationId,
                title: body.title,
                messageCount: 0,
                createdAt: new Date().toISOString(),
              },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Test response"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      // Open research assistant
      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send first message
      await page.fill('textarea[placeholder*="Ask"]', 'What is the revenue?');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Verify conversation was created
      expect(conversationCreated).toBe(true);
      
      // Verify conversation status shows active
      await expect(page.locator('text=Conversation active')).toBeVisible();
    });

    test('should not create duplicate conversations', async ({ page }) => {
      let conversationCreateCount = 0;
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          conversationCreateCount++;
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Response"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send first message
      await page.fill('textarea[placeholder*="Ask"]', 'First question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Send second message (should use same conversation)
      await page.fill('textarea[placeholder*="Ask"]', 'Second question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Verify only one conversation was created
      expect(conversationCreateCount).toBe(1);
    });
  });

  test.describe('Conversation Memory', () => {
    test('should maintain context in follow-up questions', async ({ page }) => {
      const conversationId = 'test-conv-123';
      const messages: any[] = [];

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        const url = route.request().url();
        const body = await route.request().postDataJSON();
        
        // Verify conversation ID is consistent
        expect(url).toContain(conversationId);
        
        // Store message
        messages.push(body.content);
        
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Response to: ' + body.content + '"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send first message
      await page.fill('textarea[placeholder*="Ask"]', 'What is AAPL revenue?');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Send follow-up (should use same conversation)
      await page.fill('textarea[placeholder*="Ask"]', 'How does that compare to last year?');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Verify both messages were sent to same conversation
      expect(messages.length).toBe(2);
      expect(messages[0]).toContain('revenue');
      expect(messages[1]).toContain('compare');
    });

    test('should show conversation status indicator', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Response"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Initially should show "New conversation will start"
      await expect(page.locator('text=New conversation will start')).toBeVisible();
      await expect(page.locator('text=Conversation active')).not.toBeVisible();

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Should now show "Conversation active"
      await expect(page.locator('text=Conversation active')).toBeVisible();
      await expect(page.locator('text=New conversation will start')).not.toBeVisible();
    });
  });

  test.describe('New Conversation Button', () => {
    test('should clear conversation and start fresh', async ({ page }) => {
      let conversationCreateCount = 0;
      const conversationIds = ['conv-1', 'conv-2'];

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          const id = conversationIds[conversationCreateCount];
          conversationCreateCount++;
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Response"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send first message
      await page.fill('textarea[placeholder*="Ask"]', 'First question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Verify conversation is active
      await expect(page.locator('text=Conversation active')).toBeVisible();

      // Click "New Conversation" button
      await page.click('button:has-text("New Conversation")');
      await page.waitForTimeout(500);

      // Verify conversation status reset
      await expect(page.locator('text=New conversation will start')).toBeVisible();

      // Send new message (should create new conversation)
      await page.fill('textarea[placeholder*="Ask"]', 'Second question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Verify two conversations were created
      expect(conversationCreateCount).toBe(2);
    });

    test('should clear message history', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Test response"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Verify messages are displayed
      await expect(page.locator('text=Test question')).toBeVisible();
      await expect(page.locator('text=Test response')).toBeVisible();

      // Click "New Conversation"
      await page.click('button:has-text("New Conversation")');
      await page.waitForTimeout(500);

      // Verify messages are cleared
      await expect(page.locator('text=Test question')).not.toBeVisible();
      await expect(page.locator('text=Test response')).not.toBeVisible();
    });
  });

  test.describe('Scratchpad Validation', () => {
    test('should enable save button for valid assistant messages', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Apple revenue for FY2024 was $385.6B, representing strong growth in services."}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'What is AAPL revenue?');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Find save button for assistant message
      const saveButton = page.locator('button:has-text("Save")').last();
      
      // Verify save button is enabled (not disabled)
      await expect(saveButton).not.toBeDisabled();
      await expect(saveButton).not.toHaveClass(/opacity-50/);
    });

    test('should disable save button for error messages', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        // Simulate error response
        await route.abort('failed');
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Error message should be displayed
      await expect(page.locator('text=Sorry, I encountered an error')).toBeVisible();

      // Find save button for error message
      const saveButton = page.locator('button:has-text("Save")').last();
      
      // Verify save button is disabled
      await expect(saveButton).toBeDisabled();
      await expect(saveButton).toHaveClass(/opacity-50/);
      
      // Verify invalid response hint is shown
      await expect(page.locator('text=(Invalid response)')).toBeVisible();
    });

    test('should disable save button for short responses', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Short"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Find save button
      const saveButton = page.locator('button:has-text("Save")').last();
      
      // Verify save button is disabled (response too short)
      await expect(saveButton).toBeDisabled();
    });

    test('should not disable save button for user messages', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Response"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'What is AAPL revenue?');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // User messages should not have save buttons
      const userMessage = page.locator('text=What is AAPL revenue?').locator('..');
      await expect(userMessage.locator('button:has-text("Save")')).not.toBeVisible();
    });
  });

  test.describe('SSE Streaming', () => {
    test('should display typing indicator during streaming', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        // Simulate slow streaming
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Test"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      
      // Typing indicator should be visible immediately
      await expect(page.locator('.typing-indicator')).toBeVisible({ timeout: 500 });
      
      // Wait for response
      await page.waitForTimeout(1500);
      
      // Typing indicator should be hidden after completion
      await expect(page.locator('.typing-indicator')).not.toBeVisible();
    });

    test('should stream text incrementally', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Apple "}\n\ndata: {"text":"revenue "}\n\ndata: {"text":"was "}\n\ndata: {"text":"$385.6B"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'What is AAPL revenue?');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Verify complete response is displayed
      await expect(page.locator('text=Apple revenue was $385.6B')).toBeVisible();
    });

    test('should display sources when provided', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Test response"}\n\ndata: {"title":"AAPL 10-K 2024","url":"https://example.com/doc"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Verify sources are displayed
      await expect(page.locator('text=Sources:')).toBeVisible();
      await expect(page.locator('text=AAPL 10-K 2024')).toBeVisible();
    });
  });

  test.describe('Authentication Error Handling', () => {
    test('should redirect to login on 401 during conversation creation', async ({ page }) => {
      let redirected = false;

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Unauthorized' }),
          });
        }
      });

      // Intercept navigation
      page.on('framenavigated', (frame) => {
        if (frame.url().includes('/login.html')) {
          redirected = true;
        }
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message (should trigger 401)
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Verify redirect to login
      expect(redirected).toBe(true);
    });

    test('should redirect to login on 401 during message send', async ({ page }) => {
      let redirected = false;
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Unauthorized' }),
        });
      });

      // Intercept navigation
      page.on('framenavigated', (frame) => {
        if (frame.url().includes('/login.html')) {
          redirected = true;
        }
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message (should trigger 401)
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Verify redirect to login
      expect(redirected).toBe(true);
    });

    test('should clear auth tokens on 401', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Unauthorized' }),
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      // Verify tokens exist
      const tokenBefore = await page.evaluate(() => localStorage.getItem('fundlens_token'));
      expect(tokenBefore).toBeTruthy();

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message (should trigger 401)
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Verify tokens are cleared
      const tokenAfter = await page.evaluate(() => localStorage.getItem('fundlens_token'));
      expect(tokenAfter).toBeNull();
    });
  });

  test.describe('Comprehensive Financial Analysis Page', () => {
    test('should work in comprehensive-financial-analysis.html', async ({ page }) => {
      let conversationCreated = false;
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          conversationCreated = true;
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"text":"Test response from comprehensive page"}\n\ndata: {"complete":true}\n\n',
        });
      });

      await page.goto(`/comprehensive-financial-analysis.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      // Open research assistant
      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Verify conversation was created
      expect(conversationCreated).toBe(true);

      // Verify response is displayed
      await expect(page.locator('text=Test response from comprehensive page')).toBeVisible();

      // Verify conversation status
      await expect(page.locator('text=Conversation active')).toBeVisible();
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle empty response gracefully', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"complete":true}\n\n',
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Should show fallback message
      await expect(page.locator('text=No response received')).toBeVisible();
    });

    test('should handle network errors gracefully', async ({ page }) => {
      const conversationId = 'test-conv-123';

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        await route.abort('failed');
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send message
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1500);

      // Should show error message
      await expect(page.locator('text=Sorry, I encountered an error')).toBeVisible();
    });

    test('should handle rapid message sending', async ({ page }) => {
      const conversationId = 'test-conv-123';
      let messageCount = 0;

      await page.route('**/research/conversations', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { id: conversationId, title: 'Test', messageCount: 0 },
            }),
          });
        }
      });

      await page.route('**/research/conversations/*/messages', async (route) => {
        messageCount++;
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: {"text":"Response ${messageCount}"}\n\ndata: {"complete":true}\n\n`,
        });
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Send first message
      await page.fill('textarea[placeholder*="Ask"]', 'Question 1');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(500);

      // Send second message quickly
      await page.fill('textarea[placeholder*="Ask"]', 'Question 2');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(500);

      // Send third message quickly
      await page.fill('textarea[placeholder*="Ask"]', 'Question 3');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(2000);

      // All messages should be sent
      expect(messageCount).toBe(3);

      // All responses should be displayed
      await expect(page.locator('text=Response 1')).toBeVisible();
      await expect(page.locator('text=Response 2')).toBeVisible();
      await expect(page.locator('text=Response 3')).toBeVisible();
    });

    test('should handle missing auth token', async ({ page }) => {
      let redirected = false;

      // Don't setup mock auth (no token)
      await page.addInitScript(() => {
        localStorage.removeItem('fundlens_token');
        localStorage.removeItem('authToken');
      });

      // Intercept navigation
      page.on('framenavigated', (frame) => {
        if (frame.url().includes('/login.html')) {
          redirected = true;
        }
      });

      await page.goto(`/app/deals/workspace.html?ticker=${TEST_DEAL.ticker}`);
      await page.waitForTimeout(1000);

      await page.click('button:has-text("Research Assistant")');
      await page.waitForTimeout(500);

      // Try to send message (should redirect)
      await page.fill('textarea[placeholder*="Ask"]', 'Test question');
      await page.click('button:has(.fa-paper-plane)');
      await page.waitForTimeout(1000);

      // Verify redirect to login
      expect(redirected).toBe(true);
    });
  });
});
