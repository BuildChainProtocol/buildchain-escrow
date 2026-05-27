/**
 * BuildChain Protocol — Inspector Credential Types (Module 2)
 *
 * Type definitions for XLS-0070 on-chain Verifiable Credentials.
 * The Inspector Credential is issued by a trusted inspection authority
 * to a licensed inspector's XRPL account after a construction inspection
 * is complete and the draw request (DRID) is approved.
 *
 * XLS-0070 Credential Ledger Object fields:
 *   Account         — Issuer address (inspection authority)
 *   Subject         — Inspector's XRPL address
 *   CredentialType  — Hex-encoded type string (e.g. "BuildChain-Inspector")
 *   URI             — Off-chain credential data URL (contains DRID + report hash)
 *   Expiration      — Optional Ripple epoch expiry time
 *   Flags           — lsfAccepted (0x00010000) set after inspector accepts
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { DRIDString } from '../types';

// ─── CREDENTIAL TYPE CONSTANTS ────────────────────────────────────────────────

/**
 * Canonical BuildChain credential type strings.
 * These are the plain-text values; on-chain they are hex-encoded.
 */
export const CREDENTIAL_TYPES = {
  /** Inspector passes construction draw inspection for a specific milestone */
  INSPECTOR: 'BuildChain-Inspector-v1',
} as const;

export type CredentialType = typeof CREDENTIAL_TYPES[keyof typeof CREDENTIAL_TYPES];

/** XRPL lsfAccepted flag — set when subject calls CredentialAccept */
export const LSF_ACCEPTED = 0x00010000;

// ─── ON-CHAIN CREDENTIAL OBJECT ──────────────────────────────────────────────

/**
 * Raw XLS-0070 Credential ledger object as returned by account_objects.
 */
export interface XrplCredentialObject {
  LedgerEntryType: 'Credential';
  Account: string;           // Issuer address
  Subject: string;           // Inspector XRPL address
  CredentialType: string;    // Hex-encoded credential type
  URI?: string;              // Hex-encoded URI to off-chain credential data
  Expiration?: number;       // Ripple epoch time
  Flags: number;             // lsfAccepted flag
  LedgerIndex: string;       // Unique ledger object ID
  index?: string;
}

// ─── BUILDCHAIN CREDENTIAL PAYLOAD ───────────────────────────────────────────

/**
 * Structured data encoded in the credential URI (JSON, typically IPFS or HTTPS).
 * This is the off-chain payload that the URI field points to.
 */
export interface CredentialUriPayload {
  /** Protocol version */
  version: string;
  /** DRID this inspection covers */
  drid: DRIDString;
  /** XRPL address of the inspector who performed the inspection */
  inspectorAddress: string;
  /** License number of the inspector (from issuing authority records) */
  inspectorLicenseNumber: string;
  /** Human-readable milestone description */
  milestoneDescription: string;
  /** Date of physical inspection (ISO 8601) */
  inspectionDate: string;
  /** SHA-256 hash of the inspection report PDF */
  reportHash: string;
  /** URL or IPFS CID of the inspection report */
  reportUrl: string;
  /** Issuing authority name */
  issuerName: string;
  /** Date credential was issued (ISO 8601) */
  issuedAt: string;
}

// ─── VERIFICATION INPUTS / RESULTS ───────────────────────────────────────────

/**
 * Input to verify an inspector credential for a given DRID.
 */
export interface VerifyCredentialInput {
  /** DRID to verify inspection for */
  dridString: DRIDString;
  /** XRPL address of the inspector */
  inspectorAddress: string;
  /** Set of trusted issuer addresses (inspection authorities) */
  trustedIssuers: string[];
  /** If true, also fetch and validate the off-chain URI payload */
  validateUriPayload?: boolean;
}

/**
 * Result of credential verification.
 */
export interface VerifyCredentialResult {
  /** Whether verification passed all checks */
  verified: boolean;
  /** DRID this result covers */
  dridString: DRIDString;
  /** Inspector XRPL address */
  inspectorAddress: string;
  /** The on-chain credential object (if found) */
  credentialObject?: XrplCredentialObject;
  /** On-chain ledger index of the credential */
  credentialLedgerIndex?: string;
  /** TX hash that created the credential (CredentialCreate) */
  credentialTxHash?: string;
  /** Parsed off-chain URI payload (if fetched) */
  uriPayload?: CredentialUriPayload;
  /** Human-readable failure reason (if verified === false) */
  failureReason?: string;
  /** Timestamp of verification check */
  verifiedAt: string;
}

// ─── ISSUANCE INPUTS / RESULTS ───────────────────────────────────────────────

/**
 * Input to issue a new inspector credential on-chain.
 * Called by the BuildChain Protocol after an inspection authority
 * submits a signed inspection approval.
 */
export interface IssueCredentialInput {
  /** DRID this credential covers */
  dridString: DRIDString;
  /** XRPL address of the inspector receiving the credential */
  inspectorAddress: string;
  /** Structured payload to encode in the URI field */
  payload: CredentialUriPayload;
  /**
   * Optional credential expiry. Defaults to 1 year from issuance.
   * After expiry the credential is invalid even if on-chain.
   */
  expiryDate?: Date;
}

/**
 * Result of credential issuance.
 */
export interface IssueCredentialResult {
  success: boolean;
  dridString: DRIDString;
  /** On-chain TX hash of the CredentialCreate transaction */
  txHash?: string;
  /** Ledger index of the created Credential object */
  credentialLedgerIndex?: string;
  error?: string;
}
