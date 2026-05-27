/**
 * BuildChain Protocol — Audit Trail Types (Module 6)
 *
 * Defines the full audit data model for a BuildChain escrow lifecycle.
 * Every on-chain transaction, off-chain verification, and status transition
 * is recorded with timestamps and XRPL explorer links.
 *
 * Designed for:
 *   - Lender dashboard display (current status + history)
 *   - Regulatory / legal audit export (JSON + PDF-ready text)
 *   - Dispute resolution (complete chronological evidence chain)
 *   - GC payment confirmation receipts
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { DRIDString, EscrowRecord, EscrowStatus } from '../types';

// ─── AUDIT EVENT TYPES ────────────────────────────────────────────────────────

export type AuditEventType =
  | 'ESCROW_CREATED'
  | 'VERIFICATION_STARTED'
  | 'CREDENTIAL_VERIFIED'
  | 'CREDENTIAL_FAILED'
  | 'NFT_VERIFIED'
  | 'NFT_FAILED'
  | 'DUAL_CONDITION_MET'
  | 'ESCROW_RELEASED'
  | 'ESCROW_CANCELLED'
  | 'ESCROW_EXPIRED'
  | 'SETTLEMENT_INITIATED'
  | 'SETTLEMENT_COMPLETED'
  | 'SETTLEMENT_FAILED'
  | 'STATUS_CHANGE';

// ─── AUDIT EVENT ─────────────────────────────────────────────────────────────

/**
 * A single timestamped event in the audit trail.
 */
export interface AuditEvent {
  /** Sequential event number within this DRID's trail */
  sequence: number;
  /** Event type */
  type: AuditEventType;
  /** Human-readable description */
  description: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** On-chain TX hash (if event has an on-chain anchor) */
  txHash?: string;
  /** XRPL explorer link for the TX */
  explorerUrl?: string;
  /** On-chain reference (e.g. credential ledger index, NFTokenID) */
  onChainRef?: string;
  /** XRPL address involved in this event */
  actor?: string;
  /** Previous escrow status (for STATUS_CHANGE events) */
  fromStatus?: EscrowStatus;
  /** New escrow status (for STATUS_CHANGE events) */
  toStatus?: EscrowStatus;
  /** Additional key-value metadata */
  metadata?: Record<string, string>;
}

// ─── AUDIT TRAIL ─────────────────────────────────────────────────────────────

/**
 * Complete audit trail for a single DRID.
 */
export interface AuditTrail {
  /** DRID this trail covers */
  dridString: DRIDString;
  /** Project ID */
  projectId: string;
  /** Draw number */
  drawNumber: number;
  /** Milestone description */
  milestoneDescription: string;
  /** Current escrow status */
  currentStatus: EscrowStatus;
  /** All events in chronological order */
  events: AuditEvent[];
  /** Total number of events */
  eventCount: number;
  /** Timestamp of first event (escrow creation) */
  createdAt: string;
  /** Timestamp of last event */
  lastUpdatedAt: string;
  /** EscrowCreate TX hash */
  createTxHash?: string;
  /** EscrowFinish TX hash (if released) */
  finishTxHash?: string;
  /** EscrowCancel TX hash (if cancelled) */
  cancelTxHash?: string;
  /** Inspector credential ledger index */
  credentialLedgerIndex?: string;
  /** Lien waiver NFTokenID */
  nfTokenId?: string;
  /** Settlement TX hash (if settled) */
  settlementTxHash?: string;
  /** XRPL network */
  network: 'testnet' | 'mainnet';
}

// ─── LENDER DASHBOARD ────────────────────────────────────────────────────────

/**
 * Lender-facing draw summary for a single DRID.
 */
export interface DrawSummary {
  dridString: DRIDString;
  projectId: string;
  drawNumber: number;
  milestoneDescription: string;
  status: EscrowStatus;
  statusLabel: string;
  amountXrp: string;
  amountDrops: string;
  lenderAddress: string;
  gcAddress: string;
  finishAfter: string;
  cancelAfter: string;
  timeRemainingSeconds: number;
  timeRemainingLabel: string;
  onChainConfirmed: boolean;
  inspectorCredentialVerified: boolean;
  lienWaiverNftVerified: boolean;
  dualConditionMet: boolean;
  createTxHash?: string;
  finishTxHash?: string;
  cancelTxHash?: string;
  explorerLinks: {
    create?: string;
    finish?: string;
    cancel?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Lender dashboard — full project view across all draws.
 */
export interface ProjectDashboard {
  projectId: string;
  generatedAt: string;
  network: 'testnet' | 'mainnet';
  /** Aggregate stats */
  stats: {
    totalDraws: number;
    totalAmountXrp: number;
    releasedDraws: number;
    releasedAmountXrp: number;
    pendingDraws: number;
    pendingAmountXrp: number;
    cancelledDraws: number;
    expiredDraws: number;
  };
  /** Per-draw summaries */
  draws: DrawSummary[];
}

// ─── REPORT FORMATS ───────────────────────────────────────────────────────────

/**
 * Options for report generation.
 */
export interface ReportOptions {
  /** Include full event log (default: true) */
  includeEvents?: boolean;
  /** Include explorer links (default: true) */
  includeExplorerLinks?: boolean;
  /** Network for building explorer URLs */
  network?: 'testnet' | 'mainnet';
  /** Output format */
  format?: 'json' | 'text';
}
