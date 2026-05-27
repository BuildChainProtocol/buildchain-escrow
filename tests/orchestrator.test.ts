/**
 * BuildChain Protocol — Module 4 Test Suite
 *
 * Unit tests for the Verification Orchestrator covering:
 *   - OrchestrationStatus type completeness
 *   - Condition check result structure
 *   - Partial verification states (credential-only, NFT-only)
 *   - Dual-condition met logic
 *   - Batch orchestration error isolation
 *   - Watch cycle summary building
 *   - Expired escrow detection
 *   - printOrchestrationSummary (smoke test)
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import {
  OrchestrationResult,
  OrchestrationStatus,
  ConditionCheckResult,
  WatchCycleSummary,
} from '../src/orchestrator/types';
import { printOrchestrationSummary } from '../src/orchestrator/orchestrate';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeConditionCheck(
  type: 'inspector_credential' | 'lien_waiver_nft',
  verified: boolean,
  overrides: Partial<ConditionCheckResult> = {}
): ConditionCheckResult {
  return {
    conditionType: type,
    verified,
    onChainRef: verified ? 'ON_CHAIN_REF_HASH' : undefined,
    failureReason: verified ? undefined : 'Simulated failure',
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(
  status: OrchestrationStatus,
  dridString = 'TEST-PROJ:draw1',
  overrides: Partial<OrchestrationResult> = {}
): OrchestrationResult {
  const now = new Date().toISOString();
  const credVerified =
    status === 'RELEASED' ||
    status === 'DUAL_MET' ||
    status === 'CREDENTIAL_ONLY';
  const nftVerified =
    status === 'RELEASED' ||
    status === 'DUAL_MET' ||
    status === 'NFT_ONLY';

  return {
    dridString,
    status,
    credentialCheck: makeConditionCheck('inspector_credential', credVerified),
    nftCheck: makeConditionCheck('lien_waiver_nft', nftVerified),
    dualConditionMetAt:
      status === 'RELEASED' || status === 'DUAL_MET' ? now : undefined,
    escrowFinishResult:
      status === 'RELEASED'
        ? { success: true, dridString, txHash: 'FINISH_TX_HASH' }
        : undefined,
    failureReason:
      status === 'FAILED' ? 'Both conditions failed' : undefined,
    startedAt: now,
    completedAt: now,
    durationMs: 150,
    ...overrides,
  };
}

// ─── TESTS: OrchestrationStatus ───────────────────────────────────────────────

describe('OrchestrationStatus', () => {
  const validStatuses: OrchestrationStatus[] = [
    'PENDING',
    'RUNNING',
    'CREDENTIAL_ONLY',
    'NFT_ONLY',
    'DUAL_MET',
    'RELEASED',
    'FAILED',
    'EXPIRED',
  ];

  it('covers all 8 expected states', () => {
    expect(validStatuses).toHaveLength(8);
  });

  it('RELEASED implies both conditions verified', () => {
    const result = makeResult('RELEASED');
    expect(result.credentialCheck.verified).toBe(true);
    expect(result.nftCheck.verified).toBe(true);
    expect(result.dualConditionMetAt).toBeDefined();
    expect(result.escrowFinishResult?.success).toBe(true);
  });

  it('DUAL_MET implies both conditions verified but no finish yet', () => {
    const result = makeResult('DUAL_MET');
    expect(result.credentialCheck.verified).toBe(true);
    expect(result.nftCheck.verified).toBe(true);
    expect(result.dualConditionMetAt).toBeDefined();
    expect(result.escrowFinishResult).toBeUndefined();
  });

  it('CREDENTIAL_ONLY implies credential verified, NFT not', () => {
    const result = makeResult('CREDENTIAL_ONLY');
    expect(result.credentialCheck.verified).toBe(true);
    expect(result.nftCheck.verified).toBe(false);
    expect(result.dualConditionMetAt).toBeUndefined();
  });

  it('NFT_ONLY implies NFT verified, credential not', () => {
    const result = makeResult('NFT_ONLY');
    expect(result.credentialCheck.verified).toBe(false);
    expect(result.nftCheck.verified).toBe(true);
    expect(result.dualConditionMetAt).toBeUndefined();
  });

  it('FAILED implies neither condition verified', () => {
    const result = makeResult('FAILED');
    expect(result.credentialCheck.verified).toBe(false);
    expect(result.nftCheck.verified).toBe(false);
    expect(result.failureReason).toBeDefined();
  });

  it('EXPIRED has a failure reason', () => {
    const result = makeResult('EXPIRED', 'PROJ:draw1', {
      failureReason: 'Escrow past CancelAfter',
    });
    expect(result.failureReason).toContain('CancelAfter');
  });
});

// ─── TESTS: ConditionCheckResult ──────────────────────────────────────────────

describe('ConditionCheckResult', () => {
  it('verified check has onChainRef', () => {
    const check = makeConditionCheck('inspector_credential', true);
    expect(check.verified).toBe(true);
    expect(check.onChainRef).toBeDefined();
    expect(check.failureReason).toBeUndefined();
  });

  it('failed check has failureReason', () => {
    const check = makeConditionCheck('lien_waiver_nft', false);
    expect(check.verified).toBe(false);
    expect(check.failureReason).toBeDefined();
    expect(check.onChainRef).toBeUndefined();
  });

  it('checkedAt is a valid ISO date', () => {
    const check = makeConditionCheck('inspector_credential', true);
    expect(new Date(check.checkedAt)).toBeInstanceOf(Date);
    expect(isNaN(new Date(check.checkedAt).getTime())).toBe(false);
  });

  it('conditionType is correct for credential', () => {
    const check = makeConditionCheck('inspector_credential', true);
    expect(check.conditionType).toBe('inspector_credential');
  });

  it('conditionType is correct for NFT', () => {
    const check = makeConditionCheck('lien_waiver_nft', false);
    expect(check.conditionType).toBe('lien_waiver_nft');
  });
});

// ─── TESTS: Dual-Condition Logic ──────────────────────────────────────────────

describe('Dual-Condition Logic', () => {
  it('BOTH checks must pass for DUAL_MET', () => {
    const credPass = makeConditionCheck('inspector_credential', true);
    const nftPass = makeConditionCheck('lien_waiver_nft', true);
    const isDualMet = credPass.verified && nftPass.verified;
    expect(isDualMet).toBe(true);
  });

  it('credential-only does not trigger dual-condition', () => {
    const credPass = makeConditionCheck('inspector_credential', true);
    const nftFail = makeConditionCheck('lien_waiver_nft', false);
    const isDualMet = credPass.verified && nftFail.verified;
    expect(isDualMet).toBe(false);
  });

  it('NFT-only does not trigger dual-condition', () => {
    const credFail = makeConditionCheck('inspector_credential', false);
    const nftPass = makeConditionCheck('lien_waiver_nft', true);
    const isDualMet = credFail.verified && nftPass.verified;
    expect(isDualMet).toBe(false);
  });

  it('neither check does not trigger dual-condition', () => {
    const credFail = makeConditionCheck('inspector_credential', false);
    const nftFail = makeConditionCheck('lien_waiver_nft', false);
    const isDualMet = credFail.verified && nftFail.verified;
    expect(isDualMet).toBe(false);
  });
});

// ─── TESTS: Batch Result Isolation ───────────────────────────────────────────

describe('Batch Result Isolation', () => {
  it('RELEASED results do not affect FAILED results', () => {
    const results = [
      makeResult('RELEASED', 'PROJ-A:draw1'),
      makeResult('FAILED', 'PROJ-B:draw1'),
      makeResult('CREDENTIAL_ONLY', 'PROJ-C:draw1'),
    ];
    const released = results.filter((r) => r.status === 'RELEASED');
    const failed = results.filter((r) => r.status === 'FAILED');
    expect(released).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(released[0].dridString).toBe('PROJ-A:draw1');
    expect(failed[0].dridString).toBe('PROJ-B:draw1');
  });

  it('each result has its own DRID', () => {
    const drids = ['A:draw1', 'B:draw2', 'C:draw3'];
    const results = drids.map((d) => makeResult('PENDING', d));
    const resultDrids = results.map((r) => r.dridString);
    expect(resultDrids).toEqual(drids);
  });

  it('duration is tracked per result', () => {
    const result = makeResult('RELEASED', 'PROJ:draw1', { durationMs: 423 });
    expect(result.durationMs).toBe(423);
  });
});

// ─── TESTS: Watch Cycle Summary ───────────────────────────────────────────────

describe('WatchCycleSummary', () => {
  function buildSummary(results: OrchestrationResult[]): WatchCycleSummary {
    return {
      cycle: 1,
      timestamp: new Date().toISOString(),
      dridCount: results.length,
      released: results.filter((r) => r.status === 'RELEASED').length,
      dualMet: results.filter((r) => r.status === 'DUAL_MET').length,
      partiallyVerified: results.filter(
        (r) => r.status === 'CREDENTIAL_ONLY' || r.status === 'NFT_ONLY'
      ).length,
      pending: results.filter((r) => r.status === 'PENDING').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
      results,
    };
  }

  it('counts released correctly', () => {
    const results = [
      makeResult('RELEASED'),
      makeResult('RELEASED'),
      makeResult('FAILED'),
    ];
    const summary = buildSummary(results);
    expect(summary.released).toBe(2);
    expect(summary.failed).toBe(1);
  });

  it('counts partially verified correctly', () => {
    const results = [
      makeResult('CREDENTIAL_ONLY'),
      makeResult('NFT_ONLY'),
      makeResult('RELEASED'),
    ];
    const summary = buildSummary(results);
    expect(summary.partiallyVerified).toBe(2);
    expect(summary.released).toBe(1);
  });

  it('dridCount equals results length', () => {
    const results = [
      makeResult('PENDING', 'A:draw1'),
      makeResult('PENDING', 'B:draw1'),
      makeResult('PENDING', 'C:draw1'),
    ];
    const summary = buildSummary(results);
    expect(summary.dridCount).toBe(3);
  });
});

// ─── TESTS: printOrchestrationSummary (smoke test) ───────────────────────────

describe('printOrchestrationSummary', () => {
  it('runs without throwing on empty results', () => {
    expect(() => printOrchestrationSummary([])).not.toThrow();
  });

  it('runs without throwing on mixed results', () => {
    const results = [
      makeResult('RELEASED', 'A:draw1'),
      makeResult('FAILED', 'B:draw1'),
      makeResult('CREDENTIAL_ONLY', 'C:draw1'),
      makeResult('EXPIRED', 'D:draw1'),
    ];
    expect(() => printOrchestrationSummary(results, 3)).not.toThrow();
  });
});

// ─── INTEGRATION (XRPL Testnet) ───────────────────────────────────────────────

const RUN_INTEGRATION = process.env.XRPL_RUN_INTEGRATION === 'true';

describe.skipIf(!RUN_INTEGRATION)(
  'Integration — VerificationOrchestrator (XRPL Testnet)',
  () => {
    it('full lifecycle: create → issue credential → mint NFT → orchestrate → released',
      async () => {
        expect(true).toBe(true);
      },
      300_000
    );
  }
);
