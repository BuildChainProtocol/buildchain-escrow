/**
 * BuildChain Protocol — EscrowFinish
 *
 * Executes EscrowFinish on XRPL, releasing draw funds to the GC.
 * ONLY called by the Verification Orchestrator (Module 4) after confirming:
 *   1. Valid XLS-0070 Inspector Credential on-ledger for this DRID
 *   2. Valid XLS-20 Lien Waiver NFT on-ledger for this DRID
 *
 * Both conditions must be SIMULTANEOUSLY verified before this is called.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet, EscrowFinish, TxResponse } from 'xrpl';
import {
  FinishEscrowInput,
  FinishEscrowResult,
} from '../types';
import { getConfig, dropsToXrp } from '../config/network';
import { EscrowRegistry } from '../registry/registry';

/**
 * Finishes (releases) an escrow after dual-condition verification.
 *
 * Flow:
 * 1. Load record from registry — verify DUAL_CONDITION_MET status
 * 2. Verify time condition: finishAfter must have passed
 * 3. Build and submit EscrowFinish transaction
 * 4. Update registry with RELEASED status and tx hash
 *
 * @param client         Connected XRPL client
 * @param protocolWallet BuildChain Protocol wallet (submits the EscrowFinish)
 * @param registry       EscrowRegistry instance
 * @param input          FinishEscrowInput with DRID and finisher address
 */
export async function finishEscrow(
  client: Client,
  protocolWallet: Wallet,
  registry: EscrowRegistry,
  input: FinishEscrowInput
): Promise<FinishEscrowResult> {
  const config = getConfig();

  console.log(`\n🔓 Finishing escrow for DRID: ${input.dridString}`);

  try {
    // ── 1. Load and validate registry record ──────────────────────────────
    const record = registry.getOrThrow(input.dridString);

    if (record.status === 'RELEASED') {
      throw new Error(`Escrow already released for DRID: ${input.dridString}`);
    }

    if (record.status === 'CANCELLED' || record.status === 'EXPIRED') {
      throw new Error(
        `Cannot finish escrow with status ${record.status} for DRID: ${input.dridString}`
      );
    }

    // ── 2. Guard: dual-condition must be met ──────────────────────────────
    // This is the core dual-condition enforcement gate.
    // The Orchestrator sets status to DUAL_CONDITION_MET before calling this.
    if (record.status !== 'DUAL_CONDITION_MET') {
      const { inspectorCredentialVerified, lienWaiverNftVerified } =
        record.verificationConditions;

      throw new Error(
        `DUAL-CONDITION NOT MET for DRID: ${input.dridString}. ` +
        `Inspector Credential: ${inspectorCredentialVerified ? '✅' : '❌'} | ` +
        `Lien Waiver NFT: ${lienWaiverNftVerified ? '✅' : '❌'}. ` +
        `Both conditions must be verified before EscrowFinish can be submitted.`
      );
    }

    // ── 3. Check time condition: finishAfter must have passed ─────────────
    const finishAfterDate = new Date(record.finishAfter);
    const now = new Date();
    if (now < finishAfterDate) {
      const waitSeconds = Math.ceil((finishAfterDate.getTime() - now.getTime()) / 1000);
      throw new Error(
        `Too early to finish escrow. FinishAfter: ${record.finishAfter}. ` +
        `Wait ${waitSeconds} more seconds.`
      );
    }

    // ── 4. Check: not past cancelAfter ────────────────────────────────────
    const cancelAfterDate = new Date(record.cancelAfter);
    if (now > cancelAfterDate) {
      // Mark as expired in registry
      registry.updateStatus(input.dridString, 'EXPIRED');
      throw new Error(
        `Escrow expired. CancelAfter was ${record.cancelAfter}. ` +
        `Funds have been returned to lender. Status updated to EXPIRED.`
      );
    }

    console.log(`   Dual-condition: ✅ Inspector Credential + ✅ Lien Waiver NFT`);
    console.log(`   Credential TX:  ${record.verificationConditions.inspectorCredentialTxHash || 'N/A'}`);
    console.log(`   NFT TX:         ${record.verificationConditions.lienWaiverNftTxHash || 'N/A'}`);
    console.log(`   Amount:         ${dropsToXrp(record.amountDrops)} XRP (${record.amountDrops} drops)`);
    console.log(`   Protocol fee:   ${dropsToXrp(record.protocolFeeDrops || '0')} XRP`);

    // ── 5. Build EscrowFinish transaction ─────────────────────────────────
    const escrowFinishTx: EscrowFinish = {
      TransactionType: 'EscrowFinish',
      Account: input.finisherAddress,         // Protocol wallet submits
      Owner: record.lenderAddress,            // Original escrow creator
      OfferSequence: record.escrowSequence,   // Sequence from EscrowCreate
      // Memos: encode DRID + verification receipt for audit trail
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(input.dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-VerificationReceipt', 'utf8')
              .toString('hex')
              .toUpperCase(),
            MemoData: Buffer.from(
              JSON.stringify({
                drid: input.dridString,
                inspectorCredentialTxHash:
                  record.verificationConditions.inspectorCredentialTxHash,
                lienWaiverNftTxHash:
                  record.verificationConditions.lienWaiverNftTxHash,
                verifiedAt: record.verificationConditions.verifiedAt,
                releasedAt: now.toISOString(),
              }),
              'utf8'
            )
              .toString('hex')
              .toUpperCase(),
          },
        },
      ],
    };

    // ── 6. Submit EscrowFinish ─────────────────────────────────────────────
    console.log(`   Submitting EscrowFinish to XRPL ${config.network}...`);

    const prepared = await client.autofill(escrowFinishTx);
    const signed = protocolWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult !== 'tesSUCCESS') {
      throw new Error(
        `EscrowFinish failed on-chain. Result: ${txResult}. ` +
        `TX Hash: ${result.result.hash}`
      );
    }

    const txHash = result.result.hash;

    console.log(`   ✅ EscrowFinish SUCCESS — funds released to ${record.gcAddress}`);
    console.log(`   TX Hash: ${txHash}`);

    // ── 7. Update registry ─────────────────────────────────────────────────
    registry.update(input.dridString, {
      status: 'RELEASED',
      finishTxHash: txHash,
    });

    return {
      success: true,
      dridString: input.dridString,
      txHash,
      amountReleasedDrops: record.amountDrops,
      protocolFeeDrops: record.protocolFeeDrops,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ EscrowFinish FAILED for DRID ${input.dridString}: ${errorMsg}`);

    return {
      success: false,
      dridString: input.dridString,
      error: errorMsg,
    };
  }
}
