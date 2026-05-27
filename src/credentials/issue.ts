/**
 * BuildChain Protocol — Inspector Credential Issuer (Module 2)
 *
 * Issues XLS-0070 Credentials on-chain from the BuildChain Protocol
 * authority wallet to a licensed inspector's XRPL account.
 *
 * Flow:
 *   1. BuildChain receives a signed inspection approval from the authority
 *   2. Protocol wallet submits CredentialCreate (issuer → subject)
 *   3. Inspector calls CredentialAccept (separate flow, inspector-side)
 *   4. Module 4 then calls verifyInspectorCredential() to confirm
 *
 * Note on CredentialAccept:
 *   XRPL requires the Subject (inspector) to call CredentialAccept
 *   before the credential is considered valid (lsfAccepted flag).
 *   BuildChain notifies the inspector via webhook/email after issuance.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet, TxResponse } from 'xrpl';
import { getConfig, dateToRippleTime, dropsToXrp } from '../config/network';
import { DRIDString } from '../types';
import {
  IssueCredentialInput,
  IssueCredentialResult,
  CredentialUriPayload,
  CREDENTIAL_TYPES,
} from './types';
import { encodeCredentialType, encodeUri } from './verify';

// ─── DEFAULT CREDENTIAL VALIDITY ─────────────────────────────────────────────

const DEFAULT_CREDENTIAL_VALIDITY_DAYS = 365; // 1 year

// ─── ISSUE CREDENTIAL ────────────────────────────────────────────────────────

/**
 * Issues an XLS-0070 Inspector Credential on-chain.
 * Must be called by the BuildChain Protocol authority wallet.
 *
 * @param client          Connected XRPL client
 * @param authorityWallet BuildChain Protocol wallet (credential issuer)
 * @param input           IssueCredentialInput
 */
export async function issueInspectorCredential(
  client: Client,
  authorityWallet: Wallet,
  input: IssueCredentialInput
): Promise<IssueCredentialResult> {
  const config = getConfig();

  console.log(`\n📜 Issuing Inspector Credential — DRID: ${input.dridString}`);
  console.log(`   Inspector:  ${input.inspectorAddress}`);
  console.log(`   Issuer:     ${authorityWallet.address}`);

  try {
    // ── 1. Build expiry ────────────────────────────────────────────────────
    const now = new Date();
    const expiryDate =
      input.expiryDate ||
      new Date(now.getTime() + DEFAULT_CREDENTIAL_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

    if (expiryDate <= now) {
      throw new Error(`Credential expiry date must be in the future: ${expiryDate.toISOString()}`);
    }

    // ── 2. Encode credential type ──────────────────────────────────────────
    const credentialTypeHex = encodeCredentialType(CREDENTIAL_TYPES.INSPECTOR);

    // ── 3. Encode URI payload ──────────────────────────────────────────────
    // URI contains the full CredentialUriPayload as a compact JSON string.
    // In production: upload to IPFS or a BuildChain API endpoint, store the URL.
    const uriJson = JSON.stringify(input.payload);
    const uriHex = encodeUri(uriJson);

    // XRPL URI field has a 256-byte limit. For production use IPFS CID instead.
    const uriBytes = Buffer.byteLength(uriJson, 'utf8');
    if (uriBytes > 256) {
      console.warn(
        `   ⚠️  URI payload is ${uriBytes} bytes — exceeds 256-byte on-chain limit. ` +
        `In production, store payload at an IPFS CID or HTTPS URL and use that as the URI.`
      );
    }

    console.log(`   Credential type: ${CREDENTIAL_TYPES.INSPECTOR}`);
    console.log(`   Expires:         ${expiryDate.toISOString()}`);
    console.log(`   URI bytes:       ${uriBytes}`);

    // ── 4. Build CredentialCreate transaction ──────────────────────────────
    // XLS-0070 CredentialCreate transaction
    const credentialCreateTx: any = {
      TransactionType: 'CredentialCreate',
      Account: authorityWallet.address,       // Issuer
      Subject: input.inspectorAddress,         // Inspector (recipient)
      CredentialType: credentialTypeHex,
      URI: uriHex,
      Expiration: dateToRippleTime(expiryDate),
      // Memo for BuildChain audit trail
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(input.dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-CredType', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from('Inspector-v1', 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    // ── 5. Submit ──────────────────────────────────────────────────────────
    console.log(`   Submitting CredentialCreate to XRPL ${config.network}...`);

    const prepared = await client.autofill(credentialCreateTx);
    const signed = authorityWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult !== 'tesSUCCESS') {
      throw new Error(
        `CredentialCreate failed. Result: ${txResult}. TX: ${result.result.hash}`
      );
    }

    const txHash = result.result.hash;

    // ── 6. Extract credential ledger index from metadata ──────────────────
    const affectedNodes = (result.result.meta as any)?.AffectedNodes || [];
    const credentialNode = affectedNodes.find(
      (node: any) =>
        node.CreatedNode?.LedgerEntryType === 'Credential' ||
        node.ModifiedNode?.LedgerEntryType === 'Credential'
    );
    const credentialLedgerIndex =
      credentialNode?.CreatedNode?.LedgerIndex ||
      credentialNode?.ModifiedNode?.LedgerIndex ||
      'unknown';

    console.log(`   ✅ CredentialCreate SUCCESS`);
    console.log(`   TX Hash:         ${txHash}`);
    console.log(`   Ledger index:    ${credentialLedgerIndex}`);
    console.log(`\n   ⏳ Next step: Inspector must call CredentialAccept`);
    console.log(`   Inspector addr:  ${input.inspectorAddress}`);
    console.log(`   BuildChain will notify inspector via webhook/email.`);

    return {
      success: true,
      dridString: input.dridString,
      txHash,
      credentialLedgerIndex,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ CredentialCreate FAILED for DRID ${input.dridString}: ${errorMsg}`);

    return {
      success: false,
      dridString: input.dridString,
      error: errorMsg,
    };
  }
}

// ─── ACCEPT CREDENTIAL (Inspector-side) ───────────────────────────────────────

/**
 * Submits CredentialAccept on behalf of the inspector.
 *
 * In production this is called by the inspector's own wallet software
 * (mobile app or web portal). BuildChain may also offer a hosted
 * "one-click accept" flow via the GC / Inspector portal.
 *
 * @param client           Connected XRPL client
 * @param inspectorWallet  Inspector's XRPL wallet
 * @param issuerAddress    BuildChain Protocol authority address
 * @param dridString       DRID for the inspection being accepted
 */
export async function acceptInspectorCredential(
  client: Client,
  inspectorWallet: Wallet,
  issuerAddress: string,
  dridString: DRIDString
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const config = getConfig();
  const credentialTypeHex = encodeCredentialType(CREDENTIAL_TYPES.INSPECTOR);

  console.log(`\n✅ Inspector accepting credential — DRID: ${dridString}`);
  console.log(`   Inspector: ${inspectorWallet.address}`);
  console.log(`   Issuer:    ${issuerAddress}`);

  try {
    const credentialAcceptTx: any = {
      TransactionType: 'CredentialAccept',
      Account: inspectorWallet.address,  // Inspector (Subject)
      Issuer: issuerAddress,             // BuildChain authority
      CredentialType: credentialTypeHex,
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('BuildChain-DRID', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(dridString, 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    };

    console.log(`   Submitting CredentialAccept to XRPL ${config.network}...`);

    const prepared = await client.autofill(credentialAcceptTx);
    const signed = inspectorWallet.sign(prepared);
    const result: TxResponse = await client.submitAndWait(signed.tx_blob);

    const txResult = (result.result.meta as any)?.TransactionResult;

    if (txResult !== 'tesSUCCESS') {
      throw new Error(
        `CredentialAccept failed. Result: ${txResult}. TX: ${result.result.hash}`
      );
    }

    console.log(`   ✅ CredentialAccept SUCCESS — credential is now lsfAccepted`);
    console.log(`   TX Hash: ${result.result.hash}`);

    return { success: true, txHash: result.result.hash };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`   ❌ CredentialAccept FAILED: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// ─── BUILD CREDENTIAL PAYLOAD ─────────────────────────────────────────────────

/**
 * Helper to build a well-formed CredentialUriPayload.
 * Used by the BuildChain backend before calling issueInspectorCredential.
 */
export function buildCredentialPayload(params: {
  dridString: DRIDString;
  inspectorAddress: string;
  inspectorLicenseNumber: string;
  milestoneDescription: string;
  inspectionDate: string;
  reportHash: string;
  reportUrl: string;
  issuerName: string;
}): CredentialUriPayload {
  return {
    version: '1.0',
    drid: params.dridString,
    inspectorAddress: params.inspectorAddress,
    inspectorLicenseNumber: params.inspectorLicenseNumber,
    milestoneDescription: params.milestoneDescription,
    inspectionDate: params.inspectionDate,
    reportHash: params.reportHash,
    reportUrl: params.reportUrl,
    issuerName: params.issuerName,
    issuedAt: new Date().toISOString(),
  };
}
