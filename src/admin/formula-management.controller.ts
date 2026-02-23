import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import { FormulaManagementService } from './formula-management.service';
import type { CreateFormulaDto } from './formula-management.service';

@Controller('admin/formulas')
@UseGuards(PlatformAdminGuard)
export class FormulaManagementController {
  private readonly logger = new Logger(FormulaManagementController.name);

  constructor(
    private readonly formulaManagement: FormulaManagementService,
  ) {}

  /**
   * Create a new formula submission.
   * POST /api/admin/formulas
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createFormula(@Body() dto: CreateFormulaDto) {
    this.logger.log(`Creating formula: ${dto.canonicalId}`);

    const formula = await this.formulaManagement.createFormula(dto);

    return { success: true, formula };
  }

  /**
   * List all pending formulas.
   * GET /api/admin/formulas/pending
   */
  @Get('pending')
  async listPending() {
    const formulas = await this.formulaManagement.listPending();

    return { success: true, formulas };
  }

  /**
   * Get a single formula by ID.
   * GET /api/admin/formulas/:id
   */
  @Get(':id')
  async getById(@Param('id') id: string) {
    const formula = await this.formulaManagement.getById(id);

    return { success: true, formula };
  }

  /**
   * Approve a pending formula.
   * POST /api/admin/formulas/:id/approve
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id') id: string,
    @Body() body: { reviewedBy: string },
  ) {
    this.logger.log(`Approving formula: ${id}`);

    const formula = await this.formulaManagement.approve(id, body.reviewedBy);

    return { success: true, formula };
  }

  /**
   * Reject a pending formula.
   * POST /api/admin/formulas/:id/reject
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') id: string,
    @Body() body: { rejectionReason: string; reviewedBy: string },
  ) {
    this.logger.log(`Rejecting formula: ${id}`);

    const formula = await this.formulaManagement.reject(
      id,
      body.rejectionReason,
      body.reviewedBy,
    );

    return { success: true, formula };
  }
}
