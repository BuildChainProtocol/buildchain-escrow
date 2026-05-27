/**
 * BuildChain Protocol — Verification Orchestration Logic (Module 4)
 *
 * Core orchestration function that runs the dual-condition check for a DRID
 * and triggers EscrowFinish when both conditions are simultaneously verified.
 *
 * Execution model:
 *   1. Run credential check (Module 2) + NFT check (Module 3) in PARALLEL
 *   2. Mark each verified condition on the EscrowRegistry
 *   3. If BOTH verified → update status to DUAL_CONDITION_MET
 *   4. If autoFinish → submit EscrowFinish (Module 1)
 *   5. Return full OrchestrationResult with audit trail
 *
 * Security invariant:
 *   EscrowFinish is ONLY submitted when BOTH conditions return verified: true
 *   in the SAME orchestration run. Partial results from prior runs do not
 *   carry over to trigger a finish — the full dual-check must pass together.
 *   (Registry state from prior runs IS used to avoid redundant on-chain calls.)
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Wallet } from 'xrpl';
import { EscrowEngine } from '../index';
import { CredentialEngine } from '../credentials/index';
import { LienWaiverNftEngine } from '../nfts/index';
import {
  OrchestrationInput,
  OrchestrationResult,
  OrchestrationStatus,
  ConditionCheckResult,
} from './types';

// ─── CONDITION CHECKS ─────────────────────────────────────────────────────────

/**
 * Run the inspector credential check (Module 2).
 */
async function checkCredential(
  credentialEngine: CredentialEngine,
  dridString: string,
  inspectorAddress: string
): Promise<ConditionCheckResult> {
  const result = await credentialEngine.verifyCredential(dridString, inspectorAddress);

  return {
    conditionType: 'inspector_credential',
    verified: result.verified,
    onChainRef: result.credentialLedgerIndex,
    failureReason: result.failureReason,
    checkedAt: result.verifiedAt,
  };
}

/**
 * Run the lien waiver NFT check (Module 3).
 */
async function checkNft(
  nftEngine: LienWaiverNftEngine,
  dridString: string,
  gcAddress: string
): Promise<ConditionCheckResult> {
  const result = await nftEngine.verifyNft(dridString, gcAddress);

  return {
    conditionType: 'lien_waiver_nft',
    verified: result.verified,
    onChainRef: result.nfTokenId,
    failureReason: result.failureReason,
    checkedAt: result.verifiedAt,
  };
}

// ─── MAIN ORCHESTRATION FUNCTION ──────────────────────────────────────────────

/**
 * Orchestrate dual-condition verification for a single DRID.
 *
 * Runs both on-chain checks in parallel, marks verified conditions on the
 * registry, and submits EscrowFinish when both conditions pass.
 *
 * @param escrowEngine       Module 1 — EscrowEngine
 * @param credentialEngine   Module 2 — CredentialEngine
 * @param nftEngine          Module 3 — LienWaiverNftEngine
 * @param protocolWallet     BuildChain Protocol wallet (submits EscrowFinish)
 * @param input              OrchestrationInput
 */
export async function orchestrateDualCondition(
  escrowEngine: EscrowEngine,
  credentialEngine: CredentialEngine,
  nftEngine: LienWaiverNftEngine,
  protocolWallet: Wallet,
  input: OrchestrationInput
): Promise<OrchestrationResult> {
  const { dridString, inspectorAddress, gcAddress, finisherAddress } = input;
  const autoFinish = input.autoFinish !== false; // default true
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🎯 Orchestrating dual-condition — DRID: ${dridString}`);
  console.log(`   Inspector: ${inspectorAddress}`);
  console.log(`   GC:        ${gcAddress}`);
  console.log(`   Finisher:  ${finisherAddress}`);
  console.log(`   Auto-finish: ${autoFinish}`);

  // ── 0. Check current registry state ───────────────────────────────────────
  // If already released or cancelled, skip all checks
  const existingRecord = escrowEngine.getRecord(dridString);

  if (!existingRecord) {
    const completedAt = new Date().toISOString();
    return {
      dridString,
      status: 'FAILED',
      credentialCheck: makeSkippedCheck('inspector_credential', 'DRID not found in registry'),
      nftCheck: makeSkippedCheck('lien_waiver_nft', 'DRID not found in registry'),
      failureReason: `DRID "${dridString}" not found in registry`,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    };
  }

  if (existingRecord.status === 'RELEASED') {
    const completedAt = new Date().toISOString();
    console.log(`   ℹ️  Escrow already RELEASED — skipping`);
    return {
      dridString,
      status: 'RELEASED',
      credentialCheck: makeSkippedCheck('inspector_credential', 'Already released'),
      nftCheck: makeSkippedCheck('lien_waiver_nft', 'Already released'),
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    };
  }

  if (existingRecord.status === 'CANCELLED' || existingRecord.status === 'EXPIRED') {
    const completedAt = new Date().toISOString();
    console.log(`   ⚠️  Escrow ${existingRecord.status} — skipping`);
    return {
      dridString,
      status: 'EXPIRED',
      credentialCheck: makeSkippedCheck('inspector_credential', `Escrow ${existingRecord.status}`),
      nftCheck: makeSkippedCheck('lien_waiver_nft', `Escrow ${existingRecord.status}`),
      failureReason: `Escrow is ${existingRecord.status}`,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    };
  }

  // Check if CancelAfter has passed
  if (new Date() > new Date(existingRecord.cancelAfter)) {
    const completedAt = new Date().toISOString();
    console.log(`   ⏰ Escrow past CancelAfter — marking EXPIRED`);
    return {
      dridString,
      status: 'EXPIRED',
      credentialCheck: makeSkippedCheck('inspector_credential', 'Escrow past CancelAfter'),
      nftCheck: makeSkippedCheck('lien_waiver_nft', 'Escrow past CancelAfter'),
      failureReason: `Escrow past CancelAfter (${existingRecord.cancelAfter})`,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    };
  }

  // ── 1. Run both checks in PARALLEL ────────────────────────────────────────
  console.log(`\n   Running dual-condition checks in parallel...`);

  const [credentialCheck, nftCheck] = await Promise.all([
    checkCredential(credentialEngine, dridString, inspectorAddress),
    checkNft(nftEngine, dridString, gcAddress),
  ]);

  console.log(`\n   Credential check: ${credentialCheck.verified ? '✅ PASSED' : '❌ FAILED'}`);
  if (credentialCheck.onChainRef) {
    console.log(`   Credential ref:   ${credentialCheck.onChainRef}`);
  }
  if (credentialCheck.failureReason) {
    console.log(`   Credential fail:  ${credentialCheck.failureReason}`);
  }

  console.log(`   NFT check:        ${nftCheck.verified ? '✅ PASSED' : '❌ FAILED'}`);
  if (nftCheck.onChainRef) {
    console.log(`   NFT ref:          ${nftCheck.onChainRef}`);
  }
  if (nftCheck.failureReason) {
    console.log(`   NFT fail:         ${nftCheck.failureReason}`);
  }

  // ── 2. Mark verified conditions on the registry ───────────────────────────
  if (credentialCheck.verified) {
    escrowEngine.markInspectorCredentialVerified(
      dridString,
      credentialCheck.onChainRef || `verified-at-${credentialCheck.checkedAt}`
    );
  }

  if (nftCheck.verified) {
    escrowEngine.markLienWaiverNftVerified(
      dridString,
      nftCheck.onChainRef || `verified-at-${nftCheck.checkedAt}`
    );
  }

  const completedAt = new Date().toISOString();

  // ── 3. Handle partial verification ────────────────────────────────────────
  if (!credentialCheck.verified && !nftCheck.verified) {
    console.log(`\n   Both checks FAILED — escrow remains in ${existingRecord.status}`);
    return {
      dridString,
      status: 'FAILED',
      credentialCheck,
      nftCheck,
      failureReason: [
        credentialCheck.failureReason && `Credential: ${credentialCheck.failureReason}`,
        nftCheck.failureReason && `NFT: ${nftCheck.failureReason}`,
      ].filter(Boolean).join(' | '),
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    };
  }

  if (credentialCheck.verified && !nftCheck.verified) {
    console.log(`\n   ⏳ Credential verified — waiting on Lien Waiver NFT`);
    return {
      dridString,
      status: 'CREDENTIAL_ONLY',
      credentialCheck,
      nftCheck,
      failureReason: `Lien Waiver NFT not yet verified: ${nftCheck.failureReason}`,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    };
  }

  if (!credentialCheck.verified && nftCheck.verified) {
    console.log(`\n   ⏳ NFT verified — waiting on Inspector Credential`);
    return {
      dridString,
      status: 'NFT_ONLY',
      credentialCheck,
      nftCheck,
      failureReason: `Inspector Credential not yet verified: ${credentialCheck.failureReason}`,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
    };
  }

  // ── 4. DUAL CONDITION MET ─────────────────────────────────────────────────
  const dualConditionMetAt = new Date().toISOString();
  console.log(`\n   🎯 DUAL-CONDITION MET — both checks passed!`);
  console.log(`   Met at: ${dualConditionMetAt}`);

  // ── 5. Auto-finish: submit EscrowFinish ───────────────────────────────────
  if (!autoFinish) {
    const finishedAt = new Date().toISOString();
    return {
      dridString,
      status: 'DUAL_MET',
      credentialCheck,
      nftCheck,
      dualConditionMetAt,
      startedAt,
      completedAt: finishedAt,
      durationMs: Date.now() - startMs,
    };
  }

  console.log(`\n   🔓 Auto-finishing escrow...`);

  const finishResult = await escrowEngine.finishEscrow(
    {
      dridString,
      finisherAddress,
    },
    protocolWallet
  );

  const finalCompletedAt = new Date().toISOString();
  const finalStatus: OrchestrationStatus = finishResult.success ? 'RELEASED' : 'FAILED';

  if (finishResult.success) {
    console.log(`\n   ✅ ESCROW RELEASED — funds sent to GC`);
    console.log(`   TX Hash: ${finishResult.txHash}`);
  } else {
    console.log(`\n   ❌ EscrowFinish FAILED: ${finishResult.error}`);
  }

  return {
    dridString,
    status: finalStatus,
    credentialCheck,
    nftCheck,
    dualConditionMetAt,
    escrowFinishResult: finishResult,
    failureReason: finishResult.success ? undefined : finishResult.error,
    startedAt,
    completedAt: finalCompletedAt,
    durationMs: Date.now() - startMs,
  };
}

// ─── BATCH ORCHESTRATION ─────────────────────────────────────────────────────

/**
 * Run orchestration for multiple DRIDs in parallel.
 * Each DRID is checked independently; failures do not block other draws.
 *
 * @param escrowEngine       Module 1
 * @param credentialEngine   Module 2
 * @param nftEngine          Module 3
 * @param protocolWallet     BuildChain Protocol wallet
 * @param inputs             Array of OrchestrationInput (one per DRID)
 */
export async function orchestrateBatch(
  escrowEngine: EscrowEngine,
  credentialEngine: CredentialEngine,
  nftEngine: LienWaiverNftEngine,
  protocolWallet: Wallet,
  inputs: OrchestrationInput[]
): Promise<OrchestrationResult[]> {
  console.log(`\n📦 Batch orchestration — ${inputs.length} DRID(s)`);

  const results = await Promise.allSettled(
    inputs.map((input) =>
      orchestrateDualCondition(
        escrowEngine,
        credentialEngine,
        nftEngine,
        protocolWallet,
        input
      )
    )
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;

    // Wrap unexpected errors in a FAILED result
    const input = inputs[i];
    const now = new Date().toISOString();
    return {
      dridString: input.dridString,
      status: 'FAILED' as OrchestrationStatus,
      credentialCheck: makeSkippedCheck('inspector_credential', String(r.reason)),
      nftCheck: makeSkippedCheck('lien_waiver_nft', String(r.reason)),
      failureReason: `Unexpected error: ${r.reason}`,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    };
  });
}

// ─── SUMMARY PRINTER ─────────────────────────────────────────────────────────

/**
 * Print a human-readable summary of a batch orchestration run.
 */
export function printOrchestrationSummary(
  results: OrchestrationResult[],
  cycle?: number
): void {
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
  }

  const label = cycle !== undefined ? `Cycle #${cycle}` : 'Summary';
  console.log(`\n📊 Orchestration ${label} — ${results.length} DRID(s)`);
  console.log(`   Released:            ${counts['RELEASED'] || 0}`);
  console.log(`   Dual condition met:  ${counts['DUAL_MET'] || 0}`);
  console.log(`   Credential only:     ${counts['CREDENTIAL_ONLY'] || 0}`);
  console.log(`   NFT only:            ${counts['NFT_ONLY'] || 0}`);
  console.log(`   Failed:              ${counts['FAILED'] || 0}`);
  console.log(`   Expired:             ${counts['EXPIRED'] || 0}`);
  console.log(`   Skipped/Pending:     ${counts['PENDING'] || 0}`);

  for (const r of results) {
    const icon =
      r.status === 'RELEASED' ? '✅' :
      r.status === 'DUAL_MET' ? '🎯' :
      r.status === 'CREDENTIAL_ONLY' || r.status === 'NFT_ONLY' ? '⏳' :
      r.status === 'EXPIRED' ? '⏰' : '❌';
    console.log(
      `   ${icon} ${r.dridString.padEnd(32)} → ${r.status} (${r.durationMs}ms)`
    );
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeSkippedCheck(
  type: 'inspector_credential' | 'lien_waiver_nft',
  reason: string
): ConditionCheckResult {
  return {
    conditionType: type,
    verified: false,
    failureReason: reason,
    checkedAt: new Date().toISOString(),
  };
}
