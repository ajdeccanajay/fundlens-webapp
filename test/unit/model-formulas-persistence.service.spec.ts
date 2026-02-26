/**
 * Unit tests for ModelFormulasPersistenceService
 */
import { ModelFormulasPersistenceService } from '../../src/documents/model-formulas-persistence.service';
import { FormulaRelation } from '../../src/documents/excel-extractor.service';

describe('ModelFormulasPersistenceService', () => {
  let service: ModelFormulasPersistenceService;
  let mockPrisma: any;

  const sampleFormulas: FormulaRelation[] = [
    { sheet: 'P&L', cell: 'C10', formula: '=C5-C8', dependsOn: ['C5', 'C8'] },
    { sheet: 'P&L', cell: 'C15', formula: '=C10/C5', dependsOn: ['C10', 'C5'] },
    { sheet: 'Balance Sheet', cell: 'D20', formula: '=D10+D15', dependsOn: ['D10', 'D15'] },
  ];

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
    };
    service = new ModelFormulasPersistenceService(mockPrisma);
  });

  it('should persist all formulas and return count', async () => {
    const result = await service.persist('doc-1', 'tenant-1', sampleFormulas);
    expect(result.persisted).toBe(3);
  });

  it('should delete existing formulas before inserting (idempotent)', async () => {
    await service.persist('doc-1', 'tenant-1', sampleFormulas);
    expect(mockPrisma.$executeRawUnsafe.mock.calls[0][0]).toContain('DELETE FROM model_formulas');
    expect(mockPrisma.$executeRawUnsafe.mock.calls[0][1]).toBe('doc-1');
  });

  it('should return 0 for empty formulas array', async () => {
    const result = await service.persist('doc-1', 'tenant-1', []);
    expect(result.persisted).toBe(0);
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('should serialize dependsOn as JSON', async () => {
    await service.persist('doc-1', 'tenant-1', [sampleFormulas[0]]);
    // calls[0] = DELETE, calls[1] = INSERT
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[7]).toBe(JSON.stringify(['C5', 'C8']));
  });

  it('should pass sheet name, cell reference, and formula text', async () => {
    await service.persist('doc-1', 'tenant-1', [sampleFormulas[0]]);
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[3]).toBe('P&L');    // sheet_name
    expect(insertCall[4]).toBe('C10');    // cell_reference
    expect(insertCall[5]).toBe('=C5-C8'); // formula_text
  });

  it('should set resolved_metric to null (populated later)', async () => {
    await service.persist('doc-1', 'tenant-1', [sampleFormulas[0]]);
    const insertCall = mockPrisma.$executeRawUnsafe.mock.calls[1];
    expect(insertCall[6]).toBeNull(); // resolved_metric
  });

  it('should continue on individual insert failure', async () => {
    mockPrisma.$executeRawUnsafe
      .mockResolvedValueOnce(undefined) // DELETE
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const result = await service.persist('doc-1', 'tenant-1', sampleFormulas);
    expect(result.persisted).toBe(2);
  });

  it('should handle complete failure gracefully', async () => {
    mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error('DB down'));
    const result = await service.persist('doc-1', 'tenant-1', sampleFormulas);
    expect(result.persisted).toBe(0);
  });
});
