/**
 * QUL Evaluation Suite Runner
 * Spec: FundLens_QUL_Specification_v1.md, Section 6.4
 *
 * Calls QueryUnderstandingService.understand() for each fixture
 * and reports accuracy per category and overall.
 *
 * Usage: npx ts-node scripts/run-qul-eval.ts [--category <name>] [--verbose]
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { QueryUnderstandingService } from '../src/rag/query-understanding.service';
import * as fs from 'fs';
import * as path from 'path';

interface Fixture {
  id: string;
  category: string;
  description: string;
  input: {
    query: string;
    workspace: any;
    conversation_history?: any[];
    uploaded_documents?: any[];
  };
  expected: Record<string, any>;
}

interface TestResult {
  id: string;
  category: string;
  passed: boolean;
  failures: string[];
  latencyMs: number;
}

// ── Field Extraction Helpers ─────────────────────────────────────────

function getPrimaryTicker(result: any): string | undefined {
  return result.primaryEntity?.ticker;
}

function getEntityCount(result: any): number {
  return result.entities?.length || 0;
}

function getTemporalType(result: any): string | undefined {
  return result.temporalScope?.type;
}

function getEntityType(result: any): string | undefined {
  return result.primaryEntity?.entityType || result.entities?.[0]?.entityType;
}

function hasSubQueries(result: any): boolean {
  return Array.isArray(result.subQueries) && result.subQueries.length > 0;
}

// ── Assertion Logic ──────────────────────────────────────────────────

function checkFixture(expected: Record<string, any>, actual: any): string[] {
  const failures: string[] = [];

  for (const [key, expectedVal] of Object.entries(expected)) {
    let actualVal: any;

    switch (key) {
      case 'primaryTicker':
        actualVal = getPrimaryTicker(actual);
        break;
      case 'intent':
        actualVal = actual.intent;
        break;
      case 'isValidQuery':
        actualVal = actual.isValidQuery;
        break;
      case 'useWorkspaceContext':
        actualVal = actual.useWorkspaceContext;
        break;
      case 'domain':
        actualVal = actual.domain;
        break;
      case 'needsPeerComparison':
        actualVal = actual.needsPeerComparison;
        break;
      case 'complexity':
        actualVal = actual.complexity;
        break;
      case 'temporalType':
        actualVal = getTemporalType(actual);
        break;
      case 'entityType':
        actualVal = getEntityType(actual);
        break;
      case 'entityCount_gte':
        actualVal = getEntityCount(actual);
        if (actualVal >= expectedVal) continue; // pass
        failures.push(`${key}: expected >= ${expectedVal}, got ${actualVal}`);
        continue;
      case 'hasSubQueries':
        actualVal = hasSubQueries(actual);
        break;
      default:
        continue; // skip unknown keys
    }

    if (actualVal !== expectedVal) {
      failures.push(`${key}: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`);
    }
  }

  return failures;
}

// ── Main Runner ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const categoryFilter = args.includes('--category')
    ? args[args.indexOf('--category') + 1]
    : null;

  // Load fixtures
  const fixturesPath = path.join(__dirname, '..', 'test', 'eval', 'qul-eval-fixtures.json');
  const fixtures: Fixture[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

  const filtered = categoryFilter
    ? fixtures.filter(f => f.category === categoryFilter)
    : fixtures;

  console.log(`\n🧪 QUL Evaluation Suite`);
  console.log(`   Fixtures: ${filtered.length}${categoryFilter ? ` (filtered: ${categoryFilter})` : ` of ${fixtures.length}`}`);
  console.log(`   Verbose: ${verbose}\n`);

  // Bootstrap NestJS app (headless — no HTTP listener)
  console.log('⏳ Bootstrapping NestJS application...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'], // suppress noise
  });
  const qul = app.get(QueryUnderstandingService);
  console.log('✅ Application bootstrapped\n');

  // Run each fixture
  const results: TestResult[] = [];
  let passCount = 0;
  let failCount = 0;

  for (let i = 0; i < filtered.length; i++) {
    const fixture = filtered[i];
    const { query, workspace, conversation_history, uploaded_documents } = fixture.input;

    // Reset circuit breaker and cache between tests so each test is independent
    qul.clearCache();
    (qul as any).failureCount = 0;
    (qul as any).lastFailureTime = 0;

    const start = Date.now();
    let actual: any;
    try {
      actual = await qul.understand(
        query,
        workspace,
        uploaded_documents || [],
        conversation_history || [],
      );
    } catch (err) {
      const latency = Date.now() - start;
      const result: TestResult = {
        id: fixture.id,
        category: fixture.category,
        passed: false,
        failures: [`EXCEPTION: ${err.message}`],
        latencyMs: latency,
      };
      results.push(result);
      failCount++;
      console.log(`  ❌ ${fixture.id} — EXCEPTION: ${err.message}`);
      // Longer delay after failure to let Bedrock recover
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    const latency = Date.now() - start;

    const failures = checkFixture(fixture.expected, actual);
    const passed = failures.length === 0;

    results.push({
      id: fixture.id,
      category: fixture.category,
      passed,
      failures,
      latencyMs: latency,
    });

    if (passed) {
      passCount++;
      if (verbose) {
        console.log(`  ✅ ${fixture.id} (${latency}ms)`);
      }
    } else {
      failCount++;
      console.log(`  ❌ ${fixture.id} (${latency}ms)`);
      failures.forEach(f => console.log(`     └─ ${f}`));
      if (verbose) {
        console.log(`     └─ actual: ${JSON.stringify({
          intent: actual.intent,
          primaryTicker: getPrimaryTicker(actual),
          isValidQuery: actual.isValidQuery,
          useWorkspaceContext: actual.useWorkspaceContext,
          domain: actual.domain,
          temporalType: actual.temporalScope?.type,
          entityCount: actual.entities?.length,
          complexity: actual.complexity,
          needsPeerComparison: actual.needsPeerComparison,
        })}`);
      }
    }

    // Delay between calls to avoid Bedrock throttling
    if (i < filtered.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // ── Category Summary ─────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('📊 RESULTS BY CATEGORY');
  console.log('═'.repeat(70));

  const categories = new Map<string, { pass: number; fail: number; latencies: number[] }>();
  for (const r of results) {
    if (!categories.has(r.category)) {
      categories.set(r.category, { pass: 0, fail: 0, latencies: [] });
    }
    const cat = categories.get(r.category)!;
    if (r.passed) cat.pass++;
    else cat.fail++;
    cat.latencies.push(r.latencyMs);
  }

  const ENTITY_CATEGORIES = [
    'explicit_ticker', 'company_name', 'workspace_context',
    'workspace_override', 'coreference',
  ];
  const INTENT_CATEGORIES = ['intent_classification'];

  let entityTotal = 0, entityPass = 0;
  let intentTotal = 0, intentPass = 0;

  for (const [cat, stats] of Array.from(categories.entries()).sort()) {
    const total = stats.pass + stats.fail;
    const pct = ((stats.pass / total) * 100).toFixed(1);
    const avgLatency = Math.round(
      stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length,
    );
    const status = stats.fail === 0 ? '✅' : '⚠️';
    console.log(
      `  ${status} ${cat.padEnd(25)} ${stats.pass}/${total} (${pct}%)  avg ${avgLatency}ms`,
    );

    if (ENTITY_CATEGORIES.includes(cat)) {
      entityTotal += total;
      entityPass += stats.pass;
    }
    if (INTENT_CATEGORIES.includes(cat)) {
      intentTotal += total;
      intentPass += stats.pass;
    }
  }

  // ── Overall Summary ──────────────────────────────────────────────
  const totalPct = ((passCount / (passCount + failCount)) * 100).toFixed(1);
  const entityPct = entityTotal > 0
    ? ((entityPass / entityTotal) * 100).toFixed(1)
    : 'N/A';
  const intentPct = intentTotal > 0
    ? ((intentPass / intentTotal) * 100).toFixed(1)
    : 'N/A';

  const avgLatency = Math.round(
    results.reduce((a, b) => a + b.latencyMs, 0) / results.length,
  );
  const p50 = results
    .map(r => r.latencyMs)
    .sort((a, b) => a - b)[Math.floor(results.length * 0.5)];
  const p99 = results
    .map(r => r.latencyMs)
    .sort((a, b) => a - b)[Math.floor(results.length * 0.99)];

  console.log('\n' + '═'.repeat(70));
  console.log('📈 OVERALL');
  console.log('═'.repeat(70));
  console.log(`  Total:              ${passCount}/${passCount + failCount} (${totalPct}%)`);
  console.log(`  Entity Resolution:  ${entityPass}/${entityTotal} (${entityPct}%) — target: 95%`);
  console.log(`  Intent Classification: ${intentPass}/${intentTotal} (${intentPct}%) — target: 90%`);
  console.log(`  Avg Latency:        ${avgLatency}ms`);
  console.log(`  p50 Latency:        ${p50}ms`);
  console.log(`  p99 Latency:        ${p99}ms`);

  // ── Threshold Check ──────────────────────────────────────────────
  const entityOk = entityTotal === 0 || (entityPass / entityTotal) >= 0.95;
  const intentOk = intentTotal === 0 || (intentPass / intentTotal) >= 0.90;

  console.log('\n' + '═'.repeat(70));
  if (entityOk && intentOk) {
    console.log('🎯 ALL THRESHOLDS MET');
  } else {
    if (!entityOk) console.log('🚨 ENTITY RESOLUTION BELOW 95% THRESHOLD');
    if (!intentOk) console.log('🚨 INTENT CLASSIFICATION BELOW 90% THRESHOLD');
  }
  console.log('═'.repeat(70) + '\n');

  await app.close();
  process.exit(entityOk && intentOk ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
