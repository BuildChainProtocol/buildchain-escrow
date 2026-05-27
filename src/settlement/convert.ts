/**
 * BuildChain Protocol — XRP → RLUSD DEX Conversion (Module 5)
 *
 * Executes cross-currency Payment transactions on the XRPL built-in DEX
 * to convert XRP released by EscrowFinish into RLUSD for the GC.
 *
 * XRPL DEX mechanics:
 *   - Payment with Amount = RLUSD IOU + SendMax = XRP drops
 *   - XRPL path-finds the best route through the DEX order book
 *   - slippage is controlled via the SendMax ceiling
 *   - tfPartialPayment flag MUST NOT be set (we want exact delivery)
 *
 * Trust line prerequisite:
 *   The GC's account must have a RLUSD trust line established
 *   before receiving RLUSD. Module 5 checks this and surfaces a
 *   clear error if the trust line is missing.
 *
 * Protocol fee handling:
 *   30 bps is sent as XRP to the BuildChain Protocol wallet via a
 *   separate Payment before the DEX swap, keeping fee accounting clean.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet, TxResponse } from 'xrpl';
import { getConfig, dropsToXrp, xrpToDrops } from '../config/network';
import {
  DexSwapInput,
  DexSwapResult,
  DexQuote,
  RlusdAmount,
  TrustLineStatus,
  RLUSD_CURRENCY,
} from './types';

// ─── DEFAULT SETTINGS ─────────────────────────────────────────────────────────

const DEFAULT_SLIPPAGE = 0.01; // 1% slippage tolerance

// ─── TRUST LINE CHECK ────────────────────────────────────────────────────────

/**
 * Check whether an account has a trust line for RLUSD.
 * GC must have this established before receiving RLUSD from a swap.
 */
export async function checkRlusdTrustLine(
  client: Client,
  address: string,
  rlusdIssuer: string
): Promise<TrustLineStatus> {
  try {
    const response = await client.request({
      command: 'account_lines',
      account: address,
      peer: rlusdIssuer,
      ledger_index: 'validated',
    });

    const lines: any[] = (response.result as any).lines || [];
    const rlusdLine = lines.find(
      (l: any) =>
        l.currency === RLUSD_CURRENCY &&
        l.account.toLowerCase() === rlusdIssuer.toLowerCase()
    );

    if (rlusdLine) {
      return {
        address,
        hasTrustLine: true,
        rlusdBalance: rlusdLine.balance,
        rlusdLimit: rlusdLine.limit,
        rlusdIssuer,
      };
    }

    return { address, hasTrustLine: false, rlusdIssuer };
  } catch (error) {
    console.warn(`   Could not check trust line for ${address}: ${error}`);
    return { address, hasTrustLine: false, rlusdIssuer };
  }
}

/**
 * Establish a RLUSD trust line for an account.
 * Called by the GC's onboarding flow before their first draw.
 *
 * @param client       Connected XRPL client
 * @param wallet       Account establishing the trust line
 * @param rlusdIssuer  RLUSD issuer address
 * @param limitRlusd   Trust limit in RLUSD (default: 1,000,000)
 */
export async function establishRlusdTrustLine(
  client: Client,
  wallet: Wallet,
  rlusdIssuer: string,
  limitRlusd = '1000000'
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`\n🔗 Establishing RLUSD trust line`);
  console.log(`   Account: ${wallet.address}`);
  console.log(`   Issuer:  ${rlusdIssuer}`);
  console.log(`   Limit:   ${limitRlusd} RLUSD`);

  try {
    const trustSetTx: any = {
      TransactionType: 'TrustSet',
      Account: wallet.address,
      LimitAmount: {
        currency: RLUSD_CURRENCY,
        issuer: rlusdIssuer,
        value: limitRlusd,
      },
    };

    const prepared = await client.autofill(trustSetTx);
    const signed = wallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`TrustSet failed: ${txResult}`);
    }

    console.log(`   ✅ Trust line established — TX: ${result.result.hash}`);
    return { success: true, txHash: result.result.hash };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ TrustSet failed: ${msg}`);
    return { success: false, error: msg };
  }
}

// ─── DEX QUOTE ───────────────────────────────────────────────────────────────

/**
 * Get a quote for swapping XRP → RLUSD via the XRPL DEX.
 * Uses ripple_path_find to estimate the output before committing.
 *
 * @param client          Connected XRPL client
 * @param gcAddress       GC's XRPL address (destination)
 * @param xrpDrops        XRP to sell (in drops)
 * @param rlusdIssuer     RLUSD issuer address
 * @param slippage        Slippage tolerance (0–1)
 */
export async function getDexQuote(
  client: Client,
  gcAddress: string,
  xrpDrops: string,
  rlusdIssuer: string,
  slippage = DEFAULT_SLIPPAGE
): Promise<DexQuote | null> {
  try {
    // Use path_find immediate mode to get current DEX rate
    const pathFindResponse = await client.request({
      command: 'ripple_path_find',
      source_account: gcAddress,
      source_amount: xrpDrops,    // XRP drops to spend
      destination_account: gcAddress,
      destination_amount: {
        currency: RLUSD_CURRENCY,
        issuer: rlusdIssuer,
        value: '-1',  // -1 = "as much as possible" for the given source amount
      },
    } as any);

    const alternatives = (pathFindResponse.result as any).alternatives || [];
    if (alternatives.length === 0) {
      console.warn(`   No DEX paths found for XRP → RLUSD`);
      return null;
    }

    // Best path is first alternative
    const best = alternatives[0];
    const rlusdOut: string =
      typeof best.destination_amount === 'object'
        ? best.destination_amount.value
        : '0';

    const xrpIn = dropsToXrp(xrpDrops);
    const rlusdOutNum = parseFloat(rlusdOut);
    const rate = xrpIn > 0 ? rlusdOutNum / xrpIn : 0;
    const minRlusdOut = (rlusdOutNum * (1 - slippage)).toFixed(6);

    return {
      xrpInDrops: xrpDrops,
      xrpIn,
      rlusdOut,
      rateRlusdPerXrp: rate,
      slippageTolerance: slippage,
      minRlusdOut,
      quotedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`   DEX quote failed: ${error}`);
    return null;
  }
}

// ─── PROTOCOL FEE PAYMENT ────────────────────────────────────────────────────

/**
 * Send protocol fee (XRP) to the BuildChain Protocol wallet.
 * Called before the DEX swap so fees are settled in XRP regardless of swap outcome.
 */
async function sendProtocolFeeXrp(
  client: Client,
  gcWallet: Wallet,
  feeDrops: string,
  protocolAddress: string,
  dridString: string
): Promise<string | undefined> {
  try {
    const feeTx: any = {
      TransactionType: 'Payment',
      Account: gcWallet.address,
      Destination: protocolAddress,
      Amount: feeDrops,
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-FeeType', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from('ProtocolFee-30bps', 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    const prepared = await client.autofill(feeTx);
    const signed = gcWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);
    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult === 'tesSUCCESS') {
      console.log(`   ✅ Protocol fee sent: ${dropsToXrp(feeDrops)} XRP → ${protocolAddress}`);
      console.log(`   Fee TX: ${result.result.hash}`);
      return result.result.hash;
    }
    console.warn(`   ⚠️  Protocol fee TX failed: ${txResult}`);
    return undefined;
  } catch (error) {
    console.warn(`   ⚠️  Protocol fee TX error: ${error}`);
    return undefined;
  }
}

// ─── DEX SWAP ────────────────────────────────────────────────────────────────

/**
 * Execute an XRP → RLUSD DEX swap on XRPL.
 *
 * Uses cross-currency Payment:
 *   Amount  = RLUSD IOU (what GC wants to receive)
 *   SendMax = XRP drops (maximum XRP GC will spend)
 *
 * @param client    Connected XRPL client
 * @param gcWallet  GC's XRPL wallet (spends XRP, receives RLUSD)
 * @param input     DexSwapInput
 */
export async function executeDexSwap(
  client: Client,
  gcWallet: Wallet,
  input: DexSwapInput
): Promise<DexSwapResult> {
  const config = getConfig();

  console.log(`\n💱 DEX Swap: XRP → RLUSD — DRID: ${input.dridString}`);
  console.log(`   GC:           ${gcWallet.address}`);
  console.log(`   XRP in:       ${dropsToXrp(input.xrpAmountDrops)} XRP`);
  console.log(`   RLUSD issuer: ${input.rlusdIssuer}`);

  try {
    const slippage = input.slippageTolerance ?? DEFAULT_SLIPPAGE;

    // ── 1. Check trust line ───────────────────────────────────────────────
    const trustLine = await checkRlusdTrustLine(client, gcWallet.address, input.rlusdIssuer);
    if (!trustLine.hasTrustLine) {
      throw new Error(
        `GC account ${gcWallet.address} has no RLUSD trust line. ` +
        `Call establishRlusdTrustLine() before swapping.`
      );
    }

    // ── 2. Get DEX quote ──────────────────────────────────────────────────
    console.log(`   Getting DEX quote...`);
    const quote = await getDexQuote(
      client,
      gcWallet.address,
      input.xrpAmountDrops,
      input.rlusdIssuer,
      slippage
    );

    if (!quote) {
      throw new Error(`No DEX liquidity for XRP → RLUSD. Market may be illiquid.`);
    }

    console.log(`   Quote: ${quote.xrpIn} XRP → ${quote.rlusdOut} RLUSD`);
    console.log(`   Rate:  ${quote.rateRlusdPerXrp.toFixed(4)} RLUSD/XRP`);
    console.log(`   Min RLUSD (after ${(slippage * 100).toFixed(1)}% slippage): ${quote.minRlusdOut}`);

    // ── 3. Send protocol fee first (if configured) ───────────────────────
    let feeTxHash: string | undefined;
    if (input.protocolFeeDrops && input.protocolWalletAddress) {
      console.log(`   Sending protocol fee: ${dropsToXrp(input.protocolFeeDrops)} XRP`);
      feeTxHash = await sendProtocolFeeXrp(
        client,
        gcWallet,
        input.protocolFeeDrops,
        input.protocolWalletAddress,
        input.dridString
      );
    }

    // ── 4. Build cross-currency Payment (DEX swap) ───────────────────────
    // Amount  = minimum RLUSD we want to receive (enforces slippage floor)
    // SendMax = maximum XRP we are willing to spend
    const swapTx: any = {
      TransactionType: 'Payment',
      Account: gcWallet.address,
      Destination: gcWallet.address,   // GC swaps to themselves
      Amount: {
        currency: RLUSD_CURRENCY,
        issuer: input.rlusdIssuer,
        value: quote.minRlusdOut,      // Minimum RLUSD after slippage
      },
      SendMax: input.xrpAmountDrops,   // Maximum XRP to spend
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(input.dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-Settlement', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from('XRP-to-RLUSD-DEX', 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    // ── 5. Submit swap ────────────────────────────────────────────────────
    console.log(`   Submitting DEX swap to XRPL ${config.network}...`);

    const prepared = await client.autofill(swapTx);
    const signed = gcWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      throw new Error(`DEX swap failed: ${txResult}. TX: ${result.result.hash}`);
    }

    // ── 6. Extract actual RLUSD received from metadata ───────────────────
    const rlusdReceived = extractRlusdReceived(result.result.meta as any, gcWallet.address, input.rlusdIssuer);
    const xrpSpent = extractXrpSpent(result.result.meta as any);
    const actualRate = xrpSpent > 0 && rlusdReceived
      ? parseFloat(rlusdReceived) / dropsToXrp(String(xrpSpent))
      : quote.rateRlusdPerXrp;

    console.log(`   ✅ DEX Swap SUCCESS`);
    console.log(`   RLUSD received: ${rlusdReceived}`);
    console.log(`   XRP spent:      ${dropsToXrp(String(xrpSpent))} XRP`);
    console.log(`   Effective rate: ${actualRate.toFixed(4)} RLUSD/XRP`);
    console.log(`   Swap TX:        ${result.result.hash}`);

    return {
      success: true,
      dridString: input.dridString,
      path: 'DEX_SWAP',
      swapTxHash: result.result.hash,
      feeTxHash,
      rlusdReceived: rlusdReceived || quote.minRlusdOut,
      xrpSoldDrops: String(xrpSpent) || input.xrpAmountDrops,
      rateRlusdPerXrp: actualRate,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ DEX Swap FAILED for DRID ${input.dridString}: ${errorMsg}`);
    return {
      success: false,
      dridString: input.dridString,
      path: 'DEX_SWAP',
      error: errorMsg,
    };
  }
}

// ─── METADATA HELPERS ────────────────────────────────────────────────────────

/**
 * Extract RLUSD received by an account from Payment transaction metadata.
 */
function extractRlusdReceived(meta: any, address: string, issuer: string): string | undefined {
  if (!meta?.AffectedNodes) return undefined;

  for (const node of meta.AffectedNodes) {
    const entry = node.ModifiedNode || node.CreatedNode;
    if (!entry || entry.LedgerEntryType !== 'RippleState') continue;

    const fields = entry.FinalFields || entry.NewFields;
    if (!fields) continue;

    const balance = fields.Balance;
    const lowLimit = fields.LowLimit;
    const highLimit = fields.HighLimit;

    if (!balance || !lowLimit || !highLimit) continue;

    // Check if this trust line is between our address and the RLUSD issuer
    const isOurLine =
      (lowLimit.issuer?.toLowerCase() === address.toLowerCase() ||
       highLimit.issuer?.toLowerCase() === address.toLowerCase()) &&
      (lowLimit.issuer?.toLowerCase() === issuer.toLowerCase() ||
       highLimit.issuer?.toLowerCase() === issuer.toLowerCase());

    if (isOurLine && balance.currency === RLUSD_CURRENCY) {
      const prev = entry.PreviousFields?.Balance?.value || '0';
      const curr = fields.Balance?.value || '0';
      const delta = Math.abs(parseFloat(curr) - parseFloat(prev));
      if (delta > 0) return delta.toFixed(6);
    }
  }
  return undefined;
}

/**
 * Extract total XRP spent from Payment transaction metadata.
 * Returns drops spent.
 */
function extractXrpSpent(meta: any): number {
  if (!meta?.delivered_amount) return 0;
  if (typeof meta.delivered_amount === 'string') {
    return parseInt(meta.delivered_amount, 10);
  }
  return 0;
}
