/**
 * BuildChain Protocol — Lien Waiver NFT Engine (Module 3)
 *
 * Public API for the XLS-20 Lien Waiver NFT system.
 * Wraps minting, verification, and burn into a clean interface.
 *
 * Lifecycle:
 *   1. mintNft()    — GC wallet → NFTokenMint on-chain
 *   2. verifyNft()  — Module 4 Orchestrator calls before EscrowFinish
 *   3. burnNft()    — Optional cleanup after escrow is released
 *
 * Integration with Module 4:
 *   const result = await nftEngine.verifyNft(dridString, gcAddress);
 *   if (result.verified) {
 *     escrowEngine.markLienWaiverNftVerified(dridString, result.nfTokenId);
 *   }
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet } from 'xrpl';
import { DRIDString } from '../types';
import {
  MintLienWaiverInput,
  MintLienWaiverResult,
  VerifyLienWaiverResult,
  BurnLienWaiverResult,
  LienWaiverNftPayload,
  XrplNfToken,
  LIEN_WAIVER_TAXON,
  LIEN_WAIVER_NFT_FLAGS,
} from './types';
import {
  mintLienWaiverNft,
  burnLienWaiverNft,
  buildLienWaiverPayload,
  encodeNftUri,
  decodeNftUri,
} from './mint';
import { verifyLienWaiverNft, fetchAccountNfts } from './verify';

export class LienWaiverNftEngine {
  private client: Client;
  private authorizedMinters: string[];

  /**
   * @param client             Connected XRPL client
   * @param authorizedMinters  Optional list of addresses allowed to mint.
   *                           If empty, any address can mint (open mode).
   */
  constructor(client: Client, authorizedMinters: string[] = []) {
    this.client = client;
    this.authorizedMinters = authorizedMinters;

    console.log(`\n🖼️  LienWaiverNftEngine initialized`);
    console.log(`   Taxon:             ${LIEN_WAIVER_TAXON}`);
    console.log(`   NFT flags:         ${LIEN_WAIVER_NFT_FLAGS} (tfBurnable)`);
    if (authorizedMinters.length > 0) {
      console.log(`   Authorized minters: ${authorizedMinters.length}`);
    }
  }

  // ─── MINTING (GC-side) ────────────────────────────────────────────────────

  /**
   * Mint a Lien Waiver NFT from the GC's wallet.
   *
   * @param gcWallet  GC's XRPL wallet
   * @param input     MintLienWaiverInput
   */
  async mintNft(
    gcWallet: Wallet,
    input: MintLienWaiverInput
  ): Promise<MintLienWaiverResult> {
    return mintLienWaiverNft(this.client, gcWallet, input);
  }

  /**
   * Helper: build payload and mint in one call.
   */
  async mintNftForDraw(
    gcWallet: Wallet,
    params: {
      dridString: DRIDString;
      projectId: string;
      drawNumber: number;
      milestoneDescription: string;
      gcLegalName: string;
      gcLicenseNumber: string;
      documentHash: string;
      documentUrl: string;
      signedDate: string;
      amountXrp: string;
    }
  ): Promise<MintLienWaiverResult> {
    const payload = buildLienWaiverPayload({
      ...params,
      gcAddress: gcWallet.address,
    });

    return this.mintNft(gcWallet, {
      dridString: params.dridString,
      payload,
    });
  }

  // ─── VERIFICATION (Module 4 Integration) ─────────────────────────────────

  /**
   * Verify that a valid Lien Waiver NFT exists on the GC's account for a DRID.
   * Primary integration point with Module 4 — Verification Orchestrator.
   *
   * Returns verified: true only if ALL of the following pass:
   *   ✅ NFT exists on the GC's account
   *   ✅ NFTokenTaxon = LIEN_WAIVER_TAXON (20260101)
   *   ✅ NFT URI encodes the correct DRID
   *   ✅ GC address in payload matches the account being checked
   *   ✅ If authorizedMinters set: minter is in the authorized list
   *
   * @param dridString  DRID to verify lien waiver for
   * @param gcAddress   GC's XRPL address
   */
  async verifyNft(
    dridString: DRIDString,
    gcAddress: string
  ): Promise<VerifyLienWaiverResult> {
    return verifyLienWaiverNft(this.client, {
      dridString,
      gcAddress,
      authorizedMinters:
        this.authorizedMinters.length > 0 ? this.authorizedMinters : undefined,
    });
  }

  // ─── BURN (post-release cleanup) ──────────────────────────────────────────

  /**
   * Burn a Lien Waiver NFT after the escrow has been released.
   * Optional — keeps GC's account clean across multiple draw cycles.
   *
   * @param burnerWallet  GC wallet (or authorized burner)
   * @param nfTokenId     NFTokenID to burn
   * @param dridString    DRID for audit trail
   */
  async burnNft(
    burnerWallet: Wallet,
    nfTokenId: string,
    dridString: DRIDString
  ): Promise<BurnLienWaiverResult> {
    return burnLienWaiverNft(this.client, burnerWallet, nfTokenId, dridString);
  }

  // ─── INSPECTION ───────────────────────────────────────────────────────────

  /**
   * List all Lien Waiver NFTs on a GC's account (taxon-filtered).
   */
  async listNfts(gcAddress: string): Promise<XrplNfToken[]> {
    return fetchAccountNfts(this.client, gcAddress, LIEN_WAIVER_TAXON);
  }

  /**
   * Add an authorized minter at runtime.
   */
  addAuthorizedMinter(address: string): void {
    if (!this.authorizedMinters.includes(address)) {
      this.authorizedMinters.push(address);
      console.log(`🖼️  Added authorized minter: ${address}`);
    }
  }

  get taxon(): number {
    return LIEN_WAIVER_TAXON;
  }
}

// Re-export types and constants
export {
  MintLienWaiverInput,
  MintLienWaiverResult,
  VerifyLienWaiverResult,
  BurnLienWaiverResult,
  LienWaiverNftPayload,
  XrplNfToken,
  LIEN_WAIVER_TAXON,
  LIEN_WAIVER_NFT_FLAGS,
} from './types';
// Re-export helpers
export {
  buildLienWaiverPayload,
  encodeNftUri,
  decodeNftUri,
} from './mint';
export { fetchAccountNfts } from './verify';
