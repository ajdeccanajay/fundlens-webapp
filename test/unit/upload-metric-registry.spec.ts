import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Validates that the metric registry YAML files were correctly copied
 * to the local-s3-storage directory structure by the upload script.
 */
describe('Metric Registry Local Upload', () => {
  const LOCAL_METRICS_DIR = path.join(
    __dirname,
    '..',
    '..',
    'local-s3-storage',
    'fundlens-documents-dev',
    'metrics',
  );

  const EXPECTED_STRUCTURE: Record<string, string[]> = {
    universal: [
      'income_statement.yaml',
      'balance_sheet.yaml',
      'cash_flow.yaml',
      'equity_statement.yaml',
    ],
    sector: [
      'revenue_by_industry.yaml',
      'energy.yaml',
      'materials.yaml',
      'industrials.yaml',
      'consumer_discretionary.yaml',
      'consumer_staples.yaml',
      'healthcare.yaml',
      'financials.yaml',
      'info_tech.yaml',
      'communication_services.yaml',
      'utilities.yaml',
      'real_estate.yaml',
    ],
    pe_specific: ['return_and_fund_metrics.yaml'],
    computed: ['all_computed_metrics.yaml'],
    concepts: ['analytical_concepts.yaml'],
    clients: ['third_avenue.yaml'],
  };

  it('should have all 6 subdirectories', () => {
    const subdirs = fs.readdirSync(LOCAL_METRICS_DIR);
    expect(subdirs.sort()).toEqual(
      Object.keys(EXPECTED_STRUCTURE).sort(),
    );
  });

  it('should have all 20 YAML files in correct subdirectories', () => {
    for (const [subdir, files] of Object.entries(EXPECTED_STRUCTURE)) {
      const dirPath = path.join(LOCAL_METRICS_DIR, subdir);
      expect(fs.existsSync(dirPath)).toBe(true);
      const actualFiles = fs.readdirSync(dirPath);
      expect(actualFiles.sort()).toEqual(files.sort());
    }
  });

  it('should contain exactly 252 metrics across all metric files', () => {
    let totalMetrics = 0;
    for (const [subdir, files] of Object.entries(EXPECTED_STRUCTURE)) {
      if (subdir === 'clients' || subdir === 'concepts') continue;
      for (const file of files) {
        const filePath = path.join(LOCAL_METRICS_DIR, subdir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = yaml.load(content) as Record<string, unknown>;
        totalMetrics += Object.keys(parsed).length;
      }
    }
    expect(totalMetrics).toBe(252);
  });

  it('should contain exactly 1209 synonyms across all metric files', () => {
    let totalSynonyms = 0;
    for (const [subdir, files] of Object.entries(EXPECTED_STRUCTURE)) {
      if (subdir === 'clients' || subdir === 'concepts') continue;
      for (const file of files) {
        const filePath = path.join(LOCAL_METRICS_DIR, subdir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = yaml.load(content) as Record<string, any>;
        for (const metric of Object.values(parsed)) {
          if (metric?.synonyms) {
            totalSynonyms += metric.synonyms.length;
          }
        }
      }
    }
    expect(totalSynonyms).toBe(1209);
  });

  it('should have valid YAML in every file', () => {
    for (const [subdir, files] of Object.entries(EXPECTED_STRUCTURE)) {
      for (const file of files) {
        const filePath = path.join(LOCAL_METRICS_DIR, subdir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        expect(() => yaml.load(content)).not.toThrow();
      }
    }
  });

  it('should match source files byte-for-byte', () => {
    const sourceDir = path.join(
      __dirname,
      '..',
      '..',
      '.kiro',
      'specs',
      'metric-resolution-architecture',
    );
    for (const [subdir, files] of Object.entries(EXPECTED_STRUCTURE)) {
      for (const file of files) {
        const sourcePath = path.join(sourceDir, file);
        const destPath = path.join(LOCAL_METRICS_DIR, subdir, file);
        const sourceContent = fs.readFileSync(sourcePath, 'utf8');
        const destContent = fs.readFileSync(destPath, 'utf8');
        expect(destContent).toBe(sourceContent);
      }
    }
  });
});
