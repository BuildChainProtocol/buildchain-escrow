/**
 * BuildChain Protocol — Lien Waiver NFT Minter (Module 3)
 *
 * Mints XLS-20 NFTs on-chain from the GC's XRPL wallet.
 * Each NFT cryptographically records a signed lien waiver for a draw (DRID).
 *
 * NFTokenMint design decisions:
 *   - Taxon:       LIEN_WAIVER_TAXON (20260101) — filters without scanning all NFTs
 *   - Flags:       tfBurnable — allows clean-up after escrow release
 *   - TransferFee: 0 — lien waivers are not commercial instruments
 *   - URI:         JSON payload embedded (testnet) or IPFS CID (production)
 *
 * Burn-on-release:
 *   After EscrowFinish, the lender dashboard can call burnLienWaiverNft()
 *   to clean up the NFT from the GC's account. This is optional but
 *   keeps the GC's account clean across multiple draw cycles.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet, TxResponse } from 'xrpl';
import { getConfig, dropsToXrp } from '../config/network';
import { DRIDString } from '../types';
import {
  MintLienWaiverInput,
  MintLienWaiverResult,
  LienWaiverNftPayload,
  BurnLienWaiverResult,
  LIEN_WAIVER_TAXON,
  LIEN_WAIVER_NFT_FLAGS,
} from './types';

// ─── URI ENCODING ─────────────────────────────────────────────────────────────

/**
 * Encode a URI string to uppercase hex (XRPL NFT URI format).
 */
export function encodeNftUri(uri: string): string {
  return Buffer.from(uri, 'utf8').toString('hex').toUpperCase();
}

/**
 * Decode a hex NFT URI to plain text.
 */
export function decodeNftUri(hex: string): string {
  return Buffer.from(hex, 'hex').toString('utf8');
}

// ─── PAYLOAD BUILDER ─────────────────────────────────────────────────────────

/**
 * Build a well-formed LienWaiverNftPayload.
 * Called by the BuildChain backend before minting.
 */
export function buildLienWaiverPayload(params: {
  dridString: DRIDString;
  gcAddress: string;
  projectId: string;
  drawNumber: number;
  milestoneDescription: string;
  gcLegalName: string;
  gcLicenseNumber: string;
  documentHash: string;
  documentUrl: string;
  signedDate: string;
  amountXrp: string;
}): LienWaiverNftPayload {
  return {
    version: '1.0',
    drid: params.dridString,
    gcAddress: params.gcAddress,
    projectId: params.projectId,
    drawNumber: params.drawNumber,
    milestoneDescription: params.milestoneDescription,
    gcLegalName: params.gcLegalName,
    gcLicenseNumber: params.gcLicenseNumber,
    documentHash: params.documentHash,
    documentUrl: params.documentUrl,
    signedDate: params.signedDate,
    amountXrp: params.amountXrp,
    mintedAt: new Date().toISOString(),
  };
}

// ─── MINT ────────────────────────────────────────────────────────────────────

/**
 * Mint a Lien Waiver NFT on-chain from the GC's XRPL wallet.
 *
 * @param client    Connected XRPL client
 * @param gcWallet  GC's XRPL wallet (NFT issuer)
 * @param input     MintLienWaiverInput
 */
export async function mintLienWaiverNft(
  client: Client,
  gcWallet: Wallet,
  input: MintLienWaiverInput
): Promise<MintLienWaiverResult> {
  const config = getConfig();

  console.log(`\n🖼️  Minting Lien Waiver NFT — DRID: ${input.dridString}`);
  console.log(`   GC:      ${gcWallet.address}`);
  console.log(`   Taxon:   ${LIEN_WAIVER_TAXON}`);
  console.log(`   Flags:   ${LIEN_WAIVER_NFT_FLAGS} (tfBurnable)`);

  try {
    // ── 1. Encode URI payload ─────────────────────────────────────────────
    const uriJson = JSON.stringify(input.payload);
    const uriHex = encodeNftUri(uriJson);
    const uriBytes = Buffer.byteLength(uriJson, 'utf8');

    if (uriBytes > 256) {
      console.warn(
        `   ⚠️  URI payload is ${uriBytes} bytes — exceeds 256-byte on-chain limit. ` +
        `Use an IPFS CID or HTTPS URL in production.`
      );
    }

    console.log(`   URI bytes: ${uriBytes}`);
    console.log(`   DRID:      ${input.payload.drid}`);
    console.log(`   GC name:   ${input.payload.gcLegalName}`);
    console.log(`   Signed:    ${input.payload.signedDate}`);

    // ── 2. Build NFTokenMint transaction ──────────────────────────────────
    const nfTokenMintTx: any = {
      TransactionType: 'NFTokenMint',
      Account: gcWallet.address,
      NFTokenTaxon: LIEN_WAIVER_TAXON,
      Flags: LIEN_WAIVER_NFT_FLAGS,
      TransferFee: input.transferFee ?? 0,
      URI: uriHex,
      // Memos: DRID for on-chain filtering without URI decode
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(input.dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-NFTType', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from('LienWaiver-v1', 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    // ── 3. Submit NFTokenMint ─────────────────────────────────────────────
    console.log(`   Submitting NFTokenMint to XRPL ${config.network}...`);

    const prepared = await client.autofill(nfTokenMintTx);
    const signed = gcWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult !== 'tesSUCCESS') {
      throw new Error(
        `NFTokenMint failed. Result: ${txResult}. TX: ${result.result.hash}`
      );
    }

    const txHash = result.result.hash;

    // ── 4. Extract NFTokenID from metadata ───────────────────────────────
    const nfTokenId = extractNfTokenId(result.result.meta as any, gcWallet.address);

    console.log(`   ✅ NFTokenMint SUCCESS`);
    console.log(`   TX Hash:    ${txHash}`);
    console.log(`   NFTokenID:  ${nfTokenId || 'see TX metadata'}`);

    return {
      success: true,
      dridString: input.dridString,
      txHash,
      nfTokenId: nfTokenId || undefined,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ NFTokenMint FAILED for DRID ${input.dridString}: ${errorMsg}`);

    return {
      success: false,
      dridString: input.dridString,
      error: errorMsg,
    };
  }
}

// ─── BURN (post-release cleanup) ─────────────────────────────────────────────

/**
 * Burn a Lien Waiver NFT after the escrow has been released.
 * This is optional cleanup — removes the NFT from the GC's account
 * so it doesn't accumulate stale lien waiver NFTs over time.
 *
 * Can be called by either the GC (holder) or a burner authorized by the GC.
 *
 * @param client       Connected XRPL client
 * @param burnerWallet GC wallet (or authorized burner)
 * @param nfTokenId    NFTokenID to burn
 * @param dridString   DRID for logging/audit
 */
export async function burnLienWaiverNft(
  client: Client,
  burnerWallet: Wallet,
  nfTokenId: string,
  dridString: DRIDString
): Promise<BurnLienWaiverResult> {
  const config = getConfig();

  console.log(`\n🔥 Burning Lien Waiver NFT (post-release cleanup)`);
  console.log(`   NFTokenID: ${nfTokenId}`);
  console.log(`   DRID:      ${dridString}`);
  console.log(`   Burner:    ${burnerWallet.address}`);

  try {
    const nfTokenBurnTx: any = {
      TransactionType: 'NFTokenBurn',
      Account: burnerWallet.address,
      NFTokenID: nfTokenId,
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-BurnReason', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from('EscrowReleased', 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    console.log(`   Submitting NFTokenBurn to XRPL ${config.network}...`);

    const prepared = await client.autofill(nfTokenBurnTx);
    const signed = burnerWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult !== 'tesSUCCESS') {
      throw new Error(
        `NFTokenBurn failed. Result: ${txResult}. TX: ${result.result.hash}`
      );
    }

    console.log(`   ✅ NFTokenBurn SUCCESS — NFT removed from GC account`);
    console.log(`   TX Hash: ${result.result.hash}`);

    return {
      success: true,
      dridString,
      nfTokenId,
      txHash: result.result.hash,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ NFTokenBurn FAILED: ${errorMsg}`);

    return {
      success: false,
      dridString,
      nfTokenId,
      error: errorMsg,
    };
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Extract the NFTokenID from the NFTokenMint transaction metadata.
 *
 * XLS-20 metadata structure: AffectedNodes contains a CreatedNode for
 * NFTokenPage where the new NFToken appears in NewFields.NFTokens.
 */
function extractNfTokenId(meta: any, accountAddress: string): string | null {
  if (!meta?.AffectedNodes) return null;

  for (const node of meta.AffectedNodes) {
    // Look for created or modified NFTokenPage
    const entry = node.CreatedNode || node.ModifiedNode;
    if (!entry) continue;

    if (entry.LedgerEntryType === 'NFTokenPage') {
      // Check NewFields (created) or FinalFields (modified)
      const fields = entry.NewFields || entry.FinalFields;
      if (!fields?.NFTokens) continue;

      // Return the last token in the page (most recently minted)
      const tokens = fields.NFTokens;
      if (tokens.length > 0) {
        const lastToken = tokens[tokens.length - 1];
        if (lastToken.NFToken?.NFTokenID) {
          return lastToken.NFToken.NFTokenID;
        }
      }
    }
  }

  return null;
}
