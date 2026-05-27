/**
 * BuildChain Protocol — Settlement Engine Types (Module 5)
 *
 * Handles post-release RLUSD settlement after EscrowFinish releases XRP.
 *
 * Settlement architecture:
 *   EscrowFinish releases XRP → GC account
 *   Module 5 offers two settlement paths:
 *
 *   Path A — DEX Swap (default for testnet/mainnet):
 *     GC's XRP (released by escrow) is swapped to RLUSD via XRPL DEX.
 *     Uses XRPL Payment with cross-currency path finding.
 *     GC ends up with RLUSD in their account.
 *
 *   Path B — Direct RLUSD Transfer (lender pre-holds RLUSD):
 *     Lender holds RLUSD and sends directly to GC via Payment.
 *     XRP escrow acts as enforcement collateral only.
 *     RLUSD is the actual draw disbursement currency.
 *
 *   Protocol Fee Settlement:
 *     30 bps of the draw amount is routed to BuildChain Protocol wallet
 *     as either XRP or RLUSD, configurable per deployment.
 *
 * RLUSD on XRPL:
 *   Currency code: "RLUSD"
 *   Issuer:        Configurable (set in .env as RLUSD_ISSUER_ADDRESS)
 *   Mainnet:       Ripple's official RLUSD issuer address
 *   Testnet:       Use a test IOU issuer with trust lines configured
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { DRIDString } from '../types';

// ─── RLUSD CURRENCY ───────────────────────────────────────────────────────────

/** XRPL currency code for RLUSD */
export const RLUSD_CURRENCY = 'RLUSD';

/**
 * RLUSD amount represented as XRPL IOU format.
 * On XRPL, non-XRP amounts use { currency, issuer, value } objects.
 */
export interface RlusdAmount {
  currency: typeof RLUSD_CURRENCY;
  issuer: string;   // RLUSD issuer address
  value: string;    // Decimal string (e.g. "250.00")
}

// ─── SETTLEMENT PATHS ─────────────────────────────────────────────────────────

export type SettlementPath = 'DEX_SWAP' | 'DIRECT_TRANSFER';

// ─── DEX QUOTE ────────────────────────────────────────────────────────────────

/**
 * DEX quote for XRP → RLUSD swap.
 * Retrieved before executing the swap to surface slippage and rate to the user.
 */
export interface DexQuote {
  /** XRP amount being sold (in drops) */
  xrpInDrops: string;
  /** XRP amount in human-readable XRP */
  xrpIn: number;
  /** Expected RLUSD output */
  rlusdOut: string;
  /** Effective exchange rate (RLUSD per XRP) */
  rateRlusdPerXrp: number;
  /** Slippage tolerance applied (0–1, e.g. 0.01 = 1%) */
  slippageTolerance: number;
  /** Minimum RLUSD guaranteed after slippage */
  minRlusdOut: string;
  /** Timestamp of quote */
  quotedAt: string;
}

// ─── SETTLEMENT INPUTS ───────────────────────────────────────────────────────

/**
 * Input for a DEX swap settlement (Path A).
 */
export interface DexSwapInput {
  dridString: DRIDString;
  /** GC's XRPL address (sender of XRP, receiver of RLUSD) */
  gcAddress: string;
  /** Amount of XRP to swap (in drops) — typically the escrow release amount */
  xrpAmountDrops: string;
  /** RLUSD issuer address */
  rlusdIssuer: string;
  /**
   * Slippage tolerance (0–1). Default: 0.01 (1%).
   * Swap fails if actual RLUSD received < minRlusdOut.
   */
  slippageTolerance?: number;
  /**
   * If provided, protocol fee (in drops) is sent to protocol wallet
   * as a separate XRP Payment before the swap.
   */
  protocolFeeDrops?: string;
  protocolWalletAddress?: string;
}

/**
 * Input for a direct RLUSD transfer settlement (Path B).
 */
export interface DirectTransferInput {
  dridString: DRIDString;
  /** Address sending RLUSD (typically lender) */
  senderAddress: string;
  /** Address receiving RLUSD (typically GC) */
  receiverAddress: string;
  /** RLUSD amount to transfer */
  rlusdAmount: string;
  /** RLUSD issuer address */
  rlusdIssuer: string;
  /** Protocol fee in RLUSD (optional) */
  protocolFeeRlusd?: string;
  protocolWalletAddress?: string;
}

// ─── SETTLEMENT RESULTS ───────────────────────────────────────────────────────

/**
 * Result of a DEX swap settlement.
 */
export interface DexSwapResult {
  success: boolean;
  dridString: DRIDString;
  path: 'DEX_SWAP';
  /** TX hash of the DEX swap Payment transaction */
  swapTxHash?: string;
  /** TX hash of the protocol fee payment (if sent separately) */
  feeTxHash?: string;
  /** Actual RLUSD received by GC */
  rlusdReceived?: string;
  /** XRP sold in the swap */
  xrpSoldDrops?: string;
  /** Effective rate achieved */
  rateRlusdPerXrp?: number;
  error?: string;
}

/**
 * Result of a direct RLUSD transfer.
 */
export interface DirectTransferResult {
  success: boolean;
  dridString: DRIDString;
  path: 'DIRECT_TRANSFER';
  /** TX hash of the RLUSD Payment transaction */
  transferTxHash?: string;
  /** TX hash of the protocol fee payment (if sent) */
  feeTxHash?: string;
  /** RLUSD amount transferred */
  rlusdTransferred?: string;
  error?: string;
}

/**
 * Unified settlement result.
 */
export type SettlementResult = DexSwapResult | DirectTransferResult;

// ─── TRUST LINE CHECK ─────────────────────────────────────────────────────────

/**
 * Result of checking RLUSD trust line status for an account.
 */
export interface TrustLineStatus {
  address: string;
  hasTrustLine: boolean;
  rlusdBalance?: string;
  rlusdLimit?: string;
  rlusdIssuer: string;
}
