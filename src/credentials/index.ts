/**
 * BuildChain Protocol — Inspector Credential Engine (Module 2)
 *
 * Public API for the XLS-0070 Inspector Credential System.
 * Wraps issuance, acceptance, and verification into a clean interface.
 *
 * Lifecycle:
 *   1. issueCredential()    — Protocol wallet → CredentialCreate on-chain
 *   2. acceptCredential()   — Inspector wallet → CredentialAccept on-chain
 *   3. verifyCredential()   — Module 4 Orchestrator calls this before EscrowFinish
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client, Wallet } from 'xrpl';
import { getConfig } from '../config/network';
import { DRIDString } from '../types';
import {
  VerifyCredentialInput,
  VerifyCredentialResult,
  IssueCredentialInput,
  IssueCredentialResult,
  CredentialUriPayload,
  CREDENTIAL_TYPES,
} from './types';
import { verifyInspectorCredential, fetchCredentials } from './verify';
import {
  issueInspectorCredential,
  acceptInspectorCredential,
  buildCredentialPayload,
} from './issue';

export class CredentialEngine {
  private client: Client;
  private trustedIssuers: string[];

  /**
   * @param client         Connected XRPL client
   * @param trustedIssuers List of XRPL addresses authorized to issue BuildChain credentials
   */
  constructor(client: Client, trustedIssuers: string[]) {
    this.client = client;
    this.trustedIssuers = trustedIssuers;

    console.log(`\n📜 CredentialEngine initialized`);
    console.log(`   Trusted issuers: ${trustedIssuers.length}`);
    trustedIssuers.forEach((addr) => console.log(`   — ${addr}`));
  }

  // ─── ISSUANCE (Protocol-side) ───────────────────────────────────────────────

  /**
   * Issue an XLS-0070 Inspector Credential on-chain.
   * Called by the BuildChain backend after an inspection authority approves a draw.
   *
   * @param authorityWallet BuildChain Protocol wallet (must be a trustedIssuer)
   * @param input           IssueCredentialInput
   */
  async issueCredential(
    authorityWallet: Wallet,
    input: IssueCredentialInput
  ): Promise<IssueCredentialResult> {
    return issueInspectorCredential(this.client, authorityWallet, input);
  }

  /**
   * Helper to build a credential payload and issue in one call.
   */
  async issueCredentialForDraw(
    authorityWallet: Wallet,
    params: {
      dridString: DRIDString;
      inspectorAddress: string;
      inspectorLicenseNumber: string;
      milestoneDescription: string;
      inspectionDate: string;
      reportHash: string;
      reportUrl: string;
      issuerName?: string;
      expiryDate?: Date;
    }
  ): Promise<IssueCredentialResult> {
    const payload = buildCredentialPayload({
      ...params,
      issuerName: params.issuerName || 'BuildChain Protocol, Inc.',
    });

    return this.issueCredential(authorityWallet, {
      dridString: params.dridString,
      inspectorAddress: params.inspectorAddress,
      payload,
      expiryDate: params.expiryDate,
    });
  }

  // ─── ACCEPTANCE (Inspector-side) ─────────────────────────────────────────────

  /**
   * Submit CredentialAccept for an inspector.
   * Sets the lsfAccepted flag, making the credential valid for verification.
   *
   * @param inspectorWallet  Inspector's XRPL wallet
   * @param issuerAddress    BuildChain authority address that issued the credential
   * @param dridString       DRID the credential covers
   */
  async acceptCredential(
    inspectorWallet: Wallet,
    issuerAddress: string,
    dridString: DRIDString
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    return acceptInspectorCredential(
      this.client,
      inspectorWallet,
      issuerAddress,
      dridString
    );
  }

  // ─── VERIFICATION (Module 4 Integration) ─────────────────────────────────────

  /**
   * Verify that a valid accepted Inspector Credential exists on-chain for a DRID.
   * This is the primary integration point with Module 4 — Verification Orchestrator.
   *
   * Returns verified: true only if ALL of the following pass:
   *   ✅ Credential exists on the inspector's account
   *   ✅ CredentialType = BuildChain-Inspector-v1
   *   ✅ Issuer is in the trusted issuers list
   *   ✅ Credential references the correct DRID
   *   ✅ lsfAccepted flag is set (inspector accepted)
   *   ✅ Credential is not expired
   *
   * @param dridString        DRID to verify
   * @param inspectorAddress  Inspector's XRPL address
   */
  async verifyCredential(
    dridString: DRIDString,
    inspectorAddress: string
  ): Promise<VerifyCredentialResult> {
    return verifyInspectorCredential(this.client, {
      dridString,
      inspectorAddress,
      trustedIssuers: this.trustedIssuers,
      validateUriPayload: false,
    });
  }

  // ─── INSPECTION ───────────────────────────────────────────────────────────────

  /**
   * Fetch all raw Credential objects on an inspector's account.
   * Useful for debugging or dashboard display.
   */
  async listCredentials(inspectorAddress: string) {
    return fetchCredentials(this.client, inspectorAddress);
  }

  /**
   * Add a trusted issuer address at runtime.
   */
  addTrustedIssuer(address: string): void {
    if (!this.trustedIssuers.includes(address)) {
      this.trustedIssuers.push(address);
      console.log(`📜 Added trusted issuer: ${address}`);
    }
  }

  get credentialType(): string {
    return CREDENTIAL_TYPES.INSPECTOR;
  }

  get issuers(): string[] {
    return [...this.trustedIssuers];
  }
}

// Re-export types
export {
  VerifyCredentialInput,
  VerifyCredentialResult,
  IssueCredentialInput,
  IssueCredentialResult,
  CredentialUriPayload,
  CREDENTIAL_TYPES,
} from './types';

// Re-export helpers
export { encodeCredentialType, decodeCredentialType, encodeUri, decodeUri } from './verify';
export { buildCredentialPayload } from './issue';
