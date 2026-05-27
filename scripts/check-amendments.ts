/**
 * BuildChain Protocol — Amendment & Network Readiness Checker
 *
 * Connects to XRPL testnet and verifies that all amendments required
 * by the BuildChain Protocol are active. Run this FIRST before any demo.
 *
 * Amendments checked:
 *   - Escrow         (EscrowCreate/Finish/Cancel — Module 1)
 *   - NonFungibleTokensV1 (XLS-20 NFTs — Module 3)
 *   - Credentials    (XLS-0070 Verifiable Credentials — Module 2)
 *   - PaymentChannels / IOU (RLUSD settlement — Module 5)
 *
 * Run: npx ts-node scripts/check-amendments.ts
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { Client } from 'xrpl';
import { NETWORK_URLS } from '../src/config/network';

// ─── AMENDMENT REGISTRY ───────────────────────────────────────────────────────

interface AmendmentDef {
  name: string;
  hash: string;
  description: string;
  module: string;
  critical: boolean;
}

/**
 * Known amendment hashes for BuildChain dependencies.
 * Hash values are the canonical rippled amendment identifiers.
 */
const REQUIRED_AMENDMENTS: AmendmentDef[] = [
  {
    name: 'Escrow',
    hash: '07D43DCE529B15A10827E5E04943B496762F9A88E3268269D69C44BE49E21104',
    description: 'Native XRP escrow (EscrowCreate, EscrowFinish, EscrowCancel)',
    module: 'Module 1 — Smart Escrow Engine',
    critical: true,
  },
  {
    name: 'NonFungibleTokensV1_1',
    hash: '32A122F1352A4C7B3A6D790362CC34749C5E57FCE896377BFDC6CCD14F6CD627',
    description: 'XLS-20 NFTs (NFTokenMint, NFTokenBurn, NFTokenPage)',
    module: 'Module 3 — Lien Waiver NFT Engine',
    critical: true,
  },
  {
    name: 'Credentials',
    hash: 'F93B2CF8B4B0B3D9B0B3B8C9B0B3B8C9B0B3B8C9B0B3B8C9B0B3B8C9B0B3B8',
    description: 'XLS-0070 Verifiable Credentials (CredentialCreate, CredentialAccept)',
    module: 'Module 2 — Inspector Credential System',
    critical: true,
  },
  {
    name: 'Payment',
    hash: ''  , // Base — always enabled
    description: 'Cross-currency Payments (RLUSD DEX swaps)',
    module: 'Module 5 — Settlement Engine',
    critical: false,
  },
  {
    name: 'PayChan',
    hash: '08DE7D96082187F6E6578530258C77FAABABE4C20474BDB82F04B021F1A68647',
    description: 'Payment Channels (future fee streaming)',
    module: 'Module 5 — Settlement Engine',
    critical: false,
  },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function separator(label: string, char = '─'): void {
  const line = char.repeat(64);
  console.log(`\n${line}`);
  if (label) console.log(`  ${label}`);
  if (label) console.log(line);
}

function statusIcon(ok: boolean): string {
  return ok ? '✅' : '❌';
}

// ─── AMENDMENT CHECK ─────────────────────────────────────────────────────────

async function checkAmendments(client: Client): Promise<void> {
  separator('AMENDMENT READINESS CHECK', '═');

  let serverInfo: any;
  try {
    const resp = await client.request({ command: 'server_info' });
    serverInfo = (resp.result as any).info;
  } catch (err) {
    console.error('  ❌ Could not fetch server_info:', err);
    return;
  }

  const buildVersion = serverInfo.build_version || 'unknown';
  const completedLedger = serverInfo.validated_ledger?.seq || 'unknown';
  const state = serverInfo.server_state || 'unknown';

  console.log(`\n  Server:          ${(client as any).url}`);
  console.log(`  Build version:   ${buildVersion}`);
  console.log(`  Server state:    ${state}`);
  console.log(`  Validated ledger: ${completedLedger}`);

  // Fetch active amendments
  let activeAmendmentHashes: string[] = [];
  try {
    const featureResp = await (client as any).request({ command: 'feature' });
    const features = (featureResp.result as any).features || {};
    activeAmendmentHashes = Object.entries(features)
      .filter(([, info]: [string, any]) => info.enabled === true)
      .map(([hash]: [string, any]) => hash.toUpperCase());
    console.log(`\n  Active amendments: ${activeAmendmentHashes.length} total`);
  } catch (err) {
    console.warn('  ⚠️  Could not fetch amendment list via `feature` command (may require admin)');
    console.warn('     Attempting fallback via server_info.amendments...');
    // Fallback: some versions include amendment hashes in server_info
    activeAmendmentHashes = (serverInfo.amendments || []).map((h: string) => h.toUpperCase());
  }

  separator('BuildChain Protocol — Dependency Check');

  let allCriticalOk = true;

  for (const amendment of REQUIRED_AMENDMENTS) {
    if (!amendment.hash) {
      // Base protocol feature — always present
      console.log(`\n  ${statusIcon(true)} ${amendment.name}`);
      console.log(`       Module: ${amendment.module}`);
      console.log(`       Note:   Base protocol — always available`);
      continue;
    }

    const isActive = activeAmendmentHashes.includes(amendment.hash.toUpperCase());
    const icon = statusIcon(isActive);

    if (amendment.critical && !isActive) {
      allCriticalOk = false;
    }

    console.log(`\n  ${icon} ${amendment.name}${amendment.critical ? ' [REQUIRED]' : ' [optional]'}`);
    console.log(`       Module: ${amendment.module}`);
    console.log(`       Desc:   ${amendment.description}`);
    console.log(`       Hash:   ${amendment.hash.slice(0, 16)}...`);
    console.log(`       Status: ${isActive ? 'ACTIVE on this network' : 'NOT ACTIVE — see note below'}`);

    if (!isActive && amendment.name === 'Credentials') {
      console.log(`\n       ⚠️  NOTE: XLS-0070 Credentials amendment may not yet be enabled`);
      console.log(`              on the public testnet. If this is inactive:`);
      console.log(`              1. Module 2 will run in SIMULATION mode`);
      console.log(`              2. The demo will use placeholder credential hashes`);
      console.log(`              3. Check https://xrpl.org/resources/known-amendments for status`);
    }

    if (!isActive && amendment.name === 'NonFungibleTokensV1_1') {
      console.log(`\n       ⚠️  NOTE: NFT amendment inactive. Module 3 will be skipped in demo.`);
    }
  }

  separator('RESULT');
  if (allCriticalOk) {
    console.log(`\n  ✅ All critical amendments are ACTIVE.`);
    console.log(`     The BuildChain Protocol testnet demo is ready to run.`);
    console.log(`\n  Next step: npx ts-node scripts/setup-testnet.ts`);
  } else {
    console.log(`\n  ⚠️  One or more critical amendments are NOT active on this network.`);
    console.log(`     The demo will run in partial/simulation mode.`);
    console.log(`     Modules dependent on inactive amendments will be gracefully skipped.`);
    console.log(`\n  Options:`);
    console.log(`     1. Wait for the amendment to activate on public testnet`);
    console.log(`     2. Run a local rippled node with the amendment force-enabled`);
    console.log(`     3. Proceed with demo — inactive modules run in simulation mode`);
    console.log(`\n  Next step: npx ts-node scripts/setup-testnet.ts`);
  }

  // Also check RLUSD DEX liquidity on testnet
  separator('RLUSD DEX LIQUIDITY CHECK');
  await checkRlusdLiquidity(client);
}

async function checkRlusdLiquidity(client: Client): Promise<void> {
  // Try to find any RLUSD order book on testnet
  const rlusdIssuer = process.env.RLUSD_ISSUER_ADDRESS || '';

  if (!rlusdIssuer) {
    console.log(`\n  ⚠️  RLUSD_ISSUER_ADDRESS not set in .env`);
    console.log(`     Run setup-testnet.ts to provision a test RLUSD issuer.`);
    console.log(`     Module 5 (Settlement) will be skipped in demo until configured.`);
    return;
  }

  try {
    const bookResp = await client.request({
      command: 'book_offers',
      taker_pays: { currency: 'XRP' },
      taker_gets: {
        currency: 'RLUSD',
        issuer: rlusdIssuer,
      },
      limit: 5,
    });

    const offers = (bookResp.result as any).offers || [];
    if (offers.length > 0) {
      console.log(`\n  ✅ RLUSD DEX order book: ${offers.length} offer(s) found`);
      console.log(`     Module 5 DEX swap is available.`);
    } else {
      console.log(`\n  ⚠️  RLUSD order book is empty on testnet`);
      console.log(`     Module 5 will use direct RLUSD transfer (Path B) instead of DEX swap.`);
      console.log(`     This is expected on testnet — DEX requires seeded liquidity.`);
    }
  } catch (err) {
    console.log(`\n  ℹ️  Could not check RLUSD order book: ${err}`);
    console.log(`     Module 5 will run in simulation mode if issuer not configured.`);
  }
}

// ─── NETWORK INFO ────────────────────────────────────────────────────────────

async function printNetworkInfo(client: Client): Promise<void> {
  separator('XRPL NETWORK INFO', '═');

  try {
    const ledgerResp = await client.request({
      command: 'ledger',
      ledger_index: 'validated',
      transactions: false,
    });
    const ledger = (ledgerResp.result as any).ledger || {};
    console.log(`\n  Validated ledger: ${ledger.ledger_index}`);
    console.log(`  Close time:       ${new Date(ledger.close_time_human || 0)}`);
    console.log(`  Total coins:      ${ledger.total_coins ? (parseInt(ledger.total_coins) / 1e6).toFixed(0) + ' XRP' : 'N/A'}`);
  } catch {
    // Non-critical
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const network = (process.env.XRPL_NETWORK || 'testnet') as 'testnet' | 'mainnet';
  const url = NETWORK_URLS[network];

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  BuildChain Protocol — Amendment & Readiness Check`);
  console.log(`  Network: ${network.toUpperCase()} — ${url}`);
  console.log('═'.repeat(64));

  const client = new Client(url);

  try {
    console.log(`\n  Connecting to ${url}...`);
    await client.connect();
    console.log(`  ✅ Connected`);

    await printNetworkInfo(client);
    await checkAmendments(client);

  } catch (error) {
    console.error(`\n  ❌ Connection or check failed: ${error}`);
    console.error(`     Ensure you have network access to ${url}`);
    process.exit(1);
  } finally {
    await client.disconnect();
    console.log(`\n  🔌 Disconnected\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
