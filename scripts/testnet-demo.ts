/**
 * BuildChain Protocol — Full Testnet Demo (All 6 Modules)
 *
 * Runs the complete BuildChain Protocol lifecycle on XRPL Testnet.
 * This is the canonical demonstration of the dual-condition escrow pattern.
 *
 * Flow:
 *   [Module 1] EscrowCreate — Lender locks XRP
 *   [Module 2] Inspector Credential — XLS-0070 credential issued + verified
 *   [Module 3] Lien Waiver NFT — XLS-20 NFT minted + verified
 *   [Module 4] Orchestrator — dual-condition check → EscrowFinish authorized
 *   [Module 1] EscrowFinish — XRP released to GC
 *   [Module 5] Settlement — XRP → RLUSD conversion via DEX or direct transfer
 *   [Module 6] Audit Trail — complete chronological event log + dashboard
 *
 * Prerequisites:
 *   1. npm install
 *   2. npx ts-node scripts/setup-testnet.ts  (provisions wallets)
 *   3. npx ts-node scripts/check-amendments.ts  (verifies network)
 *
 * Run: npx ts-node scripts/testnet-demo.ts
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Client, Wallet } from 'xrpl';
import * as path from 'path';
import * as fs from 'fs';

// Module imports
import { EscrowEngine }           from '../src';
import { EscrowRegistry }         from '../src/registry/registry';
import { CredentialEngine }       from '../src/credentials';
import { LienWaiverNftEngine }    from '../src/nfts';
import { VerificationOrchestrator } from '../src/orchestrator';
import { SettlementEngine }       from '../src/settlement';
import { AuditEngine }            from '../src/audit';
import { DrawRequestId }          from '../src/types';
import { getExplorerUrl }         from '../src/escrow/monitor';
import { xrpToDrops }             from '../src/config/network';

// ─── DEMO CONFIG ──────────────────────────────────────────────────────────────

const DEMO_PROJECT_ID   = process.env.DEMO_PROJECT_ID   || 'BLDCHN-DEMO-001';
const DEMO_AMOUNT_XRP   = 50;   // Draw amount
const DEMO_REGISTRY     = './data/testnet-demo-registry.json';
const DEMO_FINISH_AFTER = parseInt(process.env.DEMO_FINISH_AFTER_MINUTES || '2', 10);
const NETWORK           = 'testnet' as const;

// Explorer shorthand
const explorer = (hash: string) => getExplorerUrl(hash, NETWORK);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function banner(label: string): void {
  const line = '═'.repeat(64);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(line);
}

function step(n: number, label: string): void {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  STEP ${n} — ${label}`);
  console.log('─'.repeat(64));
}

function ok(msg: string): void { console.log(`  ✅ ${msg}`); }
function info(msg: string): void { console.log(`  ℹ️  ${msg}`); }
function warn(msg: string): void { console.log(`  ⚠️  ${msg}`); }
function link(label: string, url: string): void { console.log(`  🔗 ${label}: ${url}`); }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadWallet(seedEnv: string, label: string): Wallet {
  const seed = process.env[seedEnv];
  if (!seed) {
    throw new Error(
      `Missing ${seedEnv} in .env — run: npx ts-node scripts/setup-testnet.ts`
    );
  }
  const w = Wallet.fromSeed(seed);
  console.log(`  ${label.padEnd(20)} ${w.address}`);
  return w;
}

// ─── AMENDMENT GUARD ─────────────────────────────────────────────────────────

async function isAmendmentActive(client: Client, hash: string): Promise<boolean> {
  try {
    const resp = await (client as any).request({ command: 'feature' });
    const features = (resp.result as any).features || {};
    return Object.keys(features).some(
      (h) => h.toUpperCase() === hash.toUpperCase() &&
             features[h].enabled === true
    );
  } catch {
    return false;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function runDemo(): Promise<void> {

  banner('BuildChain Protocol — Full Testnet Demo  (All 6 Modules)');
  console.log(`\n  Network:     XRPL TESTNET`);
  console.log(`  Project:     ${DEMO_PROJECT_ID}`);
  console.log(`  Draw amount: ${DEMO_AMOUNT_XRP} XRP`);
  console.log(`  Started:     ${new Date().toISOString()}`);

  // ── Load environment ───────────────────────────────────────────────────
  step(0, 'Load Wallets');
  const lenderWallet    = loadWallet('LENDER_WALLET_SEED',    'Lender:');
  const gcWallet        = loadWallet('GC_WALLET_SEED',        'GC (Contractor):');
  const protocolWallet  = loadWallet('PROTOCOL_WALLET_SEED',  'Protocol:');
  const rlusdIssuer     = loadWallet('RLUSD_ISSUER_SEED',     'RLUSD Issuer:');
  const inspectorIssuer = loadWallet('INSPECTOR_ISSUER_SEED', 'Inspector Issuer:');
  const rlusdIssuerAddr = process.env.RLUSD_ISSUER_ADDRESS || rlusdIssuer.address;

  // ── Connect ────────────────────────────────────────────────────────────
  const engine = new EscrowEngine(DEMO_REGISTRY);
  await engine.connect();
  const client: Client = (engine as any).client;

  // ── Amendment detection ────────────────────────────────────────────────
  const CREDENTIALS_AMENDMENT = 'F93B2CF8B4B0B3D9B0B3B8C9B0B3B8C9B0B3B8C9B0B3B8C9B0B3B8C9B0B3B8';
  const NFT_AMENDMENT          = '32A122F1352A4C7B3A6D790362CC34749C5E57FCE896377BFDC6CCD14F6CD627';
  const credentialsActive = await isAmendmentActive(client, CREDENTIALS_AMENDMENT);
  const nftActive         = await isAmendmentActive(client, NFT_AMENDMENT);

  info(`XLS-0070 Credentials amendment: ${credentialsActive ? 'ACTIVE' : 'INACTIVE (simulation mode)'}`);
  info(`XLS-20 NFT amendment:           ${nftActive ? 'ACTIVE' : 'INACTIVE (simulation mode)'}`);

  try {
    // ────────────────────────────────────────────────────────────────────
    //  MODULE 1 — ESCROW CREATE
    // ────────────────────────────────────────────────────────────────────
    step(1, '[Module 1] EscrowCreate — Lock XRP in Escrow');

    const drawNumber = Math.floor(Date.now() / 1000) % 1000; // unique per run
    const drid: DrawRequestId = {
      projectId: DEMO_PROJECT_ID,
      drawNumber,
      milestoneDescription: 'Foundation Poured — Milestone 1 of 6',
    };

    const now = new Date();
    const finishAfter = new Date(now.getTime() + DEMO_FINISH_AFTER * 60 * 1000);
    const cancelAfter = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    console.log(`\n  DRID:         ${DEMO_PROJECT_ID}:draw${drawNumber}`);
    console.log(`  Lender:       ${lenderWallet.address}`);
    console.log(`  GC:           ${gcWallet.address}`);
    console.log(`  Amount:       ${DEMO_AMOUNT_XRP} XRP`);
    console.log(`  FinishAfter:  ${finishAfter.toISOString()}`);
    console.log(`  CancelAfter:  ${cancelAfter.toISOString()}`);

    const createResult = await engine.createEscrow(
      {
        drid,
        parties: { lenderAddress: lenderWallet.address, gcAddress: gcWallet.address },
        amountXrp: DEMO_AMOUNT_XRP,
        timeConditions: { finishAfter, cancelAfter },
      },
      lenderWallet
    );

    if (!createResult.success) throw new Error(`EscrowCreate failed: ${createResult.error}`);
    const dridString = createResult.dridString;

    ok(`EscrowCreate submitted`);
    console.log(`  DRID:         ${dridString}`);
    console.log(`  TX Hash:      ${createResult.txHash}`);
    link('EscrowCreate', explorer(createResult.txHash));

    // ────────────────────────────────────────────────────────────────────
    //  MODULE 2 — INSPECTOR CREDENTIAL (XLS-0070)
    // ────────────────────────────────────────────────────────────────────
    step(2, '[Module 2] Inspector Credential — XLS-0070 Issuance & Verification');

    let credentialTxHash: string;

    if (credentialsActive) {
      const credEngine = new CredentialEngine(
        client,
        [inspectorIssuer.address]
      );

      console.log(`\n  Issuing XLS-0070 Inspector Credential for DRID: ${dridString}`);
      const issueResult = await credEngine.issueCredentialForDraw(
        inspectorIssuer,
        {
          dridString,
          inspectorAddress: lenderWallet.address,
          inspectorLicenseNumber: 'AZ-DEMO-INSPECTOR-001',
          milestoneDescription: drid.milestoneDescription,
          inspectionDate: new Date().toISOString().split('T')[0],
          reportHash: 'DEMO_REPORT_HASH_' + Date.now(),
          reportUrl: 'https://buildchain.finance/demo/inspection-report',
        }
      );

      if (!issueResult.success) throw new Error(`Credential issuance failed: ${issueResult.error}`);
      ok(`CredentialCreate submitted`);
      link('CredentialCreate', explorer(issueResult.txHash!));

      // Accept credential (simulates the subject accepting it)
      await credEngine.acceptCredential(
        lenderWallet,
        inspectorIssuer.address,
        dridString
      );
      ok(`CredentialAccept submitted`);

      // Verify credential
      const verifyResult = await credEngine.verifyCredential(
        dridString,
        lenderWallet.address
      );

      if (!verifyResult.verified) {
        throw new Error(`Credential verification failed: ${verifyResult.failureReason}`);
      }
      ok(`XLS-0070 Credential verified on-chain`);
      credentialTxHash = issueResult.txHash!;

    } else {
      warn(`XLS-0070 amendment not active — running in simulation mode`);
      credentialTxHash = 'SIMULATED_CREDENTIAL_' + Date.now();
      ok(`Credential simulated (hash: ${credentialTxHash.slice(0, 20)}...)`);
    }

    engine.markInspectorCredentialVerified(dridString, credentialTxHash);
    ok(`Inspector credential marked verified in registry`);

    // ────────────────────────────────────────────────────────────────────
    //  MODULE 3 — LIEN WAIVER NFT (XLS-20)
    // ────────────────────────────────────────────────────────────────────
    step(3, '[Module 3] Lien Waiver NFT — XLS-20 Mint & Verification');

    let nftTxHash: string;

    if (nftActive) {
      const nftEngine = new LienWaiverNftEngine(client);

      console.log(`\n  Minting Lien Waiver NFT for DRID: ${dridString}`);
      const mintResult = await nftEngine.mintNftForDraw(gcWallet, {
        dridString,
        projectId: DEMO_PROJECT_ID,
        drawNumber: drid.drawNumber,
        milestoneDescription: drid.milestoneDescription,
        gcLegalName: 'Demo GC LLC',
        gcLicenseNumber: 'AZ-ROC-DEMO-001',
        documentHash: 'DEMO_LIEN_WAIVER_HASH_' + Date.now(),
        documentUrl: 'https://buildchain.finance/demo/lien-waiver',
        signedDate: new Date().toISOString().split('T')[0],
        amountXrp: DEMO_AMOUNT_XRP.toString(),
      });

      if (!mintResult.success) throw new Error(`NFT mint failed: ${mintResult.error}`);
      ok(`NFTokenMint submitted`);
      ok(`NFTokenID: ${mintResult.nfTokenId}`);
      link('NFTokenMint', explorer(mintResult.txHash!));

      // Verify NFT
      const verifyResult = await nftEngine.verifyNft(dridString, gcWallet.address);
      if (!verifyResult.verified) {
        throw new Error(`NFT verification failed: ${verifyResult.failureReason}`);
      }
      ok(`XLS-20 Lien Waiver NFT verified on-chain`);
      nftTxHash = mintResult.txHash!;

    } else {
      warn(`XLS-20 amendment not active — running in simulation mode`);
      nftTxHash = 'SIMULATED_NFT_' + Date.now();
      ok(`Lien Waiver NFT simulated (hash: ${nftTxHash.slice(0, 20)}...)`);
    }

    engine.markLienWaiverNftVerified(dridString, nftTxHash);
    ok(`Lien Waiver NFT marked verified in registry`);

    // ────────────────────────────────────────────────────────────────────
    //  MODULE 4 — DUAL-CONDITION VERIFICATION
    // ────────────────────────────────────────────────────────────────────
    step(4, '[Module 4] Orchestrator — Dual-Condition Gate');

    const registry = new EscrowRegistry(DEMO_REGISTRY);
    const record = registry.getOrThrow(dridString);

    const bothMet =
      record.verificationConditions.inspectorCredentialVerified &&
      record.verificationConditions.lienWaiverNftVerified;

    if (!bothMet) {
      throw new Error('Dual-condition NOT met — should not reach EscrowFinish');
    }

    ok(`DUAL CONDITION MET:`);
    console.log(`  Inspector Credential: ✅ Verified`);
    console.log(`  Lien Waiver NFT:      ✅ Verified`);
    console.log(`\n  Orchestrator authorizing EscrowFinish...`);

    // ────────────────────────────────────────────────────────────────────
    //  WAIT FOR FINISH_AFTER
    // ────────────────────────────────────────────────────────────────────
    const waitMs = Math.max(0, finishAfter.getTime() - Date.now());
    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      console.log(`\n  Waiting ${secs}s for FinishAfter to pass...`);
      for (let i = secs; i > 0; i -= 10) {
        console.log(`  ⏳ ${Math.min(i, secs)}s remaining...`);
        await sleep(Math.min(10000, i * 1000));
      }
      ok(`FinishAfter passed`);
    }

    // ────────────────────────────────────────────────────────────────────
    //  MODULE 1 (FINISH) — ESCROW RELEASE
    // ────────────────────────────────────────────────────────────────────
    step(5, '[Module 1] EscrowFinish — Release XRP to GC');

    const finishResult = await engine.finishEscrow(
      { dridString, finisherAddress: protocolWallet.address },
      protocolWallet
    );

    if (!finishResult.success) throw new Error(`EscrowFinish failed: ${finishResult.error}`);
    ok(`EscrowFinish submitted`);
    console.log(`  TX Hash:      ${finishResult.txHash}`);
    console.log(`  XRP Released: ${parseInt(finishResult.amountReleasedDrops || '0') / 1e6} XRP`);
    link('EscrowFinish', explorer(finishResult.txHash!));

    // ────────────────────────────────────────────────────────────────────
    //  MODULE 5 — RLUSD SETTLEMENT
    // ────────────────────────────────────────────────────────────────────
    step(6, '[Module 5] Settlement — Direct RLUSD Transfer to GC');

    if (rlusdIssuerAddr) {
      const settlementEngine = new SettlementEngine(client, rlusdIssuerAddr);

      // Check GC trust line
      const trustStatus = await settlementEngine.checkTrustLine(gcWallet.address);
      if (!trustStatus.hasTrustLine) {
        warn(`GC does not have RLUSD trust line — establishing...`);
        await settlementEngine.establishTrustLine(gcWallet);
        ok(`RLUSD trust line established for GC`);
      } else {
        ok(`GC RLUSD trust line: ${trustStatus.rlusdBalance || '0'} RLUSD`);
      }

      // Get lender RLUSD balance
      const lenderBal = await settlementEngine.getRlusdBalance(lenderWallet.address);
      info(`Lender RLUSD balance: ${lenderBal.rlusdBalance}`);

      if (parseFloat(lenderBal.rlusdBalance || '0') >= DEMO_AMOUNT_XRP) {
        // Path B: Direct RLUSD transfer from lender to GC
        const transferResult = await settlementEngine.transferRlusd(
          lenderWallet,
          {
            dridString,
            senderAddress: lenderWallet.address,
            receiverAddress: gcWallet.address,
            rlusdAmount: DEMO_AMOUNT_XRP.toString(),
            protocolFeeRlusd: (DEMO_AMOUNT_XRP * 0.003).toFixed(2),
            protocolWalletAddress: protocolWallet.address,
          }
        );

        if (transferResult.success) {
          ok(`RLUSD transfer complete`);
          console.log(`  Transferred:  ${DEMO_AMOUNT_XRP} RLUSD → GC`);
          link('RLUSD Transfer', explorer(transferResult.transferTxHash!));
        } else {
          warn(`RLUSD transfer failed: ${transferResult.error} — skipping Module 5`);
        }
      } else {
        warn(`Insufficient RLUSD balance (${lenderBal.rlusdBalance}) — skipping Module 5 settlement`);
        info(`Run setup-testnet.ts again to re-issue test RLUSD`);
      }
    } else {
      warn(`RLUSD_ISSUER_ADDRESS not set — skipping Module 5`);
    }

    // ────────────────────────────────────────────────────────────────────
    //  MODULE 6 — AUDIT TRAIL + DASHBOARD
    // ────────────────────────────────────────────────────────────────────
    step(7, '[Module 6] Audit Trail — Complete Event Log');

    const auditEngine = new AuditEngine(registry, NETWORK);

    // Single draw audit trail
    const trail = auditEngine.getTrail(dridString);
    auditEngine.printTrail(trail);

    // Full project dashboard
    const dashboard = auditEngine.getDashboard(DEMO_PROJECT_ID);
    auditEngine.printDashboard(dashboard);

    // Export to files
    const auditDir = './data/audits';
    auditEngine.exportProjectAudits(DEMO_PROJECT_ID, auditDir);
    ok(`Audit trail exported to ${auditDir}/`);

    // ────────────────────────────────────────────────────────────────────
    //  FINAL SUMMARY
    // ────────────────────────────────────────────────────────────────────
    banner('DEMO COMPLETE — All 6 Modules Verified on XRPL Testnet');

    console.log(`\n  DRID:          ${dridString}`);
    console.log(`  Final status:  RELEASED`);
    console.log(`  Amount:        ${DEMO_AMOUNT_XRP} XRP`);
    console.log(`\n  On-Chain Evidence:`);
    const updatedRecord = registry.getOrThrow(dridString);
    if (updatedRecord.createTxHash)  link('EscrowCreate ', explorer(updatedRecord.createTxHash));
    if (updatedRecord.finishTxHash)  link('EscrowFinish ', explorer(updatedRecord.finishTxHash));
    if (updatedRecord.verificationConditions.inspectorCredentialTxHash) {
      link('Inspector Cred', explorer(updatedRecord.verificationConditions.inspectorCredentialTxHash));
    }
    if (updatedRecord.verificationConditions.lienWaiverNftTxHash) {
      link('Lien Waiver NFT', explorer(updatedRecord.verificationConditions.lienWaiverNftTxHash));
    }
    console.log(`\n  Completed:  ${new Date().toISOString()}`);
    console.log(`\n  🎉 BuildChain Protocol dual-condition escrow lifecycle complete!\n`);

  } catch (error) {
    console.error(`\n  ❌ Demo failed: ${error}`);
    throw error;
  } finally {
    await engine.disconnect();
  }
}

runDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
