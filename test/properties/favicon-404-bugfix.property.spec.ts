/**
 * Property-Based Test for Favicon 404 Error (Bug Exploration)
 *
 * Feature: research-assistant-rendering-fix, Property 1: Fault Condition - Missing Favicon Configuration
 *
 * **Validates: Requirements 2.7**
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * NOTE: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * GOAL: Surface counterexamples that demonstrate browser generates 404 error for favicon
 */

import * as fc from 'fast-check';
import { chromium, Browser, Page, Request } from 'playwright';

describe('Property Test - Favicon 404 Error (Bug Exploration)', () => {
  let browser: Browser;
  let page: Page;
  const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  /**
   * Property 1: No 404 errors SHALL appear in console for favicon.ico
   *
   * For any page load event where research.html is loaded,
   * the browser SHALL NOT generate a 404 error for favicon.ico,
   * either by serving a valid favicon file or by specifying a favicon link in the HTML head.
   *
   * EXPECTED OUTCOME ON UNFIXED CODE: Test FAILS
   * - Browser requests /favicon.ico
   * - Server returns 404 Not Found
   * - Console shows 404 error for favicon.ico
   *
   * This confirms the bug exists: HTML head does not include <link rel="icon"> tag
   * and no favicon.ico file exists in the public directory
   */
  it('Property 1: No 404 errors for favicon on page load', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const failedRequests: { url: string; status: number }[] = [];
        const allRequests: { url: string; status: number }[] = [];
        
        // Capture all requests
        page.on('request', (request: Request) => {
          if (request.url().includes('favicon')) {
            console.log('Favicon request detected:', request.url());
          }
        });

        // Capture failed network requests
        page.on('requestfailed', (request: Request) => {
          failedRequests.push({
            url: request.url(),
            status: 0, // Request failed before getting a response
          });
        });

        // Capture all responses
        page.on('response', (response) => {
          allRequests.push({
            url: response.url(),
            status: response.status(),
          });
          
          if (response.status() === 404) {
            failedRequests.push({
              url: response.url(),
              status: response.status(),
            });
          }
        });

        // Load research.html page
        const response = await page.goto(`${BASE_URL}/app/deals/research.html`, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });

        // Check that page loaded successfully
        expect(response?.status()).toBe(200);

        // Wait for all network requests to complete
        await page.waitForTimeout(2000);

        // Debug: Log all failed requests
        console.log('All failed requests:', failedRequests);
        
        // Debug: Check if any favicon requests were made
        const faviconRequests = allRequests.filter(req => req.url.includes('favicon'));
        console.log('All favicon requests:', faviconRequests);

        // Property 1: No 404 errors for favicon.ico
        const faviconErrors = failedRequests.filter(
          (req) => req.url.includes('favicon.ico') && req.status === 404
        );
        
        // Log favicon errors for debugging
        if (faviconErrors.length > 0) {
          console.log('Found favicon 404 errors:', faviconErrors);
        } else {
          console.log('No favicon 404 errors found');
        }
        
        expect(faviconErrors.length).toBe(0);

        // Property 2: Either favicon.ico exists OR a favicon link is specified in HTML
        const hasFaviconLink = await page.evaluate(() => {
          const faviconLink = document.querySelector('link[rel="icon"]') ||
                             document.querySelector('link[rel="shortcut icon"]');
          return faviconLink !== null;
        });

        const faviconIcoExists = !failedRequests.some(
          (req) => req.url.includes('favicon.ico')
        );

        // At least one of these should be true
        const hasFavicon = hasFaviconLink || faviconIcoExists;
        
        if (!hasFavicon) {
          console.log('No favicon link in HTML and no favicon.ico file found');
        }
        
        expect(hasFavicon).toBe(true);

        // Property 3: If favicon link exists, it should point to a valid resource
        if (hasFaviconLink) {
          const faviconUrl = await page.evaluate(() => {
            const faviconLink = document.querySelector('link[rel="icon"]') ||
                               document.querySelector('link[rel="shortcut icon"]');
            return faviconLink?.getAttribute('href') || '';
          });

          if (faviconUrl) {
            const faviconFailed = failedRequests.some(
              (req) => req.url.includes(faviconUrl) && req.status === 404
            );
            
            if (faviconFailed) {
              console.log(`Favicon link points to non-existent resource: ${faviconUrl}`);
            }
            
            expect(faviconFailed).toBe(false);
          }
        }
      }),
      {
        numRuns: 1, // Run once - this is a deterministic bug
        verbose: true,
      }
    );
  }, 60000); // 60 second timeout for browser operations

  /**
   * Counterexample Documentation:
   *
   * EXPECTED FAILURE ON UNFIXED CODE:
   * - Browser automatically requests /favicon.ico when no <link rel="icon"> is specified
   * - Server returns 404 Not Found for /favicon.ico
   * - Console shows: "GET http://localhost:3000/favicon.ico 404 (Not Found)"
   * - Root cause: HTML head section does not include <link rel="icon"> tag
   * - Root cause: No favicon.ico file exists in public directory
   *
   * EXPECTED SUCCESS AFTER FIX:
   * - No 404 errors in console for favicon
   * - Either:
   *   A) HTML head includes <link rel="icon" href="/fundlens-logo.png" type="image/png">
   *   B) favicon.ico file exists in public directory and is served successfully
   * - Browser displays favicon in tab
   */
});
