/**
 * BuildChain Protocol — Direct RLUSD Transfer (Module 5, Path B)
 *
 * Handles direct RLUSD payment from lender to GC as the draw disbursement.
 * In this model the XRP escrow acts as enforcement collateral — if the GC
 * fails to deliver (conditions not met), the lender's XRP is returned.
 * The actual construction draw is paid in RLUSD directly.
 *
 * This path is preferred for:
 *   - Institutional lenders who hold RLUSD natively
 *   - Projects where both parties are onboarded with RLUSD trust lines
 *   - Scenarios where XRP price exposure is undesirable
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet, TxResponse } from 'xrpl';
import { getConfig } from '../config/network';
import {
  DirectTransferInput,
  DirectTransferResult,
  TrustLineStatus,
  RLUSD_CURRENCY,
} from './types';
import { checkRlusdTrustLine } from './convert';

// ─── DIRECT RLUSD TRANSFER ────────────────────────────────────────────────────

/**
 * Send RLUSD directly from lender to GC as draw disbursement.
 * Both parties must have RLUSD trust lines established.
 *
 * @param client        Connected XRPL client
 * @param senderWallet  Lender's XRPL wallet (sends RLUSD)
 * @param input         DirectTransferInput
 */
export async function sendRlusdTransfer(
  client: Client,
  senderWallet: Wallet,
  input: DirectTransferInput
): Promise<DirectTransferResult> {
  const config = getConfig();

  console.log(`\n💸 Direct RLUSD Transfer — DRID: ${input.dridString}`);
  console.log(`   Sender:   ${senderWallet.address}`);
  console.log(`   Receiver: ${input.receiverAddress}`);
  console.log(`   Amount:   ${input.rlusdAmount} RLUSD`);
  console.log(`   Issuer:   ${input.rlusdIssuer}`);

  try {
    // ── 1. Verify both parties have trust lines ───────────────────────────
    const [senderTrustLine, receiverTrustLine] = await Promise.all([
      checkRlusdTrustLine(client, senderWallet.address, input.rlusdIssuer),
      checkRlusdTrustLine(client, input.receiverAddress, input.rlusdIssuer),
    ]);

    if (!senderTrustLine.hasTrustLine) {
      throw new Error(
        `Sender ${senderWallet.address} has no RLUSD trust line. ` +
        `Balance: ${senderTrustLine.rlusdBalance || '0'}`
      );
    }

    if (!receiverTrustLine.hasTrustLine) {
      throw new Error(
        `Receiver (GC) ${input.receiverAddress} has no RLUSD trust line. ` +
        `GC must establish a trust line before receiving draws.`
      );
    }

    // Check sender has sufficient balance
    const senderBalance = parseFloat(senderTrustLine.rlusdBalance || '0');
    const sendAmount = parseFloat(input.rlusdAmount);
    const feeAmount = parseFloat(input.protocolFeeRlusd || '0');

    if (senderBalance < sendAmount + feeAmount) {
      throw new Error(
        `Insufficient RLUSD balance. ` +
        `Sender has ${senderBalance} RLUSD, needs ${sendAmount + feeAmount} RLUSD ` +
        `(${sendAmount} draw + ${feeAmount} fee).`
      );
    }

    // ── 2. Send protocol fee in RLUSD (if configured) ────────────────────
    let feeTxHash: string | undefined;
    if (input.protocolFeeRlusd && input.protocolWalletAddress &&
        parseFloat(input.protocolFeeRlusd) > 0) {
      feeTxHash = await sendRlusdPayment(
        client,
        senderWallet,
        input.protocolWalletAddress,
        input.protocolFeeRlusd,
        input.rlusdIssuer,
        input.dridString,
        'ProtocolFee-30bps'
      );
      console.log(`   Protocol fee TX: ${feeTxHash || 'failed'}`);
    }

    // ── 3. Send draw disbursement to GC ───────────────────────────────────
    console.log(`   Sending draw disbursement to GC...`);
    const transferTxHash = await sendRlusdPayment(
      client,
      senderWallet,
      input.receiverAddress,
      input.rlusdAmount,
      input.rlusdIssuer,
      input.dridString,
      'DrawDisbursement'
    );

    if (!transferTxHash) {
      throw new Error(`RLUSD transfer to GC failed`);
    }

    console.log(`   ✅ RLUSD Transfer SUCCESS`);
    console.log(`   ${input.rlusdAmount} RLUSD → ${input.receiverAddress}`);
    console.log(`   Transfer TX: ${transferTxHash}`);

    return {
      success: true,
      dridString: input.dridString,
      path: 'DIRECT_TRANSFER',
      transferTxHash,
      feeTxHash,
      rlusdTransferred: input.rlusdAmount,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ RLUSD Transfer FAILED for DRID ${input.dridString}: ${errorMsg}`);
    return {
      success: false,
      dridString: input.dridString,
      path: 'DIRECT_TRANSFER',
      error: errorMsg,
    };
  }
}

// ─── RLUSD BALANCE CHECK ─────────────────────────────────────────────────────

/**
 * Get RLUSD balance for an account.
 */
export async function getRlusdBalance(
  client: Client,
  address: string,
  rlusdIssuer: string
): Promise<{ address: string; rlusdBalance: string; hasTrustLine: boolean }> {
  const status = await checkRlusdTrustLine(client, address, rlusdIssuer);
  const balance = status.rlusdBalance || '0';
  console.log(`💵 ${address}: ${balance} RLUSD`);
  return {
    address,
    rlusdBalance: balance,
    hasTrustLine: status.hasTrustLine,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Send an RLUSD Payment transaction.
 * Returns the TX hash on success, undefined on failure.
 */
async function sendRlusdPayment(
  client: Client,
  senderWallet: Wallet,
  destination: string,
  amount: string,
  rlusdIssuer: string,
  dridString: string,
  purposeLabel: string
): Promise<string | undefined> {
  try {
    const paymentTx: any = {
      TransactionType: 'Payment',
      Account: senderWallet.address,
      Destination: destination,
      Amount: {
        currency: RLUSD_CURRENCY,
        issuer: rlusdIssuer,
        value: amount,
      },
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-Purpose', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(purposeLabel, 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    const prepared = await client.autofill(paymentTx);
    const signed = senderWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;
    if (txResult === 'tesSUCCESS') return result.result.hash;

    console.warn(`   ⚠️  Payment failed: ${txResult}`);
    return undefined;
  } catch (error) {
    console.warn(`   ⚠️  Payment error: ${error}`);
    return undefined;
  }
}
