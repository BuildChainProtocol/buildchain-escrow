/**
 * BuildChain Protocol — Testnet Environment Setup
 *
 * Provisions everything needed to run the BuildChain demo on XRPL testnet:
 *
 *   1. Funds 4 wallets from testnet faucet:
 *        - Lender wallet     (funds escrow, receives if cancelled)
 *        - GC wallet         (receives released funds)
 *        - Protocol wallet   (submits EscrowFinish, collects protocol fee)
 *        - RLUSD Issuer      (test IOU issuer for Module 5 settlement)
 *
 *   2. Configures RLUSD trust lines:
 *        - Lender → RLUSD Issuer (to receive RLUSD if needed)
 *        - GC → RLUSD Issuer     (to receive RLUSD settlement)
 *        - Protocol → RLUSD Issuer (to receive RLUSD protocol fees)
 *
 *   3. Issues test RLUSD to lender (1,000 RLUSD for demo)
 *
 *   4. Writes all seeds and addresses to .env
 *
 * Run: npx ts-node scripts/setup-testnet.ts
 *
 * ⚠️  This uses the XRPL testnet faucet. Do NOT run on mainnet.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Client, Wallet, xrpToDrops } from 'xrpl';
import * as fs from 'fs';
import * as path from 'path';
import { NETWORK_URLS } from '../src/config/network';

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const RLUSD_TRUST_LIMIT = '1000000';   // 1,000,000 RLUSD trust limit
const RLUSD_ISSUE_AMOUNT = '10000';    // 10,000 RLUSD issued to lender for demo
const ENV_PATH = path.join(process.cwd(), '.env');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function separator(label: string): void {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${label}`);
  console.log('═'.repeat(64));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Update (or create) a key in the .env file.
 * Preserves all existing keys.
 */
function updateEnv(updates: Record<string, string>): void {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}=${value}`;
    if (regex.test(content)) {
      content = content.replace(regex, newLine);
    } else {
      content += `\n${newLine}`;
    }
  }

  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

/**
 * Fund a wallet from testnet faucet, with retry.
 */
async function fundFromFaucet(
  client: Client,
  label: string,
  existingSeed?: string
): Promise<Wallet> {
  if (existingSeed) {
    const wallet = Wallet.fromSeed(existingSeed);
    console.log(`  ✅ ${label}: ${wallet.address} (reused from .env)`);
    return wallet;
  }

  console.log(`  🚰 Funding ${label} from testnet faucet...`);
  try {
    const { wallet } = await (client as any).fundWallet();
    console.log(`  ✅ ${label}: ${wallet.address}`);
    console.log(`     Seed: ${wallet.seed}`);
    return wallet;
  } catch (err) {
    console.error(`  ❌ Faucet failed for ${label}: ${err}`);
    throw err;
  }
}

/**
 * Establish RLUSD trust line from account → issuer.
 */
async function establishTrustLine(
  client: Client,
  wallet: Wallet,
  issuerAddress: string,
  label: string
): Promise<void> {
  console.log(`  Setting RLUSD trust line: ${label} → RLUSD issuer...`);
  try {
    const tx = await client.submitAndWait(
      {
        TransactionType: 'TrustSet',
        Account: wallet.address,
        LimitAmount: {
          currency: 'RLUSD',
          issuer: issuerAddress,
          value: RLUSD_TRUST_LIMIT,
        },
        Fee: '12',
      },
      { wallet }
    );

    const meta = (tx.result as any).meta;
    const resultCode = meta?.TransactionResult || 'UNKNOWN';
    if (resultCode === 'tesSUCCESS') {
      console.log(`  ✅ Trust line established: ${label}`);
    } else {
      console.warn(`  ⚠️  Trust line result: ${resultCode}`);
    }
  } catch (err) {
    console.error(`  ❌ Trust line failed for ${label}: ${err}`);
    throw err;
  }
}

/**
 * Issue RLUSD from issuer to recipient.
 */
async function issueRlusd(
  client: Client,
  issuerWallet: Wallet,
  recipientAddress: string,
  amount: string,
  label: string
): Promise<void> {
  console.log(`  Issuing ${amount} RLUSD to ${label}...`);
  try {
    const tx = await client.submitAndWait(
      {
        TransactionType: 'Payment',
        Account: issuerWallet.address,
        Destination: recipientAddress,
        Amount: {
          currency: 'RLUSD',
          issuer: issuerWallet.address,
          value: amount,
        },
        Fee: '12',
      },
      { wallet: issuerWallet }
    );

    const meta = (tx.result as any).meta;
    const resultCode = meta?.TransactionResult || 'UNKNOWN';
    if (resultCode === 'tesSUCCESS') {
      console.log(`  ✅ Issued ${amount} RLUSD to ${label}`);
    } else {
      console.warn(`  ⚠️  RLUSD issuance result: ${resultCode}`);
    }
  } catch (err) {
    console.error(`  ❌ RLUSD issuance failed: ${err}`);
    throw err;
  }
}

/**
 * Get XRP balance.
 */
async function getBalance(client: Client, address: string): Promise<number> {
  try {
    const resp = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    const drops = (resp.result as any).account_data.Balance;
    return parseInt(drops, 10) / 1_000_000;
  } catch {
    return 0;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const network = 'testnet' as const;
  const url = NETWORK_URLS[network];

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  BuildChain Protocol — Testnet Setup`);
  console.log(`  Network: TESTNET — ${url}`);
  console.log('═'.repeat(64));
  console.log(`\n  ⚠️  This script uses the XRPL testnet faucet.`);
  console.log(`      Each wallet receives ~1,000 XRP (testnet only — no real value).`);
  console.log(`      Run time: ~60–90 seconds`);

  if (process.env.XRPL_NETWORK === 'mainnet') {
    console.error('\n  ❌ MAINNET detected in .env. Refusing to run setup on mainnet.');
    process.exit(1);
  }

  const client = new Client(url);

  try {
    console.log(`\n  Connecting to ${url}...`);
    await client.connect();
    console.log(`  ✅ Connected`);

    // ── STEP 1: Fund wallets ───────────────────────────────────────────────
    separator('STEP 1 — Fund Wallets from Testnet Faucet');
    console.log(`  (Each faucet call takes ~10–15 seconds)\n`);

    const lenderWallet   = await fundFromFaucet(client, 'Lender',          process.env.LENDER_WALLET_SEED);
    await sleep(3000);
    const gcWallet       = await fundFromFaucet(client, 'GC (Contractor)', process.env.GC_WALLET_SEED);
    await sleep(3000);
    const protocolWallet = await fundFromFaucet(client, 'Protocol',        process.env.PROTOCOL_WALLET_SEED);
    await sleep(3000);
    const rlusdIssuer    = await fundFromFaucet(client, 'RLUSD Issuer',    process.env.RLUSD_ISSUER_SEED);
    await sleep(3000);

    // Inspector issuer (for XLS-0070 credentials) — same as lender in testnet demo
    // In production this would be a separate trusted inspector credential issuer
    const inspectorIssuer = await fundFromFaucet(client, 'Inspector Issuer', process.env.INSPECTOR_ISSUER_SEED);
    await sleep(3000);

    // ── STEP 2: Check initial balances ────────────────────────────────────
    separator('STEP 2 — Initial XRP Balances');
    for (const [label, wallet] of [
      ['Lender',          lenderWallet],
      ['GC',              gcWallet],
      ['Protocol',        protocolWallet],
      ['RLUSD Issuer',    rlusdIssuer],
      ['Inspector Issuer',inspectorIssuer],
    ] as [string, Wallet][]) {
      const bal = await getBalance(client, wallet.address);
      console.log(`  ${label.padEnd(20)} ${wallet.address}  ${bal.toFixed(2)} XRP`);
    }

    // ── STEP 3: Configure RLUSD trust lines ───────────────────────────────
    separator('STEP 3 — Configure RLUSD Trust Lines');
    console.log(`  RLUSD Issuer: ${rlusdIssuer.address}\n`);

    await establishTrustLine(client, lenderWallet,   rlusdIssuer.address, 'Lender');
    await sleep(2000);
    await establishTrustLine(client, gcWallet,       rlusdIssuer.address, 'GC');
    await sleep(2000);
    await establishTrustLine(client, protocolWallet, rlusdIssuer.address, 'Protocol');
    await sleep(2000);

    // ── STEP 4: Issue test RLUSD ──────────────────────────────────────────
    separator('STEP 4 — Issue Test RLUSD');
    await issueRlusd(client, rlusdIssuer, lenderWallet.address,   RLUSD_ISSUE_AMOUNT, 'Lender');
    await sleep(2000);
    await issueRlusd(client, rlusdIssuer, protocolWallet.address, '1000', 'Protocol');
    await sleep(2000);

    // ── STEP 5: Write to .env ─────────────────────────────────────────────
    separator('STEP 5 — Save Configuration to .env');

    const envUpdates: Record<string, string> = {
      XRPL_NETWORK:              'testnet',
      LENDER_WALLET_SEED:        lenderWallet.seed!,
      LENDER_WALLET_ADDRESS:     lenderWallet.address,
      GC_WALLET_SEED:            gcWallet.seed!,
      GC_WALLET_ADDRESS:         gcWallet.address,
      PROTOCOL_WALLET_SEED:      protocolWallet.seed!,
      PROTOCOL_WALLET_ADDRESS:   protocolWallet.address,
      RLUSD_ISSUER_SEED:         rlusdIssuer.seed!,
      RLUSD_ISSUER_ADDRESS:      rlusdIssuer.address,
      INSPECTOR_ISSUER_SEED:     inspectorIssuer.seed!,
      INSPECTOR_ISSUER_ADDRESS:  inspectorIssuer.address,
    };

    updateEnv(envUpdates);
    console.log(`\n  ✅ All seeds and addresses saved to .env`);
    console.log(`     Path: ${ENV_PATH}`);
    console.log(`\n  ⚠️  SECURITY: .env is in .gitignore — never commit it to git.`);

    // ── STEP 6: Print summary ─────────────────────────────────────────────
    separator('SETUP COMPLETE');
    console.log(`\n  Wallets provisioned:`);
    console.log(`    Lender:           ${lenderWallet.address}`);
    console.log(`    GC:               ${gcWallet.address}`);
    console.log(`    Protocol:         ${protocolWallet.address}`);
    console.log(`    RLUSD Issuer:     ${rlusdIssuer.address}`);
    console.log(`    Inspector Issuer: ${inspectorIssuer.address}`);
    console.log(`\n  RLUSD issued:`);
    console.log(`    Lender:    ${RLUSD_ISSUE_AMOUNT} RLUSD`);
    console.log(`    Protocol:  1,000 RLUSD`);
    console.log(`\n  Explorer: https://testnet.xrpl.org/accounts/${lenderWallet.address}`);

    console.log(`\n${'─'.repeat(64)}`);
    console.log(`  Next steps:`);
    console.log(`    1. npx ts-node scripts/check-amendments.ts   (verify network)`);
    console.log(`    2. npx ts-node scripts/testnet-demo.ts       (run full demo)`);
    console.log(`    3. npx ts-node scripts/demo-full.ts          (cinematic demo)`);
    console.log(`${'─'.repeat(64)}\n`);

  } catch (error) {
    console.error(`\n  ❌ Setup failed: ${error}`);
    process.exit(1);
  } finally {
    await client.disconnect();
    console.log(`  🔌 Disconnected`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
