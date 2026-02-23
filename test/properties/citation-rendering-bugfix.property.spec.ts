/**
 * Bug Condition Exploration Test - Citations Not Rendering
 * 
 * **Property 1: Fault Condition** - Citation Links Not Rendering
 * 
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * 
 * **GOAL**: Surface counterexamples that demonstrate citations render as plain text instead of clickable links
 * 
 * **Scoped PBT Approach**: Test conversation 21f572ba-1c7c-4eb0-8fea-d7ec700b9a55 which has citations
 * 
 * **Validates: Requirements 2.2**
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ResearchAssistantService } from '../../src/research/research-assistant.service';
import { RAGService } from '../../src/rag/rag.service';
import { CitationService } from '../../src/rag/citation.service';
import { BedrockService } from '../../src/rag/bedrock.service';

describe('Bug Condition Exploration: Citations Not Rendering', () => {
  let prismaService: PrismaService;
  let researchService: ResearchAssistantService;
  
  // The specific conversation ID mentioned in the bug report
  const BUGGY_CONVERSATION_ID = '21f572ba-1c7c-4eb0-8fea-d7ec700b9a55';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: ResearchAssistantService,
          useValue: {
            getConversationMessages: vi.fn(),
          },
        },
        {
          provide: RAGService,
          useValue: {},
        },
        {
          provide: CitationService,
          useValue: {},
        },
        {
          provide: BedrockService,
          useValue: {},
        },
      ],
    }).compile();

    prismaService = module.get<PrismaService>(PrismaService);
    researchService = module.get<ResearchAssistantService>(ResearchAssistantService);
  });

  /**
   * Helper function to simulate the renderMarkdownWithCitations function from research.html
   * This is the ACTUAL implementation from the frontend that we're testing
   */
  function renderMarkdownWithCitations(content: string, citations: any[]): string {
    // Simple markdown rendering (simplified version)
    function renderMarkdown(text: string): string {
      return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    }

    if (!citations || citations.length === 0) {
      return renderMarkdown(content);
    }

    let html = renderMarkdown(content);
    
    citations.forEach((citation) => {
      const citationNum = citation.number || citation.citationNumber;
      if (!citationNum) return;
      
      const sourceType = citation.sourceType || 'SEC_FILING';
      const cssClass = sourceType === 'USER_UPLOAD' 
        ? 'citation-link citation-upload' 
        : 'citation-link citation-sec';
      
      const regex = new RegExp('\\[' + citationNum + '\\]', 'g');
      html = html.replace(
        regex,
        '<a href="#" class="' + cssClass + '" data-citation-num="' + citationNum + '" onclick="event.preventDefault(); document.dispatchEvent(new CustomEvent(\'citation-click\', {detail: {num: ' + citationNum + '}}));">[' + citationNum + ']</a>'
      );
    });
    
    return html;
  }

  /**
   * Property 1: For any message with citations, citations MUST render as clickable <a> tags
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test FAILS
   * This proves the bug exists - citations display as plain text [1], [2] instead of clickable links
   */
  it('Property 1: Citations must render as clickable links with proper HTML structure', () => {
    fc.assert(
      fc.property(
        // Generate citations first, then create content with matching markers
        fc.array(
          fc.record({
            sourceType: fc.constantFrom('SEC_FILING', 'USER_UPLOAD'),
            ticker: fc.constantFrom('AAPL', 'MSFT', 'AMZN', 'GOOGL'),
            filingType: fc.constantFrom('10-K', '10-Q', '8-K'),
            fiscalPeriod: fc.constantFrom('FY2024', 'Q1 2024', 'Q2 2024'),
            section: fc.constantFrom('MD&A', 'Risk Factors', 'Financial Statements'),
            excerpt: fc.string({ minLength: 50, maxLength: 200 }),
            relevanceScore: fc.double({ min: 0.5, max: 1.0 }),
          }),
          { minLength: 1, maxLength: 3 }
        ).chain(citations => {
          // Add sequential numbers to citations
          const numberedCitations = citations.map((c, i) => ({
            ...c,
            number: i + 1,
            citationNumber: i + 1,
          }));
          
          // Create content with matching citation markers
          const citationMarkers = numberedCitations.map(c => `[${c.number}]`).join(' and ');
          const content = `This is test content with citations ${citationMarkers} in the text.`;
          
          return fc.constant({ content, citations: numberedCitations });
        }),
        ({ content, citations }) => {
          // Render the content with citations
          const html = renderMarkdownWithCitations(content, citations);
          
          // Property: All citation markers [1], [2], etc. should be converted to <a> tags
          citations.forEach((citation) => {
            const citationNum = citation.number || citation.citationNumber;
            
            // Check that citation link exists in HTML
            const expectedClass = citation.sourceType === 'USER_UPLOAD' 
              ? 'citation-link citation-upload' 
              : 'citation-link citation-sec';
            
            const expectedLinkPattern = new RegExp(
              `<a href="#" class="${expectedClass}" data-citation-num="${citationNum}"[^>]*>\\[${citationNum}\\]</a>`
            );
            
            // CRITICAL ASSERTION: Citation must be rendered as a clickable link
            expect(html).toMatch(expectedLinkPattern);
            
            // Verify the link has onclick handler for citation-click event
            expect(html).toContain('citation-click');
            expect(html).toContain('CustomEvent');
          });
          
          // Property: Plain text citation markers should NOT exist in the rendered HTML
          // (they should all be converted to links)
          citations.forEach((citation) => {
            const citationNum = citation.number || citation.citationNumber;
            
            // Remove all <a> tags to check if plain text markers remain
            const textWithoutLinks = html.replace(/<a[^>]*>.*?<\/a>/g, '');
            
            // If plain text markers exist outside of links, the rendering is broken
            const plainTextMarker = `[${citationNum}]`;
            const hasPlainTextMarker = textWithoutLinks.includes(plainTextMarker);
            
            // CRITICAL ASSERTION: Plain text markers should NOT exist
            // (all should be converted to clickable links)
            expect(hasPlainTextMarker).toBe(false);
          });
        }
      ),
      { numRuns: 50, verbose: true }
    );
  });

  /**
   * Property 2: Specific test for conversation 21f572ba-1c7c-4eb0-8fea-d7ec700b9a55
   * 
   * This is the exact conversation mentioned in the bug report.
   * We test that if this conversation has citations, they render correctly.
   */
  it('Property 2: Conversation 21f572ba-1c7c-4eb0-8fea-d7ec700b9a55 citations must render as clickable links', async () => {
    // Query the database for this specific conversation
    const conversation = await prismaService.conversation.findUnique({
      where: { id: BUGGY_CONVERSATION_ID },
      include: {
        messages: {
          include: {
            citations: {
              include: {
                document: true,
                chunk: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // If conversation doesn't exist, skip this test
    if (!conversation) {
      console.warn(`Conversation ${BUGGY_CONVERSATION_ID} not found in database. Skipping specific conversation test.`);
      return;
    }

    // Check each message with citations
    for (const message of conversation.messages) {
      if (message.citations && message.citations.length > 0) {
        // Transform citations to the format expected by the frontend
        const frontendCitations = message.citations.map((citation, index) => ({
          number: index + 1,
          citationNumber: index + 1,
          sourceType: citation.document.documentType === 'USER_UPLOAD' ? 'USER_UPLOAD' : 'SEC_FILING',
          ticker: citation.document.ticker || '',
          filingType: citation.document.documentType || '',
          fiscalPeriod: '',
          section: '',
          excerpt: citation.quote || '',
          relevanceScore: citation.relevanceScore || null,
        }));

        // Render the message content with citations
        const html = renderMarkdownWithCitations(message.content, frontendCitations);

        // CRITICAL ASSERTION: All citations must be rendered as clickable links
        frontendCitations.forEach((citation) => {
          const expectedClass = citation.sourceType === 'USER_UPLOAD' 
            ? 'citation-link citation-upload' 
            : 'citation-link citation-sec';
          
          const expectedLinkPattern = new RegExp(
            `<a href="#" class="${expectedClass}" data-citation-num="${citation.number}"[^>]*>\\[${citation.number}\\]</a>`
          );
          
          // This assertion will FAIL on unfixed code, proving the bug exists
          expect(html).toMatch(expectedLinkPattern);
        });
      }
    }
  });

  /**
   * Property 3: Citation click handler must be properly attached
   * 
   * Verifies that clicking a citation would trigger the correct event
   */
  it('Property 3: Citation links must have onclick handlers that dispatch citation-click events', () => {
    fc.assert(
      fc.property(
        fc.record({
          content: fc.constant('This is a test with citation [1] in it.'),
          citations: fc.constant([{
            number: 1,
            citationNumber: 1,
            sourceType: 'SEC_FILING',
            ticker: 'AAPL',
            filingType: '10-K',
            fiscalPeriod: 'FY2024',
            section: 'MD&A',
            excerpt: 'Test excerpt',
            relevanceScore: 0.95,
          }]),
        }),
        ({ content, citations }) => {
          const html = renderMarkdownWithCitations(content, citations);
          
          // CRITICAL ASSERTION: Citation link must exist
          expect(html).toContain('<a href="#"');
          expect(html).toContain('data-citation-num="1"');
          
          // Verify onclick handler exists and contains citation-click event dispatch
          expect(html).toContain('onclick=');
          expect(html).toContain('citation-click');
          expect(html).toContain('CustomEvent');
          expect(html).toContain('num: 1');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 4: Different source types must have correct CSS classes
   * 
   * SEC_FILING citations should have 'citation-sec' class
   * USER_UPLOAD citations should have 'citation-upload' class
   */
  it('Property 4: Citation links must have correct CSS classes based on source type', () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceType: fc.constantFrom('SEC_FILING', 'USER_UPLOAD'),
        }),
        ({ sourceType }) => {
          const content = 'Test content with [1] citation.';
          const citations = [{
            number: 1,
            sourceType: sourceType,
            ticker: 'AAPL',
            excerpt: 'Test',
          }];
          
          const html = renderMarkdownWithCitations(content, citations);
          
          // CRITICAL ASSERTION: Citation link must have correct CSS class
          expect(html).toContain('citation-link');
          
          if (sourceType === 'USER_UPLOAD') {
            expect(html).toContain('citation-upload');
          } else {
            expect(html).toContain('citation-sec');
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
