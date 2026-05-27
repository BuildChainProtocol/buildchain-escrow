/**
 * BuildChain Protocol — Module 1 Testnet Demo
 *
 * Runs the full escrow lifecycle against XRPL Testnet:
 *   1. Fund two testnet wallets (lender + protocol)
 *   2. Create an escrow (EscrowCreate)
 *   3. Check status (on-chain + registry)
 *   4. Simulate dual-condition verification
 *   5. Release the escrow (EscrowFinish)
 *   6. Print final balances + explorer links
 *
 * Optionally also demonstrates the cancel flow.
 *
 * Run: npx ts-node scripts/demo.ts
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Wallet } from 'xrpl';
import { EscrowEngine } from '../src';
import { DrawRequestId } from '../src/types';

// ─── DEMO CONFIG ──────────────────────────────────────────────────────────────

const DEMO_AMOUNT_XRP = 100; // Draw amount for demo
const DEMO_PROJECT_ID = 'BLDCHN-DEMO-001';
const DEMO_DRAW_NUMBER = 1;
const DEMO_MILESTONE = 'Foundation Poured — Milestone 1 of 6';
const DEMO_REGISTRY_PATH = './data/demo-registry.json';

// Use short time windows for demo (override defaults)
const DEMO_FINISH_AFTER_MINUTES = 1;  // 1 minute for demo
const DEMO_CANCEL_AFTER_DAYS = 90;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function separator(label: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('═'.repeat(60));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── MAIN DEMO ────────────────────────────────────────────────────────────────

async function runDemo(): Promise<void> {
  const engine = new EscrowEngine(DEMO_REGISTRY_PATH);

  try {
    // ── STEP 1: Connect ────────────────────────────────────────────────────
    separator('STEP 1 — Connect to XRPL Testnet');
    await engine.connect();

    // ── STEP 2: Generate / load wallets ───────────────────────────────────
    separator('STEP 2 — Set Up Wallets');

    let lenderWallet: Wallet;
    let protocolWallet: Wallet;

    if (process.env.LENDER_WALLET_SEED && process.env.PROTOCOL_WALLET_SEED) {
      // Use existing seeds from .env
      lenderWallet = Wallet.fromSeed(process.env.LENDER_WALLET_SEED);
      protocolWallet = Wallet.fromSeed(process.env.PROTOCOL_WALLET_SEED);
      console.log(`   Lender wallet:   ${lenderWallet.address} (from .env)`);
      console.log(`   Protocol wallet: ${protocolWallet.address} (from .env)`);
    } else {
      // Generate fresh testnet wallets (funded by testnet faucet)
      console.log(`   Generating fresh testnet wallets...`);
      console.log(`   (This calls the XRPL testnet faucet — may take ~10s)`);

      // Note: In production remove faucet usage. Use Wallet.fromSeed() with secure key management.
      const { wallet: lw } = await (engine as any).client.fundWallet();
      const { wallet: pw } = await (engine as any).client.fundWallet();

      lenderWallet = lw;
      protocolWallet = pw;

      console.log(`   ✅ Lender wallet:   ${lenderWallet.address}`);
      console.log(`   ✅ Protocol wallet: ${protocolWallet.address}`);
      console.log(`\n   💾 Save these seeds in your .env to reuse:`);
      console.log(`   LENDER_WALLET_SEED=${lenderWallet.seed}`);
      console.log(`   PROTOCOL_WALLET_SEED=${protocolWallet.seed}`);
    }

    // GC address — in demo, use protocol wallet as GC for simplicity
    const gcAddress = protocolWallet.address;

    // ── STEP 3: Check initial balances ────────────────────────────────────
    separator('STEP 3 — Initial Balances');
    await engine.getBalance(lenderWallet.address);
    await engine.getBalance(gcAddress);

    // ── STEP 4: Create escrow ─────────────────────────────────────────────
    separator('STEP 4 — Create Escrow (EscrowCreate)');

    const drid: DrawRequestId = {
      projectId: DEMO_PROJECT_ID,
      drawNumber: DEMO_DRAW_NUMBER,
      milestoneDescription: DEMO_MILESTONE,
    };

    const now = new Date();
    const finishAfter = new Date(now.getTime() + DEMO_FINISH_AFTER_MINUTES * 60 * 1000);
    const cancelAfter = new Date(now.getTime() + DEMO_CANCEL_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const createResult = await engine.createEscrow(
      {
        drid,
        parties: {
          lenderAddress: lenderWallet.address,
          gcAddress,
        },
        amountXrp: DEMO_AMOUNT_XRP,
        timeConditions: { finishAfter, cancelAfter },
      },
      lenderWallet
    );

    if (!createResult.success) {
      throw new Error(`EscrowCreate failed: ${createResult.error}`);
    }

    const { dridString } = createResult;
    console.log(`\n   DRID: ${dridString}`);

    // ── STEP 5: Check status (on-chain + registry) ────────────────────────
    separator('STEP 5 — Status After Create');
    await engine.getStatus(dridString);

    // ── STEP 6: Simulate Module 4 — Verify both conditions ────────────────
    separator('STEP 6 — Dual-Condition Verification (Module 4 Simulation)');

    // In production, Module 4 Orchestrator performs real on-chain credential
    // and NFT verification. Here we simulate with placeholder TX hashes.
    const simulatedCredentialTxHash = 'SIMULATED_CREDENTIAL_TX_' + Date.now();
    const simulatedNftTxHash = 'SIMULATED_LIEN_WAIVER_NFT_TX_' + Date.now();

    console.log(`\n   Simulating XLS-0070 Inspector Credential verification...`);
    engine.markInspectorCredentialVerified(dridString, simulatedCredentialTxHash);

    console.log(`\n   Simulating XLS-20 Lien Waiver NFT verification...`);
    engine.markLienWaiverNftVerified(dridString, simulatedNftTxHash);

    // ── STEP 7: Check status after dual-condition met ─────────────────────
    separator('STEP 7 — Status After Dual-Condition Met');
    await engine.getStatus(dridString);

    // ── STEP 8: Wait for FinishAfter to pass ─────────────────────────────
    const waitMs = Math.max(0, finishAfter.getTime() - Date.now());
    if (waitMs > 0) {
      separator('STEP 8 — Waiting for FinishAfter');
      const waitSecs = Math.ceil(waitMs / 1000);
      console.log(`\n   FinishAfter: ${finishAfter.toISOString()}`);
      console.log(`   Waiting ${waitSecs}s for FinishAfter to pass...`);
      await sleep(waitMs + 2000); // +2s buffer
      console.log(`   ✅ FinishAfter passed.`);
    }

    // ── STEP 9: Release escrow (EscrowFinish) ─────────────────────────────
    separator('STEP 9 — Release Escrow (EscrowFinish)');

    const finishResult = await engine.finishEscrow(
      {
        dridString,
        finisherAddress: protocolWallet.address,
      },
      protocolWallet
    );

    if (!finishResult.success) {
      throw new Error(`EscrowFinish failed: ${finishResult.error}`);
    }

    // ── STEP 10: Final balances and registry summary ──────────────────────
    separator('STEP 10 — Final State');

    await engine.getStatus(dridString);
    await engine.getBalance(lenderWallet.address);
    await engine.getBalance(gcAddress);
    engine.printSummary();
    engine.printLinks(dridString);

    console.log(`\n\n🎉 Module 1 Demo Complete — Full escrow lifecycle verified on XRPL Testnet!`);

  } catch (error) {
    console.error(`\n❌ Demo failed: ${error}`);
    throw error;
  } finally {
    await engine.disconnect();
  }
}

// ─── RUN ──────────────────────────────────────────────────────────────────────

runDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
