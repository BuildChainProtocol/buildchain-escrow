/**
 * BuildChain Protocol — EscrowCreate
 *
 * Creates a time-locked XRPL escrow for a construction draw.
 * Funds are locked until:
 *   (a) Both verification conditions are met (Module 4 Orchestrator calls EscrowFinish), OR
 *   (b) CancelAfter passes (EscrowCancel returns funds to lender)
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet, EscrowCreate, TxResponse } from 'xrpl';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateEscrowInput,
  CreateEscrowResult,
  EscrowRecord,
  DRIDString,
  serializeDRID,
} from '../types';
import {
  getConfig,
  xrpToDrops,
  dropsToXrp,
  dateToRippleTime,
  calculateProtocolFee,
} from '../config/network';
import { EscrowRegistry } from '../registry/registry';

// ─── DEFAULT TIME CONDITIONS ──────────────────────────────────────────────────

function buildTimeConditions(
  finishAfterOverride?: Date,
  cancelAfterOverride?: Date
): { finishAfter: Date; cancelAfter: Date } {
  const config = getConfig();
  const now = new Date();

  const finishAfter =
    finishAfterOverride ||
    new Date(now.getTime() + config.defaultFinishAfterHours * 60 * 60 * 1000);

  const cancelAfter =
    cancelAfterOverride ||
    new Date(now.getTime() + config.defaultCancelAfterDays * 24 * 60 * 60 * 1000);

  // Validate: cancelAfter must be after finishAfter
  if (cancelAfter <= finishAfter) {
    throw new Error(
      `cancelAfter (${cancelAfter.toISOString()}) must be after ` +
      `finishAfter (${finishAfter.toISOString()})`
    );
  }

  return { finishAfter, cancelAfter };
}

// ─── CREATE ESCROW ────────────────────────────────────────────────────────────

/**
 * Creates an XRPL escrow for a construction draw request.
 *
 * Flow:
 * 1. Validate inputs
 * 2. Build EscrowCreate transaction
 * 3. Submit to XRPL
 * 4. Record in DRID registry
 * 5. Return result with on-chain tx hash
 *
 * @param client    Connected XRPL client
 * @param wallet    Lender's XRPL wallet (must have sufficient XRP balance)
 * @param registry  EscrowRegistry instance
 * @param input     CreateEscrowInput with DRID, parties, amount, and conditions
 */
export async function createEscrow(
  client: Client,
  wallet: Wallet,
  registry: EscrowRegistry,
  input: CreateEscrowInput
): Promise<CreateEscrowResult> {
  const config = getConfig();
  const dridString: DRIDString = serializeDRID(input.drid);

  console.log(`\n🔒 Creating escrow for DRID: ${dridString}`);
  console.log(`   Lender:  ${input.parties.lenderAddress}`);
  console.log(`   GC:      ${input.parties.gcAddress}`);
  console.log(`   Amount:  ${input.amountXrp} XRP`);

  try {
    // ── 1. Validate lender wallet matches input ────────────────────────────
    if (wallet.address !== input.parties.lenderAddress) {
      throw new Error(
        `Wallet address ${wallet.address} does not match ` +
        `lenderAddress ${input.parties.lenderAddress}`
      );
    }

    // ── 2. Check for duplicate DRID ────────────────────────────────────────
    if (registry.get(dridString)) {
      throw new Error(
        `Escrow already exists for DRID: ${dridString}. ` +
        `Cannot create duplicate draw escrow.`
      );
    }

    // ── 3. Build time conditions ───────────────────────────────────────────
    const { finishAfter, cancelAfter } = buildTimeConditions(
      input.timeConditions?.finishAfter,
      input.timeConditions?.cancelAfter
    );

    // ── 4. Convert amounts ─────────────────────────────────────────────────
    const amountDrops = xrpToDrops(input.amountXrp);
    const protocolFeeDrops = calculateProtocolFee(amountDrops, config.protocolFeeBps);

    console.log(`   Amount drops:       ${amountDrops}`);
    console.log(`   Protocol fee drops: ${protocolFeeDrops} (${config.protocolFeeBps}bps)`);
    console.log(`   Finish after:       ${finishAfter.toISOString()}`);
    console.log(`   Cancel after:       ${cancelAfter.toISOString()}`);

    // ── 5. Build EscrowCreate transaction ─────────────────────────────────
    const escrowCreateTx: EscrowCreate = {
      TransactionType: 'EscrowCreate',
      Account: input.parties.lenderAddress,
      Amount: amountDrops,
      Destination: input.parties.gcAddress,
      FinishAfter: dateToRippleTime(finishAfter),
      CancelAfter: dateToRippleTime(cancelAfter),
      // Memos: encode DRID for on-chain auditability
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-Milestone', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(input.drid.milestoneDescription, 'utf8')
              .toString('hex')
              .toUpperCase(),
          },
        },
      ],
    };

    // ── 6. Auto-fill and submit ────────────────────────────────────────────
    console.log(`   Submitting EscrowCreate to XRPL ${config.network}...`);

    const prepared = await client.autofill(escrowCreateTx);
    const signed = wallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    // ── 7. Validate result ─────────────────────────────────────────────────
    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult !== 'tesSUCCESS') {
      throw new Error(
        `EscrowCreate failed on-chain. Result: ${txResult}. ` +
        `TX Hash: ${result.result.hash}`
      );
    }

    const txHash = result.result.hash;
    const escrowSequence = result.result.Sequence as number;

    console.log(`   ✅ EscrowCreate SUCCESS`);
    console.log(`   TX Hash:        ${txHash}`);
    console.log(`   Escrow Sequence: ${escrowSequence}`);

    // ── 8. Build and save registry record ─────────────────────────────────
    const record: EscrowRecord = {
      drid: dridString,
      projectId: input.drid.projectId,
      drawNumber: input.drid.drawNumber,
      milestoneDescription: input.drid.milestoneDescription,
      lenderAddress: input.parties.lenderAddress,
      gcAddress: input.parties.gcAddress,
      amountDrops,
      amountXrp: input.amountXrp.toString(),
      protocolFeeDrops,
      finishAfter: finishAfter.toISOString(),
      cancelAfter: cancelAfter.toISOString(),
      escrowSequence,
      createTxHash: txHash,
      verificationConditions: {
        inspectorCredentialVerified: false,
        lienWaiverNftVerified: false,
      },
      status: 'FUNDED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registry.save(record);

    return {
      success: true,
      dridString,
      record,
      txHash,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ EscrowCreate FAILED for DRID ${dridString}: ${errorMsg}`);

    return {
      success: false,
      dridString,
      record: null as any,
      txHash: '',
      error: errorMsg,
    };
  }
}
