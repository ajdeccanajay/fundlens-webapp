import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Deals Workspace - Chat & Export Functionality
 * 
 * Tests:
 * 1. Chat functionality with SSE streaming
 * 2. Export wizard flow with year selection
 * 3. Export data download
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_TICKER = 'AAPL';

// Mock JWT token for testing
function generateMockToken() {
  const base64url = (str: string) => {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'test@fundlens.ai',
    email_verified: true,
    'custom:tenant_id': '00000000-0000-0000-0000-000000000000',
    'custom:tenant_slug': 'default',
    'custom:tenant_role': 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
    iss: 'fundlens-test'
  }));
  const signature = 'test-signature';

  return `${header}.${payload}.${signature}`;
}

test.describe('Workspace Chat & Export E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cache and storage
    await page.context().clearCookies();
    
    // Set up authentication
    const mockToken = generateMockToken();
    await page.addInitScript((token) => {
      localStorage.clear();
      localStorage.setItem('fundlens_token', token);
      localStorage.setItem('fundlens_user', JSON.stringify({
        email: 'test@fundlens.ai',
        tenantId: '00000000-0000-0000-0000-000000000000',
        tenantSlug: 'default',
        tenantName: 'Default Tenant',
        role: 'admin'
      }));
    }, mockToken);

    // Navigate to workspace with cache busting
    await page.goto(`${BASE_URL}/app/deals/workspace.html?ticker=${TEST_TICKER}&_t=${Date.now()}`, {
      waitUntil: 'networkidle'
    });
    
    // Wait for Alpine.js to initialize
    await page.waitForTimeout(2000);
  });

  test('should display correct ticker in header', async ({ page }) => {
    // Check header displays ticker correctly (not "undefined - undefined")
    const header = page.locator('h1.text-lg.font-bold');
    await expect(header).toBeVisible();
    
    const headerText = await header.textContent();
    console.log('Header text:', headerText);
    
    // Should contain ticker
    expect(headerText).toContain(TEST_TICKER);
    
    // Should NOT contain "undefined"
    expect(headerText).not.toContain('undefined');
  });

  test('should switch to research view and display chat interface', async ({ page }) => {
    // Click Research nav item
    await page.click('.nav-item:has-text("Research")');
    await page.waitForTimeout(500);

    // Verify research view is active
    const researchNav = page.locator('.nav-item', { hasText: 'Research' });
    await expect(researchNav).toHaveClass(/active/);

    // Check chat interface elements
    await expect(page.locator('text=Research Assistant')).toBeVisible();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('button:has-text("Send")')).toBeVisible();
  });

  test('should send chat message and receive SSE response', async ({ page }) => {
    // Switch to research view
    await page.click('text=Research');
    await page.waitForTimeout(500);

    // Type a message
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await chatInput.fill('What is the revenue for AAPL?');

    // Click send button
    await page.click('button:has-text("Send")');

    // Wait for typing indicator
    await expect(page.locator('.typing-indicator')).toBeVisible({ timeout: 5000 });

    // Wait for response message (SSE streaming)
    await expect(page.locator('.message-assistant')).toBeVisible({ timeout: 30000 });

    // Verify message was added to chat
    const messages = page.locator('.message-assistant');
    const messageCount = await messages.count();
    expect(messageCount).toBeGreaterThan(0);

    // Verify typing indicator is gone
    await expect(page.locator('.typing-indicator')).not.toBeVisible();

    // Verify input is cleared
    await expect(chatInput).toHaveValue('');
  });

  test('should handle chat errors gracefully', async ({ page }) => {
    // Switch to research view
    await page.click('text=Research');
    await page.waitForTimeout(500);

    // Mock a network error by intercepting the request
    await page.route('**/api/research/chat/stream', (route) => {
      route.abort('failed');
    });

    // Type a message
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await chatInput.fill('Test error handling');

    // Click send button
    await page.click('button:has-text("Send")');

    // Wait for error message
    await expect(page.locator('text=Failed to send message')).toBeVisible({ timeout: 5000 });
  });

  test('should switch to export tab and load available periods', async ({ page }) => {
    // Wait for initial data load
    await page.waitForTimeout(2000);

    // Click Export tab
    await page.click('button:has-text("Export")');
    await page.waitForTimeout(1000);

    // Verify export wizard is visible
    await expect(page.locator('text=Export Financial Data')).toBeVisible();

    // Check that years are loaded (not empty)
    const yearButtons = page.locator('button:has-text("FY")');
    const yearCount = await yearButtons.count();
    
    console.log('Available years:', yearCount);
    expect(yearCount).toBeGreaterThan(0);
  });

  test('should complete export wizard flow', async ({ page }) => {
    // Wait for initial data load
    await page.waitForTimeout(2000);

    // Click Export tab
    await page.click('button:has-text("Export")');
    await page.waitForTimeout(1000);

    // Step 1: Select filing type (Annual)
    await page.click('button:has-text("Annual (10-K)")');
    await page.waitForTimeout(500);

    // Step 2: Select years
    const yearButtons = page.locator('button:has-text("FY")');
    const firstYear = yearButtons.first();
    await firstYear.click();
    await page.waitForTimeout(300);

    // Click Next
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(500);

    // Step 3: Select statements (all should be selected by default)
    await expect(page.locator('text=Income Statement')).toBeVisible();
    await expect(page.locator('text=Balance Sheet')).toBeVisible();
    await expect(page.locator('text=Cash Flow')).toBeVisible();

    // Click Next
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(500);

    // Step 4: Review and export
    await expect(page.locator('text=Review & Export')).toBeVisible();
    
    // Verify summary shows selected options
    await expect(page.locator('text=Annual')).toBeVisible();
    await expect(page.locator('text=FY')).toBeVisible();
  });

  test('should download export file', async ({ page }) => {
    // Wait for initial data load
    await page.waitForTimeout(2000);

    // Click Export tab
    await page.click('button:has-text("Export")');
    await page.waitForTimeout(1000);

    // Complete wizard steps
    await page.click('button:has-text("Annual (10-K)")');
    await page.waitForTimeout(500);

    const yearButtons = page.locator('button:has-text("FY")');
    await yearButtons.first().click();
    await page.waitForTimeout(300);

    await page.click('button:has-text("Next")');
    await page.waitForTimeout(500);

    await page.click('button:has-text("Next")');
    await page.waitForTimeout(500);

    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

    // Click Export button
    await page.click('button:has-text("Export to Excel")');

    // Wait for download
    const download = await downloadPromise;
    
    // Verify download
    expect(download.suggestedFilename()).toContain(TEST_TICKER);
    expect(download.suggestedFilename()).toContain('.xlsx');

    console.log('Downloaded file:', download.suggestedFilename());
  });

  test('should handle export errors gracefully', async ({ page }) => {
    // Wait for initial data load
    await page.waitForTimeout(2000);

    // Click Export tab
    await page.click('button:has-text("Export")');
    await page.waitForTimeout(1000);

    // Mock export API error
    await page.route('**/api/deals/export/**', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ message: 'Export failed' })
      });
    });

    // Complete wizard steps
    await page.click('button:has-text("Annual (10-K)")');
    await page.waitForTimeout(500);

    const yearButtons = page.locator('button:has-text("FY")');
    await yearButtons.first().click();
    await page.waitForTimeout(300);

    await page.click('button:has-text("Next")');
    await page.waitForTimeout(500);

    await page.click('button:has-text("Next")');
    await page.waitForTimeout(500);

    // Click Export button
    await page.click('button:has-text("Export to Excel")');

    // Wait for error message
    await expect(page.locator('text=Export failed')).toBeVisible({ timeout: 5000 });
  });

  test('should persist conversation across view switches', async ({ page }) => {
    // Switch to research view
    await page.click('text=Research');
    await page.waitForTimeout(500);

    // Send a message
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await chatInput.fill('Test message');
    await page.click('button:has-text("Send")');

    // Wait for response
    await expect(page.locator('.message-assistant')).toBeVisible({ timeout: 30000 });

    // Switch to another view
    await page.click('text=Analysis');
    await page.waitForTimeout(500);

    // Switch back to research
    await page.click('text=Research');
    await page.waitForTimeout(500);

    // Verify messages are still there
    await expect(page.locator('.message-user')).toBeVisible();
    await expect(page.locator('.message-assistant')).toBeVisible();
  });

  test('should show scratchpad count badge', async ({ page }) => {
    // Switch to research view
    await page.click('text=Research');
    await page.waitForTimeout(500);

    // Send a message and wait for response
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await chatInput.fill('What is AAPL revenue?');
    await page.click('button:has-text("Send")');
    await expect(page.locator('.message-assistant')).toBeVisible({ timeout: 30000 });

    // Add to scratchpad (if button exists)
    const addToScratchpadBtn = page.locator('button:has-text("Add to Scratchpad")').first();
    if (await addToScratchpadBtn.isVisible()) {
      await addToScratchpadBtn.click();
      await page.waitForTimeout(500);

      // Check scratchpad badge
      const badge = page.locator('.nav-item:has-text("Scratchpad") .badge');
      await expect(badge).toBeVisible();
      
      const badgeText = await badge.textContent();
      expect(parseInt(badgeText || '0')).toBeGreaterThan(0);
    }
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    // Test Cmd+1 for Analysis
    await page.keyboard.press('Meta+1');
    await page.waitForTimeout(300);
    await expect(page.locator('.nav-item:has-text("Analysis")')).toHaveClass(/active/);

    // Test Cmd+2 for Research
    await page.keyboard.press('Meta+2');
    await page.waitForTimeout(300);
    await expect(page.locator('.nav-item:has-text("Research")')).toHaveClass(/active/);

    // Test Cmd+3 for Scratchpad
    await page.keyboard.press('Meta+3');
    await page.waitForTimeout(300);
    await expect(page.locator('.nav-item:has-text("Scratchpad")')).toHaveClass(/active/);
  });
});
