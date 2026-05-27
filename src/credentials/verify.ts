/**
 * BuildChain Protocol — Inspector Credential Verifier (Module 2)
 *
 * Verifies that a valid XLS-0070 Inspector Credential exists on-chain
 * for a given DRID + inspector address combination.
 *
 * Verification pipeline:
 *   1. Fetch all Credential objects on the inspector's XRPL account
 *   2. Filter by CredentialType = BuildChain-Inspector-v1
 *   3. Confirm issuer is in the trusted issuers list
 *   4. Confirm credential references the correct DRID (via URI)
 *   5. Confirm credential has been accepted (lsfAccepted flag)
 *   6. Confirm credential is not expired
 *   7. (Optional) Fetch + validate off-chain URI payload
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client } from 'xrpl';
import { rippleTimeToDate } from '../config/network';
import { DRIDString } from '../types';
import {
  XrplCredentialObject,
  VerifyCredentialInput,
  VerifyCredentialResult,
  CredentialUriPayload,
  CREDENTIAL_TYPES,
  LSF_ACCEPTED,
} from './types';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Encode a plain-text string to uppercase hex (XRPL CredentialType format).
 */
export function encodeCredentialType(type: string): string {
  return Buffer.from(type, 'utf8').toString('hex').toUpperCase();
}

/**
 * Decode a hex CredentialType back to plain text.
 */
export function decodeCredentialType(hex: string): string {
  return Buffer.from(hex, 'hex').toString('utf8');
}

/**
 * Encode a URI string to hex (XRPL URI field format).
 */
export function encodeUri(uri: string): string {
  return Buffer.from(uri, 'utf8').toString('hex').toUpperCase();
}

/**
 * Decode a hex URI back to plain text.
 */
export function decodeUri(hex: string): string {
  return Buffer.from(hex, 'hex').toString('utf8');
}

/**
 * Check whether a credential object has the lsfAccepted flag set.
 */
function isAccepted(credential: XrplCredentialObject): boolean {
  return (credential.Flags & LSF_ACCEPTED) !== 0;
}

/**
 * Check whether a credential is expired (past Expiration ripple time).
 */
function isExpired(credential: XrplCredentialObject): boolean {
  if (!credential.Expiration) return false;
  const expiryDate = rippleTimeToDate(credential.Expiration);
  return new Date() > expiryDate;
}

// ─── ON-CHAIN FETCH ───────────────────────────────────────────────────────────

/**
 * Fetch all Credential ledger objects for an XRPL account.
 * Uses account_objects with type = 'credential'.
 */
export async function fetchCredentials(
  client: Client,
  subjectAddress: string
): Promise<XrplCredentialObject[]> {
  try {
    const response = await (client as any).request({
      command: 'account_objects',
      account: subjectAddress,
      type: 'credential',
      ledger_index: 'validated',
    });

    const objects = (response.result as any).account_objects || [];
    return objects.filter(
      (o: any) => o.LedgerEntryType === 'Credential'
    ) as XrplCredentialObject[];
  } catch (error) {
    console.warn(`   Could not fetch credentials for ${subjectAddress}: ${error}`);
    return [];
  }
}

/**
 * Fetch the transaction that created a credential (CredentialCreate).
 * Returns the TX hash from the ledger object's metadata if available.
 */
export async function fetchCredentialTxHash(
  client: Client,
  credentialLedgerIndex: string
): Promise<string | undefined> {
  try {
    const response = await client.request({
      command: 'ledger_entry',
      index: credentialLedgerIndex,
      ledger_index: 'validated',
    });
    // The ledger_entry response contains the object but not the creating TX hash
    // directly — in production this would be resolved via account_tx scan.
    // For now, return undefined and let the caller use the ledger index as reference.
    return undefined;
  } catch {
    return undefined;
  }
}

// ─── DRID MATCHING ───────────────────────────────────────────────────────────

/**
 * Determine whether a credential's URI encodes the expected DRID.
 *
 * URI payload format (JSON string encoded as hex):
 *   { drid: "PROJ-123:draw1", ... }
 *
 * We support two URI formats:
 *   1. Raw JSON: the URI is directly the JSON payload (for testnet/dev)
 *   2. URL: the URI is a URL — DRID is extracted from the JSON at that URL
 *      (for production; URL fetch is gated on validateUriPayload flag)
 */
function credentialMatchesDrid(
  credential: XrplCredentialObject,
  dridString: DRIDString
): { matches: boolean; payload?: CredentialUriPayload } {
  if (!credential.URI) {
    return { matches: false };
  }

  const uriText = decodeUri(credential.URI);

  // Try to parse as JSON directly (testnet / embedded payload mode)
  try {
    const payload = JSON.parse(uriText) as CredentialUriPayload;
    if (payload.drid === dridString) {
      return { matches: true, payload };
    }
    return { matches: false };
  } catch {
    // URI is a URL — check if the URL contains the DRID as a path component
    // (e.g., https://api.buildchain.io/credentials/PROJ-123:draw1)
    const dridEncoded = encodeURIComponent(dridString);
    if (uriText.includes(dridString) || uriText.includes(dridEncoded)) {
      return { matches: true };
    }
    return { matches: false };
  }
}

// ─── MAIN VERIFY FUNCTION ─────────────────────────────────────────────────────

/**
 * Verify that a valid XLS-0070 Inspector Credential exists on-chain
 * for the given DRID and inspector address.
 *
 * This is called by Module 4 — Verification Orchestrator as part of
 * the dual-condition check before EscrowFinish is submitted.
 *
 * @param client  Connected XRPL client
 * @param input   VerifyCredentialInput
 */
export async function verifyInspectorCredential(
  client: Client,
  input: VerifyCredentialInput
): Promise<VerifyCredentialResult> {
  const { dridString, inspectorAddress, trustedIssuers } = input;
  const verifiedAt = new Date().toISOString();

  console.log(`\n🔍 Verifying Inspector Credential — DRID: ${dridString}`);
  console.log(`   Inspector:       ${inspectorAddress}`);
  console.log(`   Trusted issuers: ${trustedIssuers.length}`);

  const fail = (reason: string): VerifyCredentialResult => {
    console.log(`   ❌ Verification FAILED: ${reason}`);
    return {
      verified: false,
      dridString,
      inspectorAddress,
      failureReason: reason,
      verifiedAt,
    };
  };

  // ── 1. Fetch all credentials on the inspector's account ──────────────────
  const allCredentials = await fetchCredentials(client, inspectorAddress);

  if (allCredentials.length === 0) {
    return fail(`No Credential objects found on account ${inspectorAddress}`);
  }

  console.log(`   Found ${allCredentials.length} credential object(s) on account`);

  // ── 2. Filter by CredentialType ───────────────────────────────────────────
  const expectedTypeHex = encodeCredentialType(CREDENTIAL_TYPES.INSPECTOR);

  const typedCredentials = allCredentials.filter(
    (c) => c.CredentialType.toUpperCase() === expectedTypeHex
  );

  if (typedCredentials.length === 0) {
    return fail(
      `No credential with type "${CREDENTIAL_TYPES.INSPECTOR}" found. ` +
      `Expected hex: ${expectedTypeHex}`
    );
  }

  // ── 3. Filter by trusted issuer ───────────────────────────────────────────
  const trustedSet = new Set(trustedIssuers.map((a) => a.toLowerCase()));

  const trustedCredentials = typedCredentials.filter((c) =>
    trustedSet.has(c.Account.toLowerCase())
  );

  if (trustedCredentials.length === 0) {
    const issuers = typedCredentials.map((c) => c.Account).join(', ');
    return fail(
      `No credential from a trusted issuer. Found issuers: [${issuers}]. ` +
      `Trusted: [${trustedIssuers.join(', ')}]`
    );
  }

  // ── 4. Filter by DRID match ───────────────────────────────────────────────
  let matchedCredential: XrplCredentialObject | null = null;
  let matchedPayload: CredentialUriPayload | undefined;

  for (const cred of trustedCredentials) {
    const { matches, payload } = credentialMatchesDrid(cred, dridString);
    if (matches) {
      matchedCredential = cred;
      matchedPayload = payload;
      break;
    }
  }

  if (!matchedCredential) {
    return fail(
      `No credential references DRID "${dridString}". ` +
      `Checked ${trustedCredentials.length} trusted credential(s).`
    );
  }

  // ── 5. Check lsfAccepted ──────────────────────────────────────────────────
  if (!isAccepted(matchedCredential)) {
    return fail(
      `Credential for DRID "${dridString}" has not been accepted by the inspector. ` +
      `Inspector must call CredentialAccept before verification can proceed.`
    );
  }

  // ── 6. Check expiry ───────────────────────────────────────────────────────
  if (isExpired(matchedCredential)) {
    const expiry = matchedCredential.Expiration
      ? rippleTimeToDate(matchedCredential.Expiration).toISOString()
      : 'unknown';
    return fail(`Credential expired at ${expiry}`);
  }

  // ── 7. Log and return success ─────────────────────────────────────────────
  const credentialLedgerIndex = matchedCredential.LedgerIndex || matchedCredential.index || '';

  console.log(`   ✅ Credential verified`);
  console.log(`   Issuer:          ${matchedCredential.Account}`);
  console.log(`   Ledger index:    ${credentialLedgerIndex}`);
  if (matchedCredential.Expiration) {
    console.log(`   Expires:         ${rippleTimeToDate(matchedCredential.Expiration).toISOString()}`);
  }
  if (matchedPayload) {
    console.log(`   Inspector:       ${matchedPayload.inspectorLicenseNumber}`);
    console.log(`   Inspection date: ${matchedPayload.inspectionDate}`);
  }

  return {
    verified: true,
    dridString,
    inspectorAddress,
    credentialObject: matchedCredential,
    credentialLedgerIndex,
    uriPayload: matchedPayload,
    verifiedAt,
  };
}
