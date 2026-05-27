/**
 * BuildChain Protocol — Lien Waiver NFT Verifier (Module 3)
 *
 * Verifies that a valid Lien Waiver NFT exists on the GC's XRPL account
 * for a specific DRID.
 *
 * Verification pipeline:
 *   1. Fetch all NFTs on the GC's account (account_nfts)
 *   2. Filter by NFTokenTaxon = LIEN_WAIVER_TAXON (20260101)
 *   3. For each candidate: decode URI and check DRID match
 *   4. Confirm GC address in payload matches the account being checked
 *   5. Return the matching NFToken with its ID
 *
 * Note on transferability:
 *   BuildChain Lien Waiver NFTs are NOT tfTransferable. They stay on
 *   the GC's account from mint until burn. The verification intentionally
 *   checks the GC's account rather than tracking ownership chains.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client } from 'xrpl';
import { DRIDString } from '../types';
import {
  XrplNfToken,
  VerifyLienWaiverInput,
  VerifyLienWaiverResult,
  LienWaiverNftPayload,
  LIEN_WAIVER_TAXON,
} from './types';
import { decodeNftUri } from './mint';

// ─── ON-CHAIN FETCH ───────────────────────────────────────────────────────────

/**
 * Fetch all NFTs owned by an XRPL account.
 * Uses `account_nfts` with optional taxon filter.
 */
export async function fetchAccountNfts(
  client: Client,
  address: string,
  taxon?: number
): Promise<XrplNfToken[]> {
  try {
    const request: any = {
      command: 'account_nfts',
      account: address,
      ledger_index: 'validated',
    };

    const response = await client.request(request);
    const nfts: XrplNfToken[] = (response.result as any).account_nfts || [];

    if (taxon !== undefined) {
      return nfts.filter((nft) => nft.NFTokenTaxon === taxon);
    }

    return nfts;
  } catch (error) {
    console.warn(`   Could not fetch NFTs for ${address}: ${error}`);
    return [];
  }
}

// ─── DRID MATCHING ───────────────────────────────────────────────────────────

/**
 * Try to extract a LienWaiverNftPayload from an NFT's URI field.
 * Returns null if the URI can't be decoded or parsed as JSON.
 */
function decodeNftPayload(nft: XrplNfToken): LienWaiverNftPayload | null {
  if (!nft.URI) return null;

  try {
    const uriText = decodeNftUri(nft.URI);

    // Try direct JSON parse (testnet embedded payload)
    try {
      return JSON.parse(uriText) as LienWaiverNftPayload;
    } catch {
      // URI is a URL — not parsed here (production flow)
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Check whether an NFT matches the expected DRID.
 * Returns the decoded payload if match found.
 */
function nftMatchesDrid(
  nft: XrplNfToken,
  dridString: DRIDString
): { matches: boolean; payload?: LienWaiverNftPayload } {
  const payload = decodeNftPayload(nft);

  if (payload) {
    return { matches: payload.drid === dridString, payload: payload || undefined };
  }

  // Fallback: check if URI text contains the DRID (URL-based mode)
  if (nft.URI) {
    try {
      const uriText = decodeNftUri(nft.URI);
      const dridEncoded = encodeURIComponent(dridString);
      if (uriText.includes(dridString) || uriText.includes(dridEncoded)) {
        return { matches: true };
      }
    } catch {
      // ignore decode error
    }
  }

  return { matches: false };
}

// ─── MAIN VERIFY FUNCTION ─────────────────────────────────────────────────────

/**
 * Verify that a valid Lien Waiver NFT exists on the GC's XRPL account
 * for a given DRID.
 *
 * This is called by Module 4 — Verification Orchestrator as the second
 * half of the dual-condition check before EscrowFinish is submitted.
 *
 * @param client  Connected XRPL client
 * @param input   VerifyLienWaiverInput
 */
export async function verifyLienWaiverNft(
  client: Client,
  input: VerifyLienWaiverInput
): Promise<VerifyLienWaiverResult> {
  const { dridString, gcAddress } = input;
  const verifiedAt = new Date().toISOString();

  console.log(`\n🖼️  Verifying Lien Waiver NFT — DRID: ${dridString}`);
  console.log(`   GC address: ${gcAddress}`);
  console.log(`   Taxon:      ${LIEN_WAIVER_TAXON}`);

  const fail = (reason: string): VerifyLienWaiverResult => {
    console.log(`   ❌ Verification FAILED: ${reason}`);
    return {
      verified: false,
      dridString,
      gcAddress,
      failureReason: reason,
      verifiedAt,
    };
  };

  // ── 1. Fetch all NFTs on the GC's account filtered by taxon ──────────────
  const nfts = await fetchAccountNfts(client, gcAddress, LIEN_WAIVER_TAXON);

  if (nfts.length === 0) {
    return fail(
      `No NFTs with taxon ${LIEN_WAIVER_TAXON} found on account ${gcAddress}. ` +
      `GC must mint a Lien Waiver NFT before verification can proceed.`
    );
  }

  console.log(`   Found ${nfts.length} NFT(s) with taxon ${LIEN_WAIVER_TAXON}`);

  // ── 2. Find the NFT matching this DRID ───────────────────────────────────
  let matchedNft: XrplNfToken | null = null;
  let matchedPayload: LienWaiverNftPayload | undefined;

  for (const nft of nfts) {
    const { matches, payload } = nftMatchesDrid(nft, dridString);
    if (matches) {
      matchedNft = nft;
      matchedPayload = payload;
      break;
    }
  }

  if (!matchedNft) {
    return fail(
      `No NFT references DRID "${dridString}". ` +
      `Checked ${nfts.length} NFT(s) with taxon ${LIEN_WAIVER_TAXON}.`
    );
  }

  // ── 3. Validate authorized minter (if list provided) ─────────────────────
  if (input.authorizedMinters && input.authorizedMinters.length > 0) {
    const authorizedSet = new Set(
      input.authorizedMinters.map((a) => a.toLowerCase())
    );
    // The Issuer field is only present when the NFT was minted by a different
    // account than the one holding it (e.g., via NFTokenMint with Issuer field).
    // If Issuer is absent, the holder minted it themselves.
    const minter = matchedNft.Issuer || gcAddress;
    if (!authorizedSet.has(minter.toLowerCase())) {
      return fail(
        `NFT was minted by ${minter}, which is not in the authorized minters list: ` +
        `[${input.authorizedMinters.join(', ')}]`
      );
    }
  }

  // ── 4. Validate GC address in payload matches the account ────────────────
  if (matchedPayload && matchedPayload.gcAddress) {
    if (matchedPayload.gcAddress.toLowerCase() !== gcAddress.toLowerCase()) {
      return fail(
        `NFT payload gcAddress (${matchedPayload.gcAddress}) ` +
        `does not match the GC account being verified (${gcAddress}).`
      );
    }
  }

  // ── 5. Log and return success ─────────────────────────────────────────────
  console.log(`   ✅ Lien Waiver NFT verified`);
  console.log(`   NFTokenID:  ${matchedNft.NFTokenID}`);
  if (matchedPayload) {
    console.log(`   GC name:    ${matchedPayload.gcLegalName}`);
    console.log(`   GC license: ${matchedPayload.gcLicenseNumber}`);
    console.log(`   Signed:     ${matchedPayload.signedDate}`);
    console.log(`   Doc hash:   ${matchedPayload.documentHash}`);
  }

  return {
    verified: true,
    dridString,
    gcAddress,
    nfToken: matchedNft,
    nfTokenId: matchedNft.NFTokenID,
    payload: matchedPayload,
    verifiedAt,
  };
}
