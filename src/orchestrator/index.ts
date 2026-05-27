/**
 * BuildChain Protocol — Verification Orchestrator (Module 4)
 *
 * Public API for the dual-condition orchestration engine.
 * This is the top-level controller that BuildChain's backend
 * calls to run the full verification + release pipeline.
 *
 * Two usage modes:
 *
 *   1. ONE-SHOT: orchestrate a specific DRID immediately
 *      const result = await orchestrator.run(input);
 *
 *   2. WATCH LOOP: poll all pending draws on an interval
 *      await orchestrator.watch({ intervalMs: 30_000 });
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Wallet } from 'xrpl';
import { EscrowEngine } from '../index';
import { CredentialEngine } from '../credentials/index';
import { LienWaiverNftEngine } from '../nfts/index';
import { DRIDString, EscrowRecord } from '../types';
import {
  OrchestrationInput,
  OrchestrationResult,
  WatchInput,
  WatchCycleSummary,
} from './types';
import {
  orchestrateDualCondition,
  orchestrateBatch,
  printOrchestrationSummary,
} from './orchestrate';

export class VerificationOrchestrator {
  private escrowEngine: EscrowEngine;
  private credentialEngine: CredentialEngine;
  private nftEngine: LienWaiverNftEngine;
  private protocolWallet: Wallet;
  private _watching: boolean = false;

  /**
   * @param escrowEngine       Module 1 — connected EscrowEngine
   * @param credentialEngine   Module 2 — CredentialEngine with trusted issuers
   * @param nftEngine          Module 3 — LienWaiverNftEngine
   * @param protocolWallet     BuildChain Protocol wallet (submits EscrowFinish)
   */
  constructor(
    escrowEngine: EscrowEngine,
    credentialEngine: CredentialEngine,
    nftEngine: LienWaiverNftEngine,
    protocolWallet: Wallet
  ) {
    this.escrowEngine = escrowEngine;
    this.credentialEngine = credentialEngine;
    this.nftEngine = nftEngine;
    this.protocolWallet = protocolWallet;

    console.log(`\n🎛️  VerificationOrchestrator initialized`);
    console.log(`   Protocol wallet: ${protocolWallet.address}`);
  }

  // ─── ONE-SHOT ORCHESTRATION ───────────────────────────────────────────────

  /**
   * Run the full dual-condition verification + EscrowFinish pipeline for one DRID.
   *
   * Steps:
   *   1. Verify Inspector Credential (Module 2) + Lien Waiver NFT (Module 3) in parallel
   *   2. Mark verified conditions on the EscrowRegistry
   *   3. If both pass AND autoFinish=true → submit EscrowFinish (Module 1)
   *
   * @param input  OrchestrationInput
   */
  async run(input: OrchestrationInput): Promise<OrchestrationResult> {
    return orchestrateDualCondition(
      this.escrowEngine,
      this.credentialEngine,
      this.nftEngine,
      this.protocolWallet,
      input
    );
  }

  /**
   * Run orchestration for multiple DRIDs in parallel.
   */
  async runBatch(inputs: OrchestrationInput[]): Promise<OrchestrationResult[]> {
    return orchestrateBatch(
      this.escrowEngine,
      this.credentialEngine,
      this.nftEngine,
      this.protocolWallet,
      inputs
    );
  }

  // ─── WATCH LOOP ───────────────────────────────────────────────────────────

  /**
   * Start a poll-based watch loop that continuously checks all pending draws.
   *
   * On each cycle:
   *   1. Fetch all FUNDED + PENDING_VERIFICATION draws from the registry
   *   2. Build orchestration inputs from draw party metadata
   *   3. Run batch orchestration
   *   4. Print cycle summary
   *   5. Call onCycle callback if provided
   *
   * Important: Caller must supply an `inspectorResolver` and `gcResolver`
   * so the orchestrator knows which inspector + GC addresses to check for
   * each DRID. Typically these come from BuildChain's off-chain project database.
   *
   * @param options           WatchInput options
   * @param partyResolver     Resolves (dridString) → { inspectorAddress, gcAddress }
   */
  async watch(
    options: WatchInput,
    partyResolver: (
      dridString: DRIDString
    ) => Promise<{ inspectorAddress: string; gcAddress: string } | null>
  ): Promise<void> {
    const intervalMs = options.intervalMs ?? 30_000;
    const maxCycles = options.maxCycles ?? Infinity;

    this._watching = true;
    let cycle = 0;

    console.log(`\n👁️  Orchestrator watch loop started`);
    console.log(`   Interval:   ${intervalMs}ms`);
    console.log(`   Max cycles: ${maxCycles === Infinity ? '∞' : maxCycles}`);

    while (this._watching && cycle < maxCycles) {
      cycle++;
      const cycleStart = new Date().toISOString();
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  Watch cycle #${cycle} — ${cycleStart}`);
      console.log('═'.repeat(60));

      try {
        // Fetch all draws that need verification
        const pendingDraws = [
          ...this.escrowEngine.getByStatus('FUNDED'),
          ...this.escrowEngine.getPendingVerification(),
          ...this.escrowEngine.getDualConditionMet(),
        ];

        // Filter to requested DRIDs if specified
        const draws = options.dridStrings
          ? pendingDraws.filter((r) => options.dridStrings!.includes(r.drid))
          : pendingDraws;

        console.log(`   Active draws: ${draws.length}`);

        if (draws.length === 0) {
          console.log(`   No draws pending verification.`);
        } else {
          // Resolve party addresses for each draw
          const inputs: OrchestrationInput[] = [];

          for (const draw of draws) {
            const parties = await partyResolver(draw.drid);
            if (!parties) {
              console.warn(`   ⚠️  Could not resolve parties for DRID: ${draw.drid} — skipping`);
              continue;
            }
            inputs.push({
              dridString: draw.drid,
              inspectorAddress: parties.inspectorAddress,
              gcAddress: parties.gcAddress,
              finisherAddress: this.protocolWallet.address,
              autoFinish: true,
            });
          }

          // Run batch orchestration
          const results = await orchestrateBatch(
            this.escrowEngine,
            this.credentialEngine,
            this.nftEngine,
            this.protocolWallet,
            inputs
          );

          // Build and emit cycle summary
          const summary = this.buildCycleSummary(cycle, cycleStart, results);
          printOrchestrationSummary(results, cycle);

          if (options.onCycle) {
            options.onCycle(results);
          }
        }
      } catch (error) {
        console.error(`   ❌ Watch cycle #${cycle} error: ${error}`);
      }

      // Wait for next cycle (unless this is the last one)
      if (this._watching && cycle < maxCycles) {
        await sleep(intervalMs);
      }
    }

    console.log(`\n👁️  Watch loop ended after ${cycle} cycle(s)`);
    this._watching = false;
  }

  /**
   * Stop the watch loop gracefully.
   */
  stopWatch(): void {
    console.log(`\n⏹️  Stopping orchestrator watch loop...`);
    this._watching = false;
  }

  get isWatching(): boolean {
    return this._watching;
  }

  // ─── CONVENIENCE METHODS ──────────────────────────────────────────────────

  /**
   * Print a formatted summary of a set of results.
   */
  printSummary(results: OrchestrationResult[], cycle?: number): void {
    printOrchestrationSummary(results, cycle);
  }

  /**
   * Get the count of draws that have both conditions met but not yet released.
   */
  getDualConditionPendingRelease(): EscrowRecord[] {
    return this.escrowEngine.getDualConditionMet();
  }

  // ─── PRIVATE ─────────────────────────────────────────────────────────────

  private buildCycleSummary(
    cycle: number,
    timestamp: string,
    results: OrchestrationResult[]
  ): WatchCycleSummary {
    return {
      cycle,
      timestamp,
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
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export types
export {
  OrchestrationInput,
  OrchestrationResult,
  OrchestrationStatus,
  WatchInput,
  WatchCycleSummary,
  ConditionCheckResult,
} from './types';
