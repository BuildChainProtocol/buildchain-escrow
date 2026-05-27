/**
 * BuildChain Protocol — Lien Waiver NFT Types (Module 3)
 *
 * Type definitions for XLS-20 on-chain Lien Waiver NFTs.
 *
 * A Lien Waiver NFT is minted by the General Contractor (GC) on their
 * XRPL account as a cryptographic receipt that they have waived their
 * lien rights for a specific draw milestone (DRID). The NFT is held
 * by the GC throughout the escrow lifecycle.
 *
 * XLS-20 NFToken fields relevant to BuildChain:
 *   NFTokenID      — 256-bit unique ID (flags + fee + issuer + taxon + seq)
 *   Issuer         — GC's XRPL address (minter)
 *   URI            — Hex-encoded JSON payload (DRID + document hash + metadata)
 *   NFTokenTaxon   — BuildChain-specific taxon for NFT filtering
 *   Flags          — tfBurnable allows burn-on-release; NOT tfTransferable (non-tradeable)
 *   TransferFee    — 0 (no royalty; these are not commercial NFTs)
 *
 * NFToken lifecycle:
 *   1. GC signs lien waiver off-chain
 *   2. GC wallet mints NFT via NFTokenMint (DRID encoded in URI)
 *   3. Module 4 verifies NFT is on GC's account with correct DRID
 *   4. After EscrowFinish, NFT is optionally burned (burn-on-release)
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { DRIDString } from '../types';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/**
 * BuildChain-specific NFTokenTaxon for Lien Waiver NFTs.
 * This is a 32-bit unsigned integer — using 20260101 (project launch date).
 * Allows `account_nfts` to be filtered by taxon without scanning all NFTs.
 */
export const LIEN_WAIVER_TAXON = 20260101;

/**
 * XLS-20 NFToken flag bitmasks.
 */
export const NFT_FLAGS = {
  /** NFT can be burned by the issuer or holder */
  tfBurnable: 0x00000001,
  /** NFT can only be bought/sold for XRP */
  tfOnlyXRP: 0x00000002,
  /** NFT can be transferred to other accounts */
  tfTransferable: 0x00000008,
} as const;

/**
 * BuildChain Lien Waiver NFT flag set:
 *   - Burnable (so it can be cleaned up after escrow release)
 *   - NOT Transferable (lien waivers are not tradeable instruments)
 */
export const LIEN_WAIVER_NFT_FLAGS =
  NFT_FLAGS.tfBurnable; // 0x00000001

// ─── RAW ON-CHAIN NFT OBJECT ──────────────────────────────────────────────────

/**
 * Raw XLS-20 NFToken object as returned by account_nfts.
 */
export interface XrplNfToken {
  NFTokenID: string;      // 64-char hex unique ID
  URI?: string;           // Hex-encoded metadata URI
  Flags: number;
  Issuer?: string;        // Only present if minted by a different account
  NFTokenTaxon: number;
  TransferFee?: number;
  nft_serial?: number;    // Serial number within the issuer's sequence
}

// ─── BUILDCHAIN NFT URI PAYLOAD ───────────────────────────────────────────────

/**
 * Structured metadata encoded in the NFT's URI field (as JSON → hex).
 * In production: store at IPFS CID and use that as the URI instead.
 */
export interface LienWaiverNftPayload {
  /** Protocol version */
  version: string;
  /** DRID this lien waiver covers */
  drid: DRIDString;
  /** GC's XRPL address */
  gcAddress: string;
  /** Project ID */
  projectId: string;
  /** Draw number */
  drawNumber: number;
  /** Human-readable milestone description */
  milestoneDescription: string;
  /** GC legal entity name */
  gcLegalName: string;
  /** GC license number (contractor license) */
  gcLicenseNumber: string;
  /** SHA-256 hash of the signed lien waiver PDF */
  documentHash: string;
  /** URL or IPFS CID of the signed lien waiver document */
  documentUrl: string;
  /** Date the lien waiver was signed (ISO 8601) */
  signedDate: string;
  /** Amount being waived (in XRP) */
  amountXrp: string;
  /** Timestamp when the NFT was minted (ISO 8601) */
  mintedAt: string;
}

// ─── MINT INPUTS / RESULTS ───────────────────────────────────────────────────

/**
 * Input for minting a new Lien Waiver NFT.
 */
export interface MintLienWaiverInput {
  /** DRID this lien waiver covers */
  dridString: DRIDString;
  /** Structured payload to encode in the URI */
  payload: LienWaiverNftPayload;
  /**
   * Optional: transfer fee in units of 1/100,000.
   * 0 = no royalty (default and recommended for lien waivers).
   */
  transferFee?: number;
}

/**
 * Result of minting a Lien Waiver NFT.
 */
export interface MintLienWaiverResult {
  success: boolean;
  dridString: DRIDString;
  /** On-chain TX hash of the NFTokenMint transaction */
  txHash?: string;
  /** The minted NFTokenID (256-bit hex string) */
  nfTokenId?: string;
  error?: string;
}

// ─── VERIFY INPUTS / RESULTS ─────────────────────────────────────────────────

/**
 * Input for verifying a Lien Waiver NFT on-chain.
 */
export interface VerifyLienWaiverInput {
  /** DRID to verify lien waiver for */
  dridString: DRIDString;
  /** GC's XRPL address (the NFT must be on this account) */
  gcAddress: string;
  /**
   * If provided, only accept NFTs minted by one of these addresses.
   * Useful when a protocol wallet co-signs minting.
   * If empty, any NFT on the GC's account matching the DRID is accepted.
   */
  authorizedMinters?: string[];
}

/**
 * Result of Lien Waiver NFT verification.
 */
export interface VerifyLienWaiverResult {
  /** Whether all verification checks passed */
  verified: boolean;
  /** DRID this result covers */
  dridString: DRIDString;
  /** GC address checked */
  gcAddress: string;
  /** The matching NFToken (if found) */
  nfToken?: XrplNfToken;
  /** NFTokenID of the verified NFT */
  nfTokenId?: string;
  /** Decoded URI payload (if embedded JSON) */
  payload?: LienWaiverNftPayload;
  /** Human-readable failure reason */
  failureReason?: string;
  /** Timestamp of verification */
  verifiedAt: string;
}

// ─── BURN RESULTS ─────────────────────────────────────────────────────────────

/**
 * Result of burning a Lien Waiver NFT (post-release cleanup).
 */
export interface BurnLienWaiverResult {
  success: boolean;
  dridString: DRIDString;
  nfTokenId: string;
  txHash?: string;
  error?: string;
}
