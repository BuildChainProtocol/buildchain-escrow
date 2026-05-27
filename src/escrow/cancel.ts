/**
 * BuildChain Protocol — EscrowCancel
 *
 * Cancels an expired or failed escrow, returning funds to the lender.
 * Called when:
 *   - CancelAfter time has passed without dual-condition being met
 *   - Lender explicitly requests cancellation (e.g., project cancelled)
 *   - Verification conditions failed (fraudulent credential or NFT)
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet, EscrowCancel, TxResponse } from 'xrpl';
import { CancelEscrowInput, CancelEscrowResult } from '../types';
import { getConfig } from '../config/network';
import { EscrowRegistry } from '../registry/registry';

/**
 * Cancels an escrow and returns funds to the lender.
 *
 * @param client         Connected XRPL client
 * @param protocolWallet BuildChain Protocol wallet (or lender wallet)
 * @param registry       EscrowRegistry instance
 * @param input          CancelEscrowInput with DRID and cancellation reason
 */
export async function cancelEscrow(
  client: Client,
  cancellerWallet: Wallet,
  registry: EscrowRegistry,
  input: CancelEscrowInput
): Promise<CancelEscrowResult> {
  const config = getConfig();

  console.log(`\n❌ Cancelling escrow for DRID: ${input.dridString}`);
  console.log(`   Reason: ${input.reason}`);

  try {
    // ── 1. Load registry record ────────────────────────────────────────────
    const record = registry.getOrThrow(input.dridString);

    if (record.status === 'RELEASED') {
      throw new Error(
        `Cannot cancel escrow that has already been released. DRID: ${input.dridString}`
      );
    }

    if (record.status === 'CANCELLED') {
      throw new Error(
        `Escrow already cancelled. DRID: ${input.dridString}`
      );
    }

    // ── 2. Verify cancellation is valid ────────────────────────────────────
    const now = new Date();
    const cancelAfterDate = new Date(record.cancelAfter);

    if (now < cancelAfterDate && input.reason !== 'LENDER_REQUESTED' && input.reason !== 'VERIFICATION_FAILED') {
      const waitMs = cancelAfterDate.getTime() - now.getTime();
      const waitHours = Math.ceil(waitMs / (1000 * 60 * 60));
      throw new Error(
        `Cannot cancel escrow yet. CancelAfter not reached. ` +
        `${waitHours} hours remaining. ` +
        `To cancel early, use reason LENDER_REQUESTED or VERIFICATION_FAILED.`
      );
    }

    console.log(`   Lender:          ${record.lenderAddress}`);
    console.log(`   Escrow sequence: ${record.escrowSequence}`);
    console.log(`   CancelAfter:     ${record.cancelAfter}`);

    // ── 3. Build EscrowCancel transaction ─────────────────────────────────
    const escrowCancelTx: EscrowCancel = {
      TransactionType: 'EscrowCancel',
      Account: cancellerWallet.address,
      Owner: record.lenderAddress,
      OfferSequence: record.escrowSequence,
      // Memos: encode DRID and cancellation reason for audit trail
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(input.dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-CancelReason', 'utf8')
              .toString('hex')
              .toUpperCase(),
            MemoData: Buffer.from(input.reason, 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    // ── 4. Submit EscrowCancel ─────────────────────────────────────────────
    console.log(`   Submitting EscrowCancel to XRPL ${config.network}...`);

    const prepared = await client.autofill(escrowCancelTx);
    const signed = cancellerWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult !== 'tesSUCCESS') {
      throw new Error(
        `EscrowCancel failed on-chain. Result: ${txResult}. ` +
        `TX Hash: ${result.result.hash}`
      );
    }

    const txHash = result.result.hash;

    console.log(`   ✅ EscrowCancel SUCCESS — funds returned to ${record.lenderAddress}`);
    console.log(`   TX Hash: ${txHash}`);

    // ── 5. Update registry ─────────────────────────────────────────────────
    const newStatus = now > cancelAfterDate ? 'EXPIRED' : 'CANCELLED';
    registry.update(input.dridString, {
      status: newStatus,
      cancelTxHash: txHash,
    });

    return {
      success: true,
      dridString: input.dridString,
      txHash,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ EscrowCancel FAILED for DRID ${input.dridString}: ${errorMsg}`);

    return {
      success: false,
      dridString: input.dridString,
      error: errorMsg,
    };
  }
}
