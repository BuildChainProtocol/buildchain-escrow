/**
 * BuildChain Protocol — Escrow Monitor
 *
 * Monitors escrow status on-chain and in the registry.
 * Provides real-time status checks, on-chain confirmation,
 * and an event loop that can auto-cancel expired escrows.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client } from 'xrpl';
import { EscrowStatusResult, DRIDString, EscrowRecord } from '../types';
import { dropsToXrp, rippleTimeToDate } from '../config/network';
import { EscrowRegistry } from '../registry/registry';

// ─── ON-CHAIN LOOKUP ─────────────────────────────────────────────────────────

/**
 * Look up an escrow object on-chain by owner address and sequence number.
 * Returns null if the escrow no longer exists (was finished or cancelled).
 */
export async function getOnChainEscrow(
  client: Client,
  ownerAddress: string,
  sequence: number
): Promise<any | null> {
  try {
    const response = await client.request({
      command: 'account_objects',
      account: ownerAddress,
      type: 'escrow',
    });

    const escrows = (response.result as any).account_objects || [];

    return (
      escrows.find(
        (e: any) =>
          e.LedgerEntryType === 'Escrow' && e.Sequence === sequence
      ) || null
    );
  } catch (error) {
    console.warn(`Could not fetch on-chain escrow: ${error}`);
    return null;
  }
}

// ─── STATUS CHECK ─────────────────────────────────────────────────────────────

/**
 * Get full status of an escrow: registry state + on-chain confirmation.
 */
export async function getEscrowStatus(
  client: Client,
  registry: EscrowRegistry,
  dridString: DRIDString
): Promise<EscrowStatusResult> {
  const record = registry.getOrThrow(dridString);

  // Check on-chain
  const onChainEscrow = await getOnChainEscrow(
    client,
    record.lenderAddress,
    record.escrowSequence
  );

  const onChainConfirmed = onChainEscrow !== null;
  const now = new Date();
  const cancelAfter = new Date(record.cancelAfter);
  const timeRemaining = Math.max(0, Math.floor((cancelAfter.getTime() - now.getTime()) / 1000));

  // Print status summary
  console.log(`\n📊 Escrow Status — DRID: ${dridString}`);
  console.log(`   Registry status:    ${record.status}`);
  console.log(`   On-chain:           ${onChainConfirmed ? '✅ Exists' : '❌ Not found (finished or cancelled)'}`);
  console.log(`   Inspector cred:     ${record.verificationConditions.inspectorCredentialVerified ? '✅ Verified' : '⏳ Pending'}`);
  console.log(`   Lien waiver NFT:    ${record.verificationConditions.lienWaiverNftVerified ? '✅ Verified' : '⏳ Pending'}`);
  console.log(`   Amount:             ${dropsToXrp(record.amountDrops)} XRP`);
  console.log(`   Finish after:       ${record.finishAfter}`);
  console.log(`   Cancel after:       ${record.cancelAfter}`);
  if (record.status !== 'RELEASED' && record.status !== 'CANCELLED') {
    console.log(`   Time remaining:     ${Math.floor(timeRemaining / 3600)}h ${Math.floor((timeRemaining % 3600) / 60)}m`);
  }
  if (record.createTxHash) {
    console.log(`   Create TX:          ${record.createTxHash}`);
  }
  if (record.finishTxHash) {
    console.log(`   Finish TX:          ${record.finishTxHash}`);
  }
  if (record.cancelTxHash) {
    console.log(`   Cancel TX:          ${record.cancelTxHash}`);
  }

  return {
    dridString,
    status: record.status,
    record,
    onChainConfirmed,
    timeRemaining,
  };
}

// ─── ACCOUNT BALANCE ─────────────────────────────────────────────────────────

/**
 * Get XRP balance for an XRPL account address.
 */
export async function getAccountBalance(
  client: Client,
  address: string
): Promise<{ address: string; balanceXrp: number; balanceDrops: string }> {
  try {
    const response = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });

    const balanceDrops = (response.result as any).account_data.Balance;
    const balanceXrp = dropsToXrp(balanceDrops);

    console.log(`💰 Account ${address}: ${balanceXrp} XRP (${balanceDrops} drops)`);
    return { address, balanceXrp, balanceDrops };
  } catch (error) {
    throw new Error(`Could not fetch balance for ${address}: ${error}`);
  }
}

// ─── REGISTRY SUMMARY ─────────────────────────────────────────────────────────

/**
 * Print a summary of all escrow records in the registry.
 */
export function printRegistrySummary(registry: EscrowRegistry): void {
  const summary = registry.getSummary();
  const all = registry.getAll();

  console.log(`\n📋 BuildChain Escrow Registry Summary`);
  console.log(`   Total records:        ${all.length}`);
  console.log(`   Funded:               ${summary.FUNDED}`);
  console.log(`   Pending Verification: ${summary.PENDING_VERIFICATION}`);
  console.log(`   Dual Condition Met:   ${summary.DUAL_CONDITION_MET}`);
  console.log(`   Released:             ${summary.RELEASED}`);
  console.log(`   Cancelled:            ${summary.CANCELLED}`);
  console.log(`   Expired:              ${summary.EXPIRED}`);

  if (all.length > 0) {
    console.log(`\n   Recent records:`);
    const recent = all.slice(-5);
    for (const r of recent) {
      console.log(`   — ${r.drid} | ${r.status} | ${r.amountXrp} XRP | ${r.milestoneDescription}`);
    }
  }
}

// ─── TRANSACTION EXPLORER LINKS ───────────────────────────────────────────────

/**
 * Get XRPL explorer URL for a transaction hash.
 */
export function getExplorerUrl(txHash: string, network: 'testnet' | 'mainnet'): string {
  if (network === 'testnet') {
    return `https://testnet.xrpl.org/transactions/${txHash}`;
  }
  return `https://livenet.xrpl.org/transactions/${txHash}`;
}

/**
 * Print explorer links for all transactions in an escrow record.
 */
export function printExplorerLinks(record: EscrowRecord, network: 'testnet' | 'mainnet'): void {
  console.log(`\n🔍 XRPL Explorer Links — DRID: ${record.drid}`);
  if (record.createTxHash) {
    console.log(`   EscrowCreate: ${getExplorerUrl(record.createTxHash, network)}`);
  }
  if (record.finishTxHash) {
    console.log(`   EscrowFinish: ${getExplorerUrl(record.finishTxHash, network)}`);
  }
  if (record.cancelTxHash) {
    console.log(`   EscrowCancel: ${getExplorerUrl(record.cancelTxHash, network)}`);
  }
}
