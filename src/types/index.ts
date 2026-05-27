/**
 * BuildChain Protocol — Module 1: Smart Escrow Engine
 * Core TypeScript Types and Interfaces
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

// ─── DRAW REQUEST IDENTIFIER ─────────────────────────────────────────────────

/**
 * Draw Request ID (DRID) — the unique identifier that links all on-chain
 * events for a single construction draw: escrow, inspector credential,
 * lien waiver NFT, and disbursement.
 */
export interface DrawRequestId {
  projectId: string;           // Unique project identifier
  drawNumber: number;          // Sequential draw number for this project
  milestoneDescription: string; // Human-readable milestone (e.g., "Foundation Complete")
}

/**
 * Serialized DRID — used as a single string key in the registry
 * Format: {projectId}:draw{drawNumber}
 */
export type DRIDString = string;

export function serializeDRID(drid: DrawRequestId): DRIDString {
  return `${drid.projectId}:draw${drid.drawNumber}`;
}

export function parseDRID(dridStr: DRIDString): Pick<DrawRequestId, 'projectId' | 'drawNumber'> {
  const [projectId, drawPart] = dridStr.split(':');
  const drawNumber = parseInt(drawPart.replace('draw', ''), 10);
  return { projectId, drawNumber };
}

// ─── ESCROW PARTIES ──────────────────────────────────────────────────────────

export interface EscrowParties {
  lenderAddress: string;    // XRPL account that creates and funds the escrow
  gcAddress: string;        // General Contractor — receives funds upon release
}

// ─── ESCROW CONDITIONS ───────────────────────────────────────────────────────

export interface EscrowTimeConditions {
  /**
   * Earliest time the escrow can be finished (EscrowFinish).
   * Typically set to 1 hour after creation to allow for processing.
   */
  finishAfter: Date;

  /**
   * Latest time — escrow is cancelled (EscrowCancel) if not finished before this.
   * Typically 90 days from creation per BuildChain protocol default.
   */
  cancelAfter: Date;
}

/**
 * Dual verification conditions — tracked off-chain by the Verification Orchestrator (Module 4).
 * Both must be TRUE before EscrowFinish is authorized.
 */
export interface VerificationConditions {
  inspectorCredentialVerified: boolean;   // XLS-0070 credential confirmed on-ledger
  lienWaiverNftVerified: boolean;         // XLS-20 NFT confirmed on-ledger
  inspectorCredentialTxHash?: string;     // XRPL transaction hash of credential issuance
  lienWaiverNftTxHash?: string;           // XRPL transaction hash of NFT transfer
  verifiedAt?: string;                    // ISO timestamp when dual-condition was met
}

// ─── ESCROW RECORD ───────────────────────────────────────────────────────────

export type EscrowStatus =
  | 'FUNDED'               // Escrow created, funds locked
  | 'PENDING_VERIFICATION' // Awaiting inspector credential + lien waiver NFT
  | 'DUAL_CONDITION_MET'   // Both conditions verified — awaiting EscrowFinish tx
  | 'RELEASED'             // EscrowFinish executed — funds disbursed to GC
  | 'CANCELLED'            // EscrowCancel executed — funds returned to lender
  | 'EXPIRED';             // CancelAfter passed — funds returned to lender

/**
 * EscrowRecord — the full state of a single draw escrow.
 * Stored in the DRID registry and updated as conditions are met.
 */
export interface EscrowRecord {
  // Identity
  drid: DRIDString;
  projectId: string;
  drawNumber: number;
  milestoneDescription: string;

  // Parties
  lenderAddress: string;
  gcAddress: string;

  // Financial
  amountDrops: string;          // XRP drops (1 XRP = 1,000,000 drops)
  amountXrp: string;            // Human-readable XRP amount
  protocolFeeDrops?: string;    // Protocol fee (0.30%) deducted at release

  // Time conditions
  finishAfter: string;          // ISO 8601 datetime
  cancelAfter: string;          // ISO 8601 datetime

  // XRPL on-chain references
  escrowSequence: number;       // Sequence number of the EscrowCreate tx
  createTxHash?: string;        // EscrowCreate transaction hash
  finishTxHash?: string;        // EscrowFinish transaction hash
  cancelTxHash?: string;        // EscrowCancel transaction hash

  // Verification state (updated by Module 4 — Orchestrator)
  verificationConditions: VerificationConditions;

  // Status tracking
  status: EscrowStatus;
  createdAt: string;            // ISO 8601
  updatedAt: string;            // ISO 8601
}

// ─── ENGINE INPUT/OUTPUT TYPES ────────────────────────────────────────────────

export interface CreateEscrowInput {
  drid: DrawRequestId;
  parties: EscrowParties;
  amountXrp: number;            // Draw amount in XRP
  timeConditions?: Partial<EscrowTimeConditions>;  // Defaults applied if not provided
}

export interface CreateEscrowResult {
  success: boolean;
  dridString: DRIDString;
  record: EscrowRecord;
  txHash: string;
  error?: string;
}

export interface FinishEscrowInput {
  dridString: DRIDString;
  finisherAddress: string;      // Protocol wallet that submits EscrowFinish
}

export interface FinishEscrowResult {
  success: boolean;
  dridString: DRIDString;
  txHash?: string;
  amountReleasedDrops?: string;
  protocolFeeDrops?: string;
  error?: string;
}

export interface CancelEscrowInput {
  dridString: DRIDString;
  reason: 'EXPIRED' | 'VERIFICATION_FAILED' | 'LENDER_REQUESTED';
}

export interface CancelEscrowResult {
  success: boolean;
  dridString: DRIDString;
  txHash?: string;
  error?: string;
}

export interface EscrowStatusResult {
  dridString: DRIDString;
  status: EscrowStatus;
  record: EscrowRecord;
  onChainConfirmed: boolean;
  timeRemaining?: number;       // Seconds until CancelAfter
}

// ─── PROTOCOL CONFIG ─────────────────────────────────────────────────────────

export interface ProtocolConfig {
  network: 'testnet' | 'mainnet';
  serverUrl: string;
  defaultFinishAfterHours: number;
  defaultCancelAfterDays: number;
  protocolFeeBps: number;       // Basis points (30 = 0.30%)
  registryPath: string;
}
