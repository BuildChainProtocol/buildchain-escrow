/**
 * BuildChain Protocol — Verification Orchestrator Types (Module 4)
 *
 * The Orchestrator is the decision engine that connects all modules:
 *
 *   Module 2 (Inspector Credential) ──┐
 *                                      ├─→ Dual-condition met → EscrowFinish
 *   Module 3 (Lien Waiver NFT)    ──┘
 *
 * It runs both verification checks in parallel, marks conditions on the
 * EscrowRegistry, and fires EscrowFinish only when BOTH pass simultaneously.
 *
 * Orchestration states:
 *   PENDING          — not yet run or waiting for conditions
 *   RUNNING          — currently executing checks
 *   CREDENTIAL_ONLY  — only inspector credential verified (waiting on NFT)
 *   NFT_ONLY         — only lien waiver NFT verified (waiting on credential)
 *   DUAL_MET         — both conditions verified; EscrowFinish submitted
 *   RELEASED         — EscrowFinish confirmed on-chain (funds released to GC)
 *   FAILED           — verification failed (see failureReason)
 *   EXPIRED          — escrow passed CancelAfter before dual-condition met
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { DRIDString } from '../types';
import { VerifyCredentialResult } from '../credentials/types';
import { VerifyLienWaiverResult } from '../nfts/types';
import { FinishEscrowResult } from '../types';

// ─── ORCHESTRATION STATUS ─────────────────────────────────────────────────────

export type OrchestrationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'CREDENTIAL_ONLY'
  | 'NFT_ONLY'
  | 'DUAL_MET'
  | 'RELEASED'
  | 'FAILED'
  | 'EXPIRED';

// ─── INPUTS ───────────────────────────────────────────────────────────────────

/**
 * Input for a single orchestration run against one DRID.
 */
export interface OrchestrationInput {
  /** DRID to orchestrate */
  dridString: DRIDString;
  /** Inspector's XRPL address — used for credential lookup (Module 2) */
  inspectorAddress: string;
  /** GC's XRPL address — used for NFT lookup (Module 3) */
  gcAddress: string;
  /**
   * XRPL address that will submit the EscrowFinish transaction.
   * Should be the BuildChain Protocol wallet.
   */
  finisherAddress: string;
  /**
   * If true, attempt to auto-finish the escrow immediately after
   * both conditions are verified. Default: true.
   */
  autoFinish?: boolean;
}

/**
 * Input for the poll-based watch loop.
 * Watches a set of DRIDs and orchestrates them as conditions are met.
 */
export interface WatchInput {
  /** DRIDs to watch. If empty, watches all FUNDED/PENDING_VERIFICATION draws. */
  dridStrings?: DRIDString[];
  /**
   * Polling interval in milliseconds.
   * Default: 30,000 (30 seconds).
   */
  intervalMs?: number;
  /**
   * Max number of poll cycles before stopping.
   * Default: Infinity (runs until stopped).
   */
  maxCycles?: number;
  /** Callback invoked after each cycle with per-DRID results. */
  onCycle?: (results: OrchestrationResult[]) => void;
}

// ─── CHECK RESULTS ────────────────────────────────────────────────────────────

/**
 * Result of checking one verification condition (credential or NFT).
 */
export interface ConditionCheckResult {
  conditionType: 'inspector_credential' | 'lien_waiver_nft';
  verified: boolean;
  /** On-chain reference (ledger index for credential, NFTokenID for NFT) */
  onChainRef?: string;
  failureReason?: string;
  checkedAt: string;
}

// ─── ORCHESTRATION RESULT ─────────────────────────────────────────────────────

/**
 * Full result of one orchestration run for a single DRID.
 */
export interface OrchestrationResult {
  dridString: DRIDString;
  status: OrchestrationStatus;

  /** Inspector credential check result */
  credentialCheck: ConditionCheckResult;
  /** Lien waiver NFT check result */
  nftCheck: ConditionCheckResult;

  /** Set when dual-condition is confirmed */
  dualConditionMetAt?: string;

  /** EscrowFinish result (present when status is RELEASED or DUAL_MET) */
  escrowFinishResult?: FinishEscrowResult;

  /** Overall failure reason (present when status is FAILED or EXPIRED) */
  failureReason?: string;

  /** Wall-clock time the orchestration run started */
  startedAt: string;
  /** Wall-clock time the orchestration run completed */
  completedAt: string;
  /** Total duration in milliseconds */
  durationMs: number;
}

// ─── WATCH CYCLE SUMMARY ─────────────────────────────────────────────────────

/**
 * Summary emitted at the end of each poll cycle.
 */
export interface WatchCycleSummary {
  cycle: number;
  timestamp: string;
  dridCount: number;
  released: number;
  dualMet: number;
  partiallyVerified: number;
  pending: number;
  failed: number;
  results: OrchestrationResult[];
}
