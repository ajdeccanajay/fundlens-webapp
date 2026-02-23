/**
 * Deal Management Service
 * 
 * Handles CRUD operations for financial analysis deals/projects.
 * Implements complete tenant isolation - all operations are scoped to the current tenant.
 * 
 * SECURITY: This service enforces tenant isolation at every operation:
 * - createDeal: Associates deal with current tenant from TenantContext
 * - getAllDeals: Returns only deals belonging to current tenant (or all for platform admin)
 * - getDealById: Returns 404 for deals not owned by current tenant (unless platform admin)
 * - updateDeal: Verifies tenant ownership before update
 * - deleteDeal: Verifies tenant ownership before deletion
 * 
 * PLATFORM ADMIN: Users in the default tenant (00000000-0000-0000-0000-000000000000)
 * with admin role can view ALL tenant deals but can only modify their own tenant's deals.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { 
  Injectable, 
  Logger, 
  NotFoundException, 
  BadRequestException,
  Inject,
  Scope,
  Optional,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext, TENANT_CONTEXT_KEY, DEFAULT_TENANT_ID } from '../tenant/tenant-context';

export interface CreateDealDto {
  name: string;
  description?: string;
  dealType: 'public' | 'private';
  ticker?: string;
  companyName?: string;
  years?: number;
  status?: 'draft' | 'processing' | 'ready' | 'error' | 'in-progress' | 'review' | 'closed';
}

export interface UpdateDealDto {
  name?: string;
  description?: string;
  ticker?: string;
  companyName?: string;
  years?: number;
  status?: 'draft' | 'processing' | 'ready' | 'error' | 'in-progress' | 'review' | 'closed';
}

export interface DealWithSession {
  id: string;
  name: string;
  description: string;
  dealType: string;
  ticker: string;
  companyName: string;
  years: number;
  status: string;
  processingMessage?: string;
  newsData?: any;
  createdAt: Date;
  updatedAt: Date;
  currentSession?: {
    id: string;
    systemPrompt: string;
    messageCount: number;
  };
  scratchPad?: {
    id: string;
    content: string;
    autoSavedAt: Date;
  };
}

/**
 * Deal Management Service with Tenant Isolation
 * 
 * This service is request-scoped to ensure tenant context is properly isolated
 * for each request. All database operations are filtered by tenant_id.
 */
@Injectable({ scope: Scope.REQUEST })
export class DealService {
  private readonly logger = new Logger(DealService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REQUEST) private readonly request?: Request,
  ) {}

  /**
   * Get the current tenant context from the request
   * Returns null if no tenant context (for backward compatibility during migration)
   */
  private getTenantContext(): TenantContext | null {
    if (!this.request) {
      return null;
    }
    return (this.request as any)[TENANT_CONTEXT_KEY] || null;
  }

  /**
   * Get the current tenant ID
   * Falls back to default tenant for backward compatibility
   */
  private getTenantId(): string {
    const context = this.getTenantContext();
    if (context) {
      return context.tenantId;
    }
    // Fallback for routes without TenantGuard (backward compatibility)
    // This should be removed once all routes are protected
    this.logger.warn('No tenant context found - using default tenant. This should not happen in production.');
    return DEFAULT_TENANT_ID;
  }

  /**
   * Check if the current user is a platform admin
   * Platform admins can view all tenant data but can only modify their own tenant's data
   */
  private isPlatformAdmin(): boolean {
    const context = this.getTenantContext();
    return context?.isPlatformAdmin === true;
  }

  /**
   * Create a new deal with comprehensive data processing
   * 
   * SECURITY: Deal is automatically associated with the current tenant.
   * The tenant_id is injected from TenantContext, not from user input.
   * 
   * Requirements: 2.1 - Deal tenant association
   */
  async createDeal(createDealDto: CreateDealDto): Promise<DealWithSession> {
    const tenantId = this.getTenantId();
    this.logger.log(`Creating new deal: ${createDealDto.name} for tenant: ${tenantId}`);

    // Validate ticker for public companies
    if (createDealDto.dealType === 'public' && !createDealDto.ticker) {
      throw new BadRequestException('Ticker is required for public company deals');
    }

    // REMOVED: Ticker validation - allow creating deals with new tickers
    // Users will trigger SEC pipeline manually after deal creation
    // if (createDealDto.dealType === 'public' && createDealDto.ticker) {
    //   await this.validateTickerExists(createDealDto.ticker);
    // }

    // Create deal with transaction to ensure consistency
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the deal with processing status for public companies
      const initialStatus = createDealDto.dealType === 'public' ? 'processing' : 'draft';
      const initialMessage = createDealDto.dealType === 'public' ? 'Initiating comprehensive data processing...' : null;
      
      // SECURITY: tenant_id is injected from TenantContext, not user input
      const deal = await tx.$queryRaw`
        INSERT INTO deals (tenant_id, name, description, deal_type, ticker, company_name, years, status, processing_message)
        VALUES (${tenantId}, ${createDealDto.name}, ${createDealDto.description || ''}, ${createDealDto.dealType}, 
                ${createDealDto.ticker || null}, ${createDealDto.companyName || ''}, 
                ${parseInt(String(createDealDto.years || 3))}, ${initialStatus}, ${initialMessage})
        RETURNING id, tenant_id, name, description, deal_type, ticker, company_name, years, status, created_at, updated_at
      ` as any[];

      if (!deal[0]) {
        throw new Error('Failed to create deal');
      }

      const dealId = deal[0].id;

      // Create default analysis session
      await tx.$queryRaw`
        INSERT INTO analysis_sessions (deal_id, session_name)
        VALUES (${dealId}::uuid, 'Main Analysis')
      `;

      // Create default scratch pad
      await tx.$queryRaw`
        INSERT INTO scratch_pads (deal_id, title, content)
        VALUES (${dealId}::uuid, 'Investment Analysis', '# Investment Analysis\n\n## Executive Summary\n\n## Key Findings\n\n## Recommendation\n')
      `;

      return deal[0];
    });

    const createdDeal = await this.getDealById(result.id);

    // For public companies, set status to 'draft' - frontend will call /analyze endpoint
    if (createDealDto.dealType === 'public') {
      await this.updateDealStatus(createdDeal.id, 'draft', 'Ready to start analysis. Click "Start Analysis" to begin.');
    }

    return createdDeal;
  }

  /**
   * Update deal status and processing message
   * 
   * SECURITY: Verifies tenant ownership before update via getDealById
   */
  async updateDealStatus(dealId: string, status: string, message: string): Promise<void> {
    const tenantId = this.getTenantId();
    
    // SECURITY: Only update if deal belongs to current tenant
    const result = await this.prisma.$executeRaw`
      UPDATE deals 
      SET status = ${status}, processing_message = ${message}, updated_at = NOW()
      WHERE id = ${dealId}::uuid AND tenant_id = ${tenantId}
    `;

    if (result === 0) {
      throw new NotFoundException('Deal not found');
    }
  }

  /**
   * Get all deals for the current tenant
   * 
   * SECURITY: Only returns deals where tenant_id matches current tenant.
   * EXCEPTION: Platform admins (default tenant + admin role) can see ALL deals.
   * Cross-tenant data is never exposed to non-platform-admin users.
   * 
   * Requirements: 2.2 - Deal listing isolation
   */
  async getAllDeals(): Promise<DealWithSession[]> {
    const tenantId = this.getTenantId();
    const isPlatformAdmin = this.isPlatformAdmin();
    
    this.logger.log(`Fetching deals for tenant: ${tenantId}, isPlatformAdmin: ${isPlatformAdmin}`);

    let deals: any[];
    
    if (isPlatformAdmin) {
      // PLATFORM ADMIN: Can see all deals across all tenants
      this.logger.log('Platform admin access - fetching all tenant deals');
      deals = await this.prisma.$queryRaw`
        SELECT 
          d.id, d.name, d.description, d.deal_type as "dealType", d.ticker, d.company_name as "companyName",
          d.years, d.status, d.processing_message as "processingMessage", d.news_data as "newsData",
          d.created_at as "createdAt", d.updated_at as "updatedAt",
          d.tenant_id as "tenantId",
          t.name as "tenantName", t.slug as "tenantSlug",
          s.id as session_id, s.system_prompt as system_prompt,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count,
          sp.id as scratch_pad_id, sp.content as scratch_pad_content, sp.auto_saved_at as scratch_pad_saved
        FROM deals d
        LEFT JOIN tenants t ON d.tenant_id = t.id
        LEFT JOIN analysis_sessions s ON d.id = s.deal_id AND s.is_active = true
        LEFT JOIN scratch_pads sp ON d.id = sp.deal_id
        ORDER BY d.updated_at DESC
      ` as any[];
    } else {
      // SECURITY: Filter by tenant_id to ensure isolation
      deals = await this.prisma.$queryRaw`
        SELECT 
          d.id, d.name, d.description, d.deal_type as "dealType", d.ticker, d.company_name as "companyName",
          d.years, d.status, d.processing_message as "processingMessage", d.news_data as "newsData",
          d.created_at as "createdAt", d.updated_at as "updatedAt",
          s.id as session_id, s.system_prompt as system_prompt,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count,
          sp.id as scratch_pad_id, sp.content as scratch_pad_content, sp.auto_saved_at as scratch_pad_saved
        FROM deals d
        LEFT JOIN analysis_sessions s ON d.id = s.deal_id AND s.is_active = true
        LEFT JOIN scratch_pads sp ON d.id = sp.deal_id
        WHERE d.tenant_id = ${tenantId}
        ORDER BY d.updated_at DESC
      ` as any[];
    }

    return deals.map(deal => this.mapDealToResponse(deal));
  }

  /**
   * Get deal by ID with full details
   * 
   * SECURITY: Returns 404 (not 403) if deal doesn't exist OR belongs to another tenant.
   * EXCEPTION: Platform admins can view any deal.
   * This prevents information leakage about deal existence.
   * 
   * Requirements: 2.3, 2.6 - Deal ownership verification
   */
  async getDealById(id: string): Promise<DealWithSession> {
    const tenantId = this.getTenantId();
    const isPlatformAdmin = this.isPlatformAdmin();
    
    this.logger.log(`Fetching deal: ${id} for tenant: ${tenantId}, isPlatformAdmin: ${isPlatformAdmin}`);

    let deals: any[];
    
    if (isPlatformAdmin) {
      // PLATFORM ADMIN: Can view any deal
      deals = await this.prisma.$queryRaw`
        SELECT 
          d.id, d.name, d.description, d.deal_type as "dealType", d.ticker, d.company_name as "companyName",
          d.years, d.status, d.processing_message as "processingMessage", d.news_data as "newsData",
          d.created_at as "createdAt", d.updated_at as "updatedAt",
          d.tenant_id as "tenantId",
          t.name as "tenantName", t.slug as "tenantSlug",
          s.id as session_id, s.system_prompt as system_prompt,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count,
          sp.id as scratch_pad_id, sp.content as scratch_pad_content, sp.auto_saved_at as scratch_pad_saved
        FROM deals d
        LEFT JOIN tenants t ON d.tenant_id = t.id
        LEFT JOIN analysis_sessions s ON d.id = s.deal_id AND s.is_active = true
        LEFT JOIN scratch_pads sp ON d.id = sp.deal_id
        WHERE d.id = ${id}::uuid
      ` as any[];
    } else {
      // SECURITY: Filter by both id AND tenant_id
      deals = await this.prisma.$queryRaw`
        SELECT 
          d.id, d.name, d.description, d.deal_type as "dealType", d.ticker, d.company_name as "companyName",
          d.years, d.status, d.processing_message as "processingMessage", d.news_data as "newsData",
          d.created_at as "createdAt", d.updated_at as "updatedAt",
          s.id as session_id, s.system_prompt as system_prompt,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count,
          sp.id as scratch_pad_id, sp.content as scratch_pad_content, sp.auto_saved_at as scratch_pad_saved
        FROM deals d
        LEFT JOIN analysis_sessions s ON d.id = s.deal_id AND s.is_active = true
        LEFT JOIN scratch_pads sp ON d.id = sp.deal_id
        WHERE d.id = ${id}::uuid AND d.tenant_id = ${tenantId}
      ` as any[];
    }

    if (!deals[0]) {
      // SECURITY: Return 404 for both "not found" and "wrong tenant"
      // This prevents attackers from discovering deal IDs
      throw new NotFoundException('Deal not found');
    }

    return this.mapDealToResponse(deals[0]);
  }
  /**
   * Get deal by ticker
   * Returns the deal for the given ticker within the current tenant
   */
  async getDealByTicker(ticker: string): Promise<DealWithSession> {
    const tenantId = this.getTenantId();
    const isPlatformAdmin = this.isPlatformAdmin();
    const upperTicker = ticker.toUpperCase();

    this.logger.log(`Fetching deal by ticker: ${upperTicker} for tenant: ${tenantId}`);

    let deals: any[];

    if (isPlatformAdmin) {
      deals = await this.prisma.$queryRaw`
        SELECT
          d.id, d.name, d.description, d.deal_type as "dealType", d.ticker, d.company_name as "companyName",
          d.years, d.status, d.processing_message as "processingMessage", d.news_data as "newsData",
          d.created_at as "createdAt", d.updated_at as "updatedAt",
          d.tenant_id as "tenantId",
          t.name as "tenantName", t.slug as "tenantSlug",
          s.id as session_id, s.system_prompt as system_prompt,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count,
          sp.id as scratch_pad_id, sp.content as scratch_pad_content, sp.auto_saved_at as scratch_pad_saved
        FROM deals d
        LEFT JOIN tenants t ON d.tenant_id = t.id
        LEFT JOIN analysis_sessions s ON d.id = s.deal_id AND s.is_active = true
        LEFT JOIN scratch_pads sp ON d.id = sp.deal_id
        WHERE UPPER(d.ticker) = ${upperTicker}
        ORDER BY d.created_at DESC
        LIMIT 1
      ` as any[];
    } else {
      deals = await this.prisma.$queryRaw`
        SELECT
          d.id, d.name, d.description, d.deal_type as "dealType", d.ticker, d.company_name as "companyName",
          d.years, d.status, d.processing_message as "processingMessage", d.news_data as "newsData",
          d.created_at as "createdAt", d.updated_at as "updatedAt",
          s.id as session_id, s.system_prompt as system_prompt,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count,
          sp.id as scratch_pad_id, sp.content as scratch_pad_content, sp.auto_saved_at as scratch_pad_saved
        FROM deals d
        LEFT JOIN analysis_sessions s ON d.id = s.deal_id AND s.is_active = true
        LEFT JOIN scratch_pads sp ON d.id = sp.deal_id
        WHERE UPPER(d.ticker) = ${upperTicker} AND d.tenant_id = ${tenantId}
        ORDER BY d.created_at DESC
        LIMIT 1
      ` as any[];
    }

    if (!deals[0]) {
      throw new NotFoundException(`Deal not found for ticker: ${ticker}`);
    }

    return this.mapDealToResponse(deals[0]);
  }



  /**
   * Update deal
   * 
   * SECURITY: Verifies tenant ownership before update.
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   * 
   * Requirements: 2.4 - Update ownership verification
   */
  async updateDeal(id: string, updateDealDto: UpdateDealDto): Promise<DealWithSession> {
    const tenantId = this.getTenantId();
    this.logger.log(`Updating deal: ${id} for tenant: ${tenantId}`);

    // SECURITY: Verify ownership first - throws 404 if not owned
    await this.getDealById(id);

    // Build update query dynamically
    const updateFields: string[] = [];
    const values: any[] = [];

    if (updateDealDto.name !== undefined) {
      updateFields.push(`name = $${values.length + 1}`);
      values.push(updateDealDto.name);
    }
    if (updateDealDto.description !== undefined) {
      updateFields.push(`description = $${values.length + 1}`);
      values.push(updateDealDto.description);
    }
    if (updateDealDto.ticker !== undefined) {
      updateFields.push(`ticker = $${values.length + 1}`);
      values.push(updateDealDto.ticker);
    }
    if (updateDealDto.companyName !== undefined) {
      updateFields.push(`company_name = $${values.length + 1}`);
      values.push(updateDealDto.companyName);
    }
    if (updateDealDto.years !== undefined) {
      updateFields.push(`years = $${values.length + 1}`);
      values.push(updateDealDto.years);
    }
    if (updateDealDto.status !== undefined) {
      updateFields.push(`status = $${values.length + 1}`);
      values.push(updateDealDto.status);
    }

    if (updateFields.length === 0) {
      return this.getDealById(id);
    }

    updateFields.push('updated_at = NOW()');
    values.push(id);
    values.push(tenantId);

    // SECURITY: Include tenant_id in WHERE clause as defense-in-depth
    const query = `UPDATE deals SET ${updateFields.join(', ')} WHERE id = $${values.length - 1}::uuid AND tenant_id = $${values.length}`;
    
    await this.prisma.$executeRawUnsafe(query, ...values);

    return this.getDealById(id);
  }

  /**
   * Delete deal
   * 
   * SECURITY: Verifies tenant ownership before deletion.
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   * Only deletes the deal record and its direct children (sessions, scratch_pads).
   * Preserves: financial_metrics, narrative_chunks, calculated_metrics, KB synced data.
   * 
   * Requirements: 2.5 - Delete ownership verification
   */
  async deleteDeal(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    this.logger.log(`Deleting deal: ${id} for tenant: ${tenantId}`);

    // SECURITY: Verify ownership first - throws 404 if not owned
    const deal = await this.getDealById(id);
    
    try {
      // Delete in order to respect foreign key constraints
      // All deletes include tenant verification as defense-in-depth
      
      // 1. Delete chat messages (child of analysis_sessions)
      await this.prisma.$executeRaw`
        DELETE FROM chat_messages 
        WHERE session_id IN (
          SELECT s.id FROM analysis_sessions s
          JOIN deals d ON s.deal_id = d.id
          WHERE d.id = ${id}::uuid AND d.tenant_id = ${tenantId}
        )
      `;
      
      // 2. Delete analysis sessions
      await this.prisma.$executeRaw`
        DELETE FROM analysis_sessions 
        WHERE deal_id = ${id}::uuid 
        AND deal_id IN (SELECT id FROM deals WHERE tenant_id = ${tenantId})
      `;
      
      // 3. Delete scratch pads
      await this.prisma.$executeRaw`
        DELETE FROM scratch_pads 
        WHERE deal_id = ${id}::uuid
        AND deal_id IN (SELECT id FROM deals WHERE tenant_id = ${tenantId})
      `;
      
      // 4. Finally delete the deal itself
      const result = await this.prisma.$executeRaw`
        DELETE FROM deals WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
      `;

      if (result === 0) {
        throw new NotFoundException('Deal not found');
      }

      this.logger.log(`Deal ${id} (${deal.ticker}) deleted successfully for tenant ${tenantId}. Financial data preserved.`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete deal ${id}: ${error.message}`);
      throw new Error(`Failed to delete deal: ${error.message}`);
    }
  }

  /**
   * Get deal statistics for the current tenant
   * 
   * SECURITY: Only counts deals belonging to current tenant.
   */
  async getDealStats(): Promise<{
    totalDeals: number;
    dealsByStatus: Record<string, number>;
    dealsByType: Record<string, number>;
    recentActivity: number;
  }> {
    const tenantId = this.getTenantId();

    // SECURITY: Filter by tenant_id
    const stats = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_deals,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
        COUNT(CASE WHEN status = 'in-progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN status = 'review' THEN 1 END) as review_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count,
        COUNT(CASE WHEN deal_type = 'public' THEN 1 END) as public_count,
        COUNT(CASE WHEN deal_type = 'private' THEN 1 END) as private_count,
        COUNT(CASE WHEN updated_at > NOW() - INTERVAL '7 days' THEN 1 END) as recent_activity
      FROM deals
      WHERE tenant_id = ${tenantId}
    ` as any[];

    const stat = stats[0];
    return {
      totalDeals: parseInt(stat.total_deals) || 0,
      dealsByStatus: {
        draft: parseInt(stat.draft_count) || 0,
        'in-progress': parseInt(stat.in_progress_count) || 0,
        review: parseInt(stat.review_count) || 0,
        closed: parseInt(stat.closed_count) || 0,
      },
      dealsByType: {
        public: parseInt(stat.public_count) || 0,
        private: parseInt(stat.private_count) || 0,
      },
      recentActivity: parseInt(stat.recent_activity) || 0,
    };
  }

  /**
   * Map raw database result to DealWithSession response
   */
  private mapDealToResponse(deal: any): DealWithSession {
    const response: DealWithSession = {
      id: deal.id,
      name: deal.name,
      description: deal.description,
      dealType: deal.dealType,
      ticker: deal.ticker,
      companyName: deal.companyName,
      years: deal.years,
      status: deal.status,
      processingMessage: deal.processingMessage,
      newsData: deal.newsData ? (typeof deal.newsData === 'string' ? JSON.parse(deal.newsData) : deal.newsData) : null,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
      currentSession: deal.session_id ? {
        id: deal.session_id,
        systemPrompt: deal.system_prompt,
        messageCount: parseInt(deal.message_count) || 0,
      } : undefined,
      scratchPad: deal.scratch_pad_id ? {
        id: deal.scratch_pad_id,
        content: deal.scratch_pad_content,
        autoSavedAt: deal.scratch_pad_saved,
      } : undefined,
    };
    
    // Include tenant info for platform admin views
    if (deal.tenantId) {
      (response as any).tenantId = deal.tenantId;
      (response as any).tenantName = deal.tenantName;
      (response as any).tenantSlug = deal.tenantSlug;
    }
    
    return response;
  }

  // ==================== INTERNAL PROCESSING METHODS ====================
  // These methods are used for background processing and don't need tenant context
  // as they operate on deals that have already been verified

  /**
   * Check existing filings in database (public data - no tenant filter needed)
   */
  async checkExistingFilings(ticker: string, years: number): Promise<any[]> {
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
    const cutoffDateStr = cutoffDate.toISOString();
    
    const existingFilings = await this.prisma.$queryRawUnsafe(`
      SELECT DISTINCT filing_type, filing_date, filing_url
      FROM filing_metadata 
      WHERE ticker = $1 
        AND filing_date >= $2::timestamp
      ORDER BY filing_date DESC
    `, ticker, cutoffDateStr);
    
    return existingFilings as any[];
  }

  /**
   * Update news data for a deal (internal use after ownership verification)
   */
  async updateDealNewsData(dealId: string, newsData: any): Promise<void> {
    const tenantId = this.getTenantId();
    const newsJson = JSON.stringify(newsData);
    
    // SECURITY: Include tenant_id in WHERE clause
    await this.prisma.$executeRawUnsafe(`
      UPDATE deals 
      SET news_data = $1::jsonb, updated_at = NOW()
      WHERE id = $2::uuid AND tenant_id = $3
    `, newsJson, dealId, tenantId);
  }

  /**
   * Validate that a ticker exists in the database
   * Throws user-friendly error if ticker not found
   * 
   * This is called during deal creation to ensure the ticker has financial data
   * before allowing the user to create a deal for it.
   */
  private async validateTickerExists(ticker: string): Promise<void> {
    const upperTicker = ticker.toUpperCase();

    // Check if ticker exists in financial_metrics table
    const result = await this.prisma.$queryRawUnsafe<{ count: number }[]>(`
      SELECT COUNT(*)::int as count
      FROM financial_metrics
      WHERE ticker = $1
      LIMIT 1
    `, upperTicker);

    const hasData = result[0]?.count > 0;

    if (!hasData) {
      throw new BadRequestException(
        `Ticker "${upperTicker}" not found in our database. ` +
        `Please verify the ticker symbol is correct or import financial data first.`
      );
    }

    this.logger.log(`Ticker validation passed for ${upperTicker}`);
  }
}
