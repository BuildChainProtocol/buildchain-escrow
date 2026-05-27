/**
 * BuildChain Protocol — Smart Escrow Engine
 * Module 1 — Public API
 *
 * EscrowEngine is the main entry point for all escrow operations.
 * Wraps create, finish, cancel, and monitor into a single clean interface.
 *
 * Usage:
 *   const engine = new EscrowEngine();
 *   await engine.connect();
 *   const result = await engine.createEscrow({ ... });
 *   await engine.disconnect();
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet } from 'xrpl';
import { getClient, getConfig } from './config/network';
import { EscrowRegistry } from './registry/registry';
import { createEscrow } from './escrow/create';
import { finishEscrow } from './escrow/finish';
import { cancelEscrow } from './escrow/cancel';
import {
  getEscrowStatus,
  getOnChainEscrow,
  getAccountBalance,
  printRegistrySummary,
  printExplorerLinks,
} from './escrow/monitor';
import {
  CreateEscrowInput,
  CreateEscrowResult,
  FinishEscrowInput,
  FinishEscrowResult,
  CancelEscrowInput,
  CancelEscrowResult,
  EscrowStatusResult,
  EscrowRecord,
  DRIDString,
  EscrowStatus,
} from './types';

export class EscrowEngine {
  private client: Client;
  private registry: EscrowRegistry;
  private _connected: boolean = false;

  constructor(registryPath?: string) {
    const config = getConfig();
    const path = registryPath || config.registryPath;
    this.client = new Client(config.serverUrl);
    this.registry = new EscrowRegistry(path);

    console.log(`\n🏗️  BuildChain Protocol — Smart Escrow Engine`);
    console.log(`   Network:       ${config.network.toUpperCase()}`);
    console.log(`   Registry:      ${path}`);
    console.log(`   Protocol fee:  ${config.protocolFeeBps} bps`);
  }

  // ─── CONNECTION ──────────────────────────────────────────────────────────────

  /**
   * Connect to the XRPL network.
   */
  async connect(): Promise<void> {
    if (!this._connected) {
      await this.client.connect();
      this._connected = true;
      const config = getConfig();
      console.log(`✅ Connected to XRPL ${config.network} (${config.serverUrl})`);
    }
  }

  /**
   * Disconnect from the XRPL network.
   */
  async disconnect(): Promise<void> {
    if (this._connected) {
      await this.client.disconnect();
      this._connected = false;
      console.log(`🔌 Disconnected from XRPL`);
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  // ─── ESCROW LIFECYCLE ────────────────────────────────────────────────────────

  /**
   * Create a new time-locked escrow for a construction draw.
   *
   * @param input     CreateEscrowInput — DRID, parties, amount, time conditions
   * @param wallet    Lender's XRPL wallet (must have sufficient XRP)
   */
  async createEscrow(
    input: CreateEscrowInput,
    wallet: Wallet
  ): Promise<CreateEscrowResult> {
    this.assertConnected();
    return createEscrow(this.client, wallet, this.registry, input);
  }

  /**
   * Release (finish) an escrow after dual-condition verification.
   * Only callable when escrow status is DUAL_CONDITION_MET.
   *
   * @param input          FinishEscrowInput — DRID and finisher address
   * @param protocolWallet BuildChain Protocol wallet
   */
  async finishEscrow(
    input: FinishEscrowInput,
    protocolWallet: Wallet
  ): Promise<FinishEscrowResult> {
    this.assertConnected();
    return finishEscrow(this.client, protocolWallet, this.registry, input);
  }

  /**
   * Cancel an escrow and return funds to the lender.
   * Valid when: CancelAfter passed, LENDER_REQUESTED, or VERIFICATION_FAILED.
   *
   * @param input          CancelEscrowInput — DRID and reason
   * @param cancellerWallet Wallet submitting the EscrowCancel
   */
  async cancelEscrow(
    input: CancelEscrowInput,
    cancellerWallet: Wallet
  ): Promise<CancelEscrowResult> {
    this.assertConnected();
    return cancelEscrow(this.client, cancellerWallet, this.registry, input);
  }

  // ─── VERIFICATION (Module 4 Integration) ─────────────────────────────────────

  /**
   * Mark inspector credential as verified for a DRID.
   * Called by Module 4 — Verification Orchestrator after XLS-0070 check.
   *
   * @param dridString            DRID to update
   * @param credentialTxHash      On-chain TX hash of the credential
   */
  markInspectorCredentialVerified(
    dridString: DRIDString,
    credentialTxHash: string
  ): EscrowRecord {
    const record = this.registry.updateVerification(dridString, {
      inspectorCredentialVerified: true,
      inspectorCredentialTxHash: credentialTxHash,
    });
    console.log(`✅ Inspector credential verified for DRID: ${dridString}`);
    return record;
  }

  /**
   * Mark lien waiver NFT as verified for a DRID.
   * Called by Module 4 — Verification Orchestrator after XLS-20 NFT check.
   *
   * @param dridString        DRID to update
   * @param nftTxHash         On-chain TX hash of the NFT mint/transfer
   */
  markLienWaiverNftVerified(
    dridString: DRIDString,
    nftTxHash: string
  ): EscrowRecord {
    const record = this.registry.updateVerification(dridString, {
      lienWaiverNftVerified: true,
      lienWaiverNftTxHash: nftTxHash,
    });
    console.log(`✅ Lien waiver NFT verified for DRID: ${dridString}`);
    return record;
  }

  // ─── MONITORING ──────────────────────────────────────────────────────────────

  /**
   * Get full status of an escrow (registry + on-chain).
   */
  async getStatus(dridString: DRIDString): Promise<EscrowStatusResult> {
    this.assertConnected();
    return getEscrowStatus(this.client, this.registry, dridString);
  }

  /**
   * Get XRP balance for any XRPL address.
   */
  async getBalance(
    address: string
  ): Promise<{ address: string; balanceXrp: number; balanceDrops: string }> {
    this.assertConnected();
    return getAccountBalance(this.client, address);
  }

  /**
   * Print a summary of all escrow records in the registry.
   */
  printSummary(): void {
    printRegistrySummary(this.registry);
  }

  /**
   * Print XRPL explorer links for all transactions in a record.
   */
  printLinks(dridString: DRIDString): void {
    const config = getConfig();
    const record = this.registry.getOrThrow(dridString);
    printExplorerLinks(record, config.network);
  }

  // ─── REGISTRY ACCESS ─────────────────────────────────────────────────────────

  /**
   * Get an escrow record from the registry.
   */
  getRecord(dridString: DRIDString): EscrowRecord | null {
    return this.registry.get(dridString);
  }

  /**
   * Get all records with a given status.
   */
  getByStatus(status: EscrowStatus): EscrowRecord[] {
    return this.registry.getByStatus(status);
  }

  /**
   * Get all records for a given project.
   */
  getByProject(projectId: string): EscrowRecord[] {
    return this.registry.getByProject(projectId);
  }

  /**
   * Get all records pending dual-condition verification.
   */
  getPendingVerification(): EscrowRecord[] {
    return this.registry.getPendingVerification();
  }

  /**
   * Get all records where dual-condition is met (ready to finish).
   */
  getDualConditionMet(): EscrowRecord[] {
    return this.registry.getDualConditionMet();
  }

  /**
   * Get all records expired but not yet cancelled.
   */
  getExpiredUncancelled(): EscrowRecord[] {
    return this.registry.getExpiredUncancelled();
  }

  // ─── PRIVATE ─────────────────────────────────────────────────────────────────

  private assertConnected(): void {
    if (!this._connected) {
      throw new Error(
        'EscrowEngine is not connected. Call await engine.connect() first.'
      );
    }
  }
}

// Re-export types for convenience
export {
  CreateEscrowInput,
  CreateEscrowResult,
  FinishEscrowInput,
  FinishEscrowResult,
  CancelEscrowInput,
  CancelEscrowResult,
  EscrowStatusResult,
  EscrowRecord,
  DRIDString,
  EscrowStatus,
} from './types';
