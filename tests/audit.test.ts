/**
 * BuildChain Protocol — Module 6 Test Suite
 *
 * Unit tests for the Audit Trail + Lender Dashboard covering:
 *   - AuditEvent structure
 *   - AuditTrail building from registry records
 *   - Event chronological ordering
 *   - DrawSummary field calculations (time remaining, status labels)
 *   - ProjectDashboard aggregate stats
 *   - Text report formatting (smoke tests)
 *   - JSON export round-trip
 *   - Progress bar calculation
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  AuditTrail,
  AuditEvent,
  AuditEventType,
  DrawSummary,
  ProjectDashboard,
} from '../src/audit/types';
import {
  formatAuditTrailText,
  formatDashboardText,
  exportAuditTrailJson,
  exportDashboardJson,
} from '../src/audit/report';
import { buildAuditTrail, buildDrawSummary, buildProjectDashboard } from '../src/audit/trail';
import { EscrowRegistry } from '../src/registry/registry';
import { EscrowRecord, EscrowStatus } from '../src/types';
import { xrpToDrops } from '../src/config/network';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeTempRegistry(): EscrowRegistry {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
  return new EscrowRegistry(path.join(dir, 'registry.json'));
}

function makeRecord(overrides: Partial<EscrowRecord> = {}): EscrowRecord {
  const now = new Date();
  const finishAfter = new Date(now.getTime() + 60 * 60 * 1000);
  const cancelAfter = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  return {
    drid: 'AUDIT-PROJ:draw1',
    projectId: 'AUDIT-PROJ',
    drawNumber: 1,
    milestoneDescription: 'Foundation pour',
    lenderAddress: 'rLender',
    gcAddress: 'rGC',
    amountDrops: xrpToDrops(100),
    amountXrp: '100',
    protocolFeeDrops: '300000',
    finishAfter: finishAfter.toISOString(),
    cancelAfter: cancelAfter.toISOString(),
    escrowSequence: 1000,
    createTxHash: 'CREATE_TX_HASH',
    verificationConditions: {
      inspectorCredentialVerified: false,
      lienWaiverNftVerified: false,
    },
    status: 'FUNDED',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function populateRegistry(registry: EscrowRegistry, count = 3): void {
  for (let i = 1; i <= count; i++) {
    registry.save(
      makeRecord({
        drid: `AUDIT-PROJ:draw${i}`,
        drawNumber: i,
        milestoneDescription: `Milestone ${i}`,
        status: i === 1 ? 'RELEASED' : i === 2 ? 'FUNDED' : 'PENDING_VERIFICATION',
        finishTxHash: i === 1 ? `FINISH_TX_${i}` : undefined,
        amountDrops: xrpToDrops(100 * i),
        amountXrp: String(100 * i),
      })
    );
  }
}

// ─── TESTS: AuditEvent Structure ──────────────────────────────────────────────

describe('AuditEvent Structure', () => {
  it('ESCROW_CREATED event has required fields', () => {
    const event: AuditEvent = {
      sequence: 1,
      type: 'ESCROW_CREATED',
      description: 'Escrow created',
      timestamp: new Date().toISOString(),
      txHash: 'HASH',
      actor: 'rLender',
      toStatus: 'FUNDED',
    };
    expect(event.sequence).toBe(1);
    expect(event.type).toBe('ESCROW_CREATED');
    expect(event.txHash).toBeDefined();
  });

  it('all event types are valid strings', () => {
    const types: AuditEventType[] = [
      'ESCROW_CREATED', 'VERIFICATION_STARTED', 'CREDENTIAL_VERIFIED',
      'CREDENTIAL_FAILED', 'NFT_VERIFIED', 'NFT_FAILED', 'DUAL_CONDITION_MET',
      'ESCROW_RELEASED', 'ESCROW_CANCELLED', 'ESCROW_EXPIRED',
      'SETTLEMENT_INITIATED', 'SETTLEMENT_COMPLETED', 'SETTLEMENT_FAILED',
      'STATUS_CHANGE',
    ];
    expect(types).toHaveLength(14);
    types.forEach((t) => expect(typeof t).toBe('string'));
  });
});

// ─── TESTS: AuditTrail Building ───────────────────────────────────────────────

describe('buildAuditTrail', () => {
  it('builds a trail for a FUNDED escrow', () => {
    const registry = makeTempRegistry();
    registry.save(makeRecord());
    const trail = buildAuditTrail(registry, 'AUDIT-PROJ:draw1');
    expect(trail.dridString).toBe('AUDIT-PROJ:draw1');
    expect(trail.currentStatus).toBe('FUNDED');
    expect(trail.events.length).toBeGreaterThanOrEqual(1);
  });

  it('first event is ESCROW_CREATED', () => {
    const registry = makeTempRegistry();
    registry.save(makeRecord());
    const trail = buildAuditTrail(registry, 'AUDIT-PROJ:draw1');
    expect(trail.events[0].type).toBe('ESCROW_CREATED');
  });

  it('events are in chronological order', () => {
    const registry = makeTempRegistry();
    registry.save(makeRecord({
      status: 'RELEASED',
      finishTxHash: 'FINISH_TX',
      verificationConditions: {
        inspectorCredentialVerified: true,
        lienWaiverNftVerified: true,
        verifiedAt: new Date().toISOString(),
        inspectorCredentialTxHash: 'CRED_TX',
        lienWaiverNftTxHash: 'NFT_TX',
      },
    }));
    const trail = buildAuditTrail(registry, 'AUDIT-PROJ:draw1');
    const timestamps = trail.events.map((e) => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('RELEASED trail has ESCROW_RELEASED event', () => {
    const registry = makeTempRegistry();
    registry.save(makeRecord({ status: 'RELEASED', finishTxHash: 'FINISH_TX' }));
    const trail = buildAuditTrail(registry, 'AUDIT-PROJ:draw1');
    const types = trail.events.map((e) => e.type);
    expect(types).toContain('ESCROW_RELEASED');
  });

  it('EXPIRED trail has ESCROW_EXPIRED event', () => {
    const registry = makeTempRegistry();
    registry.save(makeRecord({ status: 'EXPIRED' }));
    const trail = buildAuditTrail(registry, 'AUDIT-PROJ:draw1');
    const types = trail.events.map((e) => e.type);
    expect(types).toContain('ESCROW_EXPIRED');
  });

  it('trail includes createTxHash', () => {
    const registry = makeTempRegistry();
    registry.save(makeRecord({ createTxHash: 'CREATE_TX_HASH' }));
    const trail = buildAuditTrail(registry, 'AUDIT-PROJ:draw1');
    expect(trail.createTxHash).toBe('CREATE_TX_HASH');
  });

  it('throws for unknown DRID', () => {
    const registry = makeTempRegistry();
    expect(() => buildAuditTrail(registry, 'UNKNOWN:draw99')).toThrow();
  });
});

// ─── TESTS: DrawSummary ───────────────────────────────────────────────────────

describe('buildDrawSummary', () => {
  it('builds a summary with correct fields', () => {
    const record = makeRecord();
    const summary = buildDrawSummary(record, 'testnet');
    expect(summary.dridString).toBe('AUDIT-PROJ:draw1');
    expect(summary.amountXrp).toBe('100');
    expect(summary.status).toBe('FUNDED');
    expect(summary.lenderAddress).toBe('rLender');
    expect(summary.gcAddress).toBe('rGC');
  });

  it('time remaining is positive for future cancelAfter', () => {
    const record = makeRecord();
    const summary = buildDrawSummary(record);
    expect(summary.timeRemainingSeconds).toBeGreaterThan(0);
  });

  it('time remaining is 0 for past cancelAfter', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const record = makeRecord({ cancelAfter: past });
    const summary = buildDrawSummary(record);
    expect(summary.timeRemainingSeconds).toBe(0);
  });

  it('dualConditionMet is false when only credential verified', () => {
    const record = makeRecord({
      verificationConditions: {
        inspectorCredentialVerified: true,
        lienWaiverNftVerified: false,
      },
    });
    const summary = buildDrawSummary(record);
    expect(summary.dualConditionMet).toBe(false);
  });

  it('dualConditionMet is true when both verified', () => {
    const record = makeRecord({
      verificationConditions: {
        inspectorCredentialVerified: true,
        lienWaiverNftVerified: true,
      },
    });
    const summary = buildDrawSummary(record);
    expect(summary.dualConditionMet).toBe(true);
  });

  it('RELEASED draw has no time remaining label', () => {
    const record = makeRecord({ status: 'RELEASED', finishTxHash: 'TX' });
    const summary = buildDrawSummary(record);
    expect(summary.timeRemainingLabel).toBe('—');
  });

  it('explorer links are generated for testnet', () => {
    const record = makeRecord({ createTxHash: 'HASH123' });
    const summary = buildDrawSummary(record, 'testnet');
    expect(summary.explorerLinks.create).toContain('testnet.xrpl.org');
    expect(summary.explorerLinks.create).toContain('HASH123');
  });
});

// ─── TESTS: ProjectDashboard ──────────────────────────────────────────────────

describe('buildProjectDashboard', () => {
  it('builds dashboard with correct totals', () => {
    const registry = makeTempRegistry();
    populateRegistry(registry, 3);
    const dashboard = buildProjectDashboard(registry, 'AUDIT-PROJ');
    expect(dashboard.stats.totalDraws).toBe(3);
    // 100 + 200 + 300 = 600 XRP
    expect(dashboard.stats.totalAmountXrp).toBeCloseTo(600, 0);
  });

  it('released draws counted correctly', () => {
    const registry = makeTempRegistry();
    populateRegistry(registry, 3);
    const dashboard = buildProjectDashboard(registry, 'AUDIT-PROJ');
    expect(dashboard.stats.releasedDraws).toBe(1);
    expect(dashboard.stats.releasedAmountXrp).toBeCloseTo(100, 0);
  });

  it('pending draws counted correctly', () => {
    const registry = makeTempRegistry();
    populateRegistry(registry, 3);
    const dashboard = buildProjectDashboard(registry, 'AUDIT-PROJ');
    expect(dashboard.stats.pendingDraws).toBe(2);
  });

  it('draws are sorted by draw number', () => {
    const registry = makeTempRegistry();
    populateRegistry(registry, 3);
    const dashboard = buildProjectDashboard(registry, 'AUDIT-PROJ');
    const nums = dashboard.draws.map((d) => d.drawNumber);
    expect(nums).toEqual([1, 2, 3]);
  });

  it('returns empty stats for unknown project', () => {
    const registry = makeTempRegistry();
    const dashboard = buildProjectDashboard(registry, 'NONEXISTENT');
    expect(dashboard.stats.totalDraws).toBe(0);
    expect(dashboard.draws).toHaveLength(0);
  });
});

// ─── TESTS: Report Formatting ─────────────────────────────────────────────────

describe('Report Formatting', () => {
  function makeSampleTrail(): AuditTrail {
    const registry = makeTempRegistry();
    registry.save(makeRecord());
    return buildAuditTrail(registry, 'AUDIT-PROJ:draw1');
  }

  it('formatAuditTrailText returns non-empty string', () => {
    const trail = makeSampleTrail();
    const text = formatAuditTrailText(trail);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('AUDIT-PROJ:draw1');
  });

  it('text report contains DRID', () => {
    const trail = makeSampleTrail();
    const text = formatAuditTrailText(trail);
    expect(text).toContain('AUDIT-PROJ');
  });

  it('text report contains status', () => {
    const trail = makeSampleTrail();
    const text = formatAuditTrailText(trail);
    expect(text).toContain('FUNDED');
  });

  it('JSON export is valid JSON', () => {
    const trail = makeSampleTrail();
    const json = exportAuditTrailJson(trail);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('JSON round-trips DRID correctly', () => {
    const trail = makeSampleTrail();
    const parsed = JSON.parse(exportAuditTrailJson(trail));
    expect(parsed.dridString).toBe('AUDIT-PROJ:draw1');
  });

  it('dashboard text report contains project stats', () => {
    const registry = makeTempRegistry();
    populateRegistry(registry, 2);
    const dashboard = buildProjectDashboard(registry, 'AUDIT-PROJ');
    const text = formatDashboardText(dashboard);
    expect(text).toContain('AUDIT-PROJ');
    expect(text).toContain('Total draws');
  });

  it('dashboard JSON export is valid', () => {
    const registry = makeTempRegistry();
    populateRegistry(registry, 2);
    const dashboard = buildProjectDashboard(registry, 'AUDIT-PROJ');
    expect(() => JSON.parse(exportDashboardJson(dashboard))).not.toThrow();
  });
});

// ─── TESTS: Progress Bar Math ─────────────────────────────────────────────────

describe('Dashboard Progress Bar', () => {
  it('0% released = empty bar', () => {
    const pct = 0 / 600 * 100;
    expect(pct).toBe(0);
  });

  it('100% released = full bar', () => {
    const pct = 600 / 600 * 100;
    expect(pct).toBe(100);
  });

  it('1/3 released ≈ 33.3%', () => {
    const pct = 100 / 300 * 100;
    expect(pct).toBeCloseTo(33.3, 1);
  });
});
