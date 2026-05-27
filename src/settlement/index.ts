/**
 * BuildChain Protocol — Settlement Engine (Module 5)
 *
 * Public API for post-release RLUSD settlement.
 * Wraps DEX conversion and direct transfer into a clean interface.
 *
 * Usage after EscrowFinish:
 *
 *   // Path A — DEX Swap (GC converts released XRP to RLUSD)
 *   const result = await settlement.swapXrpToRlusd(gcWallet, {
 *     dridString, xrpAmountDrops, gcAddress, ...
 *   });
 *
 *   // Path B — Direct Transfer (Lender sends RLUSD to GC directly)
 *   const result = await settlement.transferRlusd(lenderWallet, {
 *     dridString, rlusdAmount, senderAddress, receiverAddress, ...
 *   });
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet } from 'xrpl';
import { getConfig } from '../config/network';
import {
  DexSwapInput,
  DexSwapResult,
  DirectTransferInput,
  DirectTransferResult,
  DexQuote,
  TrustLineStatus,
  RLUSD_CURRENCY,
  SettlementPath,
} from './types';
import {
  executeDexSwap,
  getDexQuote,
  checkRlusdTrustLine,
  establishRlusdTrustLine,
} from './convert';
import {
  sendRlusdTransfer,
  getRlusdBalance,
} from './transfer';

export class SettlementEngine {
  private client: Client;
  private rlusdIssuer: string;

  /**
   * @param client       Connected XRPL client
   * @param rlusdIssuer  RLUSD issuer address (from env: RLUSD_ISSUER_ADDRESS)
   */
  constructor(client: Client, rlusdIssuer: string) {
    this.client = client;
    this.rlusdIssuer = rlusdIssuer;

    console.log(`\n💵 SettlementEngine initialized`);
    console.log(`   RLUSD currency: ${RLUSD_CURRENCY}`);
    console.log(`   RLUSD issuer:   ${rlusdIssuer}`);
  }

  // ─── PATH A — DEX SWAP ───────────────────────────────────────────────────

  /**
   * Get a DEX quote for XRP → RLUSD swap.
   * Call this before swapXrpToRlusd to preview the rate.
   */
  async getSwapQuote(
    gcAddress: string,
    xrpDrops: string,
    slippage = 0.01
  ): Promise<DexQuote | null> {
    return getDexQuote(this.client, gcAddress, xrpDrops, this.rlusdIssuer, slippage);
  }

  /**
   * Execute XRP → RLUSD DEX swap.
   * Called by the GC after EscrowFinish releases XRP to their account.
   *
   * @param gcWallet  GC's XRPL wallet
   * @param input     DexSwapInput (omit rlusdIssuer — uses engine's issuer)
   */
  async swapXrpToRlusd(
    gcWallet: Wallet,
    input: Omit<DexSwapInput, 'rlusdIssuer'>
  ): Promise<DexSwapResult> {
    return executeDexSwap(this.client, gcWallet, {
      ...input,
      rlusdIssuer: this.rlusdIssuer,
    });
  }

  // ─── PATH B — DIRECT RLUSD TRANSFER ──────────────────────────────────────

  /**
   * Send RLUSD directly from lender to GC as draw disbursement.
   * Both parties must have RLUSD trust lines established.
   *
   * @param senderWallet  Lender's XRPL wallet
   * @param input         DirectTransferInput (omit rlusdIssuer)
   */
  async transferRlusd(
    senderWallet: Wallet,
    input: Omit<DirectTransferInput, 'rlusdIssuer'>
  ): Promise<DirectTransferResult> {
    return sendRlusdTransfer(this.client, senderWallet, {
      ...input,
      rlusdIssuer: this.rlusdIssuer,
    });
  }

  // ─── TRUST LINE MANAGEMENT ────────────────────────────────────────────────

  /**
   * Check RLUSD trust line status for any account.
   */
  async checkTrustLine(address: string): Promise<TrustLineStatus> {
    return checkRlusdTrustLine(this.client, address, this.rlusdIssuer);
  }

  /**
   * Establish RLUSD trust line for a wallet.
   * Required before an account can receive RLUSD.
   *
   * @param wallet       Account to establish trust line on
   * @param limitRlusd   Trust limit (default: 1,000,000)
   */
  async establishTrustLine(
    wallet: Wallet,
    limitRlusd = '1000000'
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    return establishRlusdTrustLine(this.client, wallet, this.rlusdIssuer, limitRlusd);
  }

  // ─── BALANCE CHECKS ───────────────────────────────────────────────────────

  /**
   * Get RLUSD balance for any account.
   */
  async getRlusdBalance(
    address: string
  ): Promise<{ address: string; rlusdBalance: string; hasTrustLine: boolean }> {
    return getRlusdBalance(this.client, address, this.rlusdIssuer);
  }

  get currency(): string {
    return RLUSD_CURRENCY;
  }

  get issuer(): string {
    return this.rlusdIssuer;
  }
}

// Re-export types and helpers
export {
  DexSwapInput,
  DexSwapResult,
  DirectTransferInput,
  DirectTransferResult,
  DexQuote,
  TrustLineStatus,
  SettlementPath,
  RLUSD_CURRENCY,
} from './types';
