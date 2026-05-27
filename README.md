# BuildChain Protocol

**Blockchain-Native Construction Draw Escrow — Built on XRPL**

[![CI](https://github.com/BuildChainProtocol/buildchain-escrow/actions/workflows/ci.yml/badge.svg)](https://github.com/BuildChainProtocol/buildchain-escrow/actions)
[![License](https://img.shields.io/badge/license-UNLICENSED-red)](LICENSE)
[![XRPL](https://img.shields.io/badge/XRPL-Testnet%20%7C%20Mainnet-0055FF)](https://xrpl.org)
[![Patent Pending](https://img.shields.io/badge/Patent-Pending%20BLDCHN--001--P-gold)](https://patents.google.com)

> **PATENT PENDING — Docket BLDCHN-001-P**  
> © BuildChain Protocol, Inc. — CONFIDENTIAL

---

## What Is BuildChain?

BuildChain is a production-grade TypeScript protocol that turns XRPL's native
escrow into a **dual-condition smart escrow** for construction lending.

A construction draw is released only when **both** conditions are verified
on-chain simultaneously:

1. **Inspector Credential** — XLS-0070 Verifiable Credential confirming a
   licensed inspector approved the milestone
2. **Lien Waiver NFT** — XLS-20 Non-Fungible Token representing the GC's
   signed lien waiver for this draw

Neither condition alone triggers payment. The Verification Orchestrator
(Module 4) checks both atomically via `Promise.all()` before authorizing
`EscrowFinish`. This is the novel security invariant — first implemented on
XRPL — that is the subject of the pending patent.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BuildChain Protocol                          │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │   Module 1   │   │   Module 2   │   │    Module 3      │   │
│  │Smart Escrow  │   │  Inspector   │   │  Lien Waiver     │   │
│  │   Engine     │   │  Credential  │   │   NFT Engine     │   │
│  │EscrowCreate/ │   │  (XLS-0070)  │   │   (XLS-20)       │   │
│  │Finish/Cancel │   │CredentialCreate│  │ NFTokenMint/Burn │   │
│  └──────┬───────┘   └──────┬───────┘   └───────┬──────────┘   │
│         │                  │                   │               │
│         └──────────────────┼───────────────────┘               │
│                            │                                   │
│                  ┌─────────▼──────────┐                        │
│                  │     Module 4       │                        │
│                  │   Verification     │                        │
│                  │   Orchestrator     │                        │
│                  │  Promise.all()     │                        │
│                  │ dual-condition     │                        │
│                  │    gate ⚡         │                        │
│                  └─────────┬──────────┘                        │
│                            │                                   │
│              ┌─────────────┼─────────────┐                    │
│              │             │             │                    │
│    ┌─────────▼──────┐  ┌───▼──────────┐  │                    │
│    │   Module 5     │  │  Module 6    │  │                    │
│    │  RLUSD         │  │  Audit Trail │  │                    │
│    │  Settlement    │  │  + Lender    │  │                    │
│    │  Engine        │  │  Dashboard   │  │                    │
│    │ DEX Swap /     │  │  JSON + Text │  │                    │
│    │ Direct Transfer│  │  Reports     │  │                    │
│    └────────────────┘  └──────────────┘  │                    │
│                                           │                    │
│  ┌────────────────────────────────────────▼──────────────┐    │
│  │               XRPL Ledger (Testnet / Mainnet)         │    │
│  │  EscrowCreate · EscrowFinish · EscrowCancel           │    │
│  │  CredentialCreate · CredentialAccept  (XLS-0070)      │    │
│  │  NFTokenMint · NFTokenBurn            (XLS-20)        │    │
│  │  Payment (RLUSD) · DEX PathFind       (RLUSD)         │    │
│  └───────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Modules

| Module | Name | Key Concept |
|--------|------|-------------|
| **1** | Smart Escrow Engine | `EscrowCreate/Finish/Cancel`, DRID registry, dual-condition gate |
| **2** | Inspector Credential System | XLS-0070 Verifiable Credentials, trusted issuers, `lsfAccepted` flag |
| **3** | Lien Waiver NFT Engine | XLS-20 `NFTokenMint`, `LIEN_WAIVER_TAXON`, DRID embedded in URI |
| **4** | Verification Orchestrator | `Promise.all()` dual-condition, batch processing, `watch()` poll loop |
| **5** | RLUSD Settlement Engine | DEX swap (`ripple_path_find`), direct transfer, trust line management |
| **6** | Audit Trail + Dashboard | 14 event types, chronological log, lender dashboard, JSON + text export |

---

## DRID — Draw Request Identifier

Every construction draw is identified by a **DRID** (Draw Request ID):

```
Format:   {projectId}:draw{drawNumber}
Example:  BLDCHN-PHOENIX-001:draw3
```

The DRID is embedded in the Inspector Credential URI (XLS-0070), the
Lien Waiver NFT URI (XLS-20), and every registry record and audit event.
It is the single thread linking all on-chain activity for a draw.

---

## Quick Start

### Prerequisites

- Node.js 20+
- XRPL testnet access (public, no signup required)

```bash
git clone https://github.com/BuildChainProtocol/buildchain-escrow
cd buildchain-escrow
npm install
cp .env.example .env
```

### Step 1 — Check Network Readiness

```bash
npm run check
# Verifies: Escrow, XLS-0070 Credentials, XLS-20 NFT, RLUSD
```

### Step 2 — Provision Testnet Wallets

```bash
npm run setup
# Funds 5 wallets from testnet faucet, configures RLUSD trust lines,
# issues test RLUSD, and writes all seeds/addresses to .env
```

### Step 3 — Run the Full Demo

```bash
npm run testnet       # 6-module lifecycle demo
npm run demo:full     # cinematic presentation demo (screen-record this)
```

### Step 4 — Run Tests

```bash
npm test              # 100+ unit tests, no live XRPL connection needed
npm run typecheck     # TypeScript type-check without compiling
```

---

## The Dual-Condition Pattern

The security invariant that makes BuildChain novel:

```typescript
// Module 4 — Verification Orchestrator (src/orchestrator/orchestrate.ts)

// Both conditions checked atomically — neither can be satisfied alone
const [credentialResult, nftResult] = await Promise.all([
  checkInspectorCredential(client, dridString, inspectorAddress),
  checkLienWaiverNft(client, dridString, gcAddress),
]);

const dualConditionMet =
  credentialResult.verified && nftResult.verified;

if (dualConditionMet) {
  // Only now is EscrowFinish authorized
  await engine.finishEscrow({ dridString, finisherAddress }, protocolWallet);
}
```

**Attack surface eliminated:** A fraudulent inspector credential alone cannot
release payment. A forged lien waiver NFT alone cannot release payment.
Both must exist on-chain simultaneously, issued by their respective
authorized parties.

---

## Environment Variables

Copy `.env.example` to `.env` and run `npm run setup`:

```bash
XRPL_NETWORK=testnet
LENDER_WALLET_SEED=          # set by setup-testnet.ts
GC_WALLET_SEED=              # set by setup-testnet.ts
PROTOCOL_WALLET_SEED=        # set by setup-testnet.ts
RLUSD_ISSUER_SEED=           # set by setup-testnet.ts
RLUSD_ISSUER_ADDRESS=        # set by setup-testnet.ts
INSPECTOR_ISSUER_SEED=       # set by setup-testnet.ts
PROTOCOL_FEE_BPS=30          # 0.30% protocol fee
```

---

## API Reference

### Module 1 — EscrowEngine

```typescript
import { EscrowEngine } from './src';

const engine = new EscrowEngine('./data/registry.json');
await engine.connect();

// Create escrow
const result = await engine.createEscrow({
  drid: { projectId: 'PROJ-001', drawNumber: 1, milestoneDescription: '...' },
  parties: { lenderAddress, gcAddress },
  amountXrp: 100,
}, lenderWallet);

// Mark verification conditions
engine.markInspectorCredentialVerified(dridString, credTxHash);
engine.markLienWaiverNftVerified(dridString, nftTxHash);

// Release (requires dual-condition to be met)
await engine.finishEscrow({ dridString, finisherAddress }, protocolWallet);

// Dashboard queries
engine.printSummary();
engine.getDualConditionMet();
engine.getByStatus('FUNDED');
```

### Module 2 — CredentialEngine (XLS-0070)

```typescript
import { CredentialEngine } from './src/credentials';

const creds = new CredentialEngine(client, [trustedIssuerAddress]);

await creds.issueCredentialForDraw(issuerWallet, subjectAddress, dridString);
await creds.acceptCredential(subjectWallet, issuerAddress, credentialType);
const result = await creds.verifyCredential(subjectAddress, issuerAddress, dridString);
// result.valid, result.reason, result.ledgerIndex
```

### Module 3 — LienWaiverNftEngine (XLS-20)

```typescript
import { LienWaiverNftEngine } from './src/nfts';

const nfts = new LienWaiverNftEngine(client);

const mint = await nfts.mintNftForDraw(gcWallet, dridString);
// mint.nfTokenId, mint.txHash

const verify = await nfts.verifyNft(gcWallet.address, dridString);
// verify.verified, verify.nfTokenId, verify.reason
```

### Module 5 — SettlementEngine (RLUSD)

```typescript
import { SettlementEngine } from './src/settlement';

const settlement = new SettlementEngine(client, rlusdIssuerAddress);

// Check / establish trust line
await settlement.establishTrustLine(gcWallet);

// Direct RLUSD transfer (Path B)
await settlement.transferRlusd({ dridString, senderAddress, receiverAddress,
  rlusdAmount, rlusdIssuer, protocolFeeRlusd, protocolWalletAddress }, senderWallet);

// DEX swap: XRP → RLUSD (Path A)
const quote = await settlement.getSwapQuote(xrpDrops, slippageTolerance);
await settlement.swapXrpToRlusd({ dridString, gcAddress, xrpAmountDrops,
  rlusdIssuer, slippageTolerance }, gcWallet);
```

### Module 6 — AuditEngine

```typescript
import { AuditEngine } from './src/audit';

const audit = new AuditEngine(registry, 'testnet');

const trail = audit.getTrail('PROJ-001:draw1');
audit.printTrail(trail);
const json = audit.exportTrailJson(trail);

const dashboard = audit.getDashboard('PROJ-001');
audit.printDashboard(dashboard);

// Export all draws + dashboard to directory
audit.exportProjectAudits('PROJ-001', './audits/');
```

---

## XRPL Amendment Dependencies

| Amendment | Modules | Status |
|-----------|---------|--------|
| `Escrow` | 1 | Always active on XRPL |
| `NonFungibleTokensV1_1` (XLS-20) | 3 | Active on testnet + mainnet |
| `Credentials` (XLS-0070) | 2 | Check with `npm run check` |
| Cross-currency Payment | 5 | Always active on XRPL |

Run `npm run check` to verify all amendments on your target network before demoing.

---

## Patent & IP

The **dual-condition escrow pattern** — requiring simultaneous on-chain
verification of both an XLS-0070 Verifiable Credential and an XLS-20 NFT
before authorizing EscrowFinish — is the subject of:

> **US Patent Application — Docket BLDCHN-001-P**  
> "Dual-Condition Blockchain Escrow for Construction Draw Management"  
> Inventor: BuildChain Protocol, Inc.  
> Status: Patent Pending

All code in this repository is the confidential and proprietary property of
BuildChain Protocol, Inc. Unauthorized use, reproduction, or distribution
is prohibited.

---

## License

UNLICENSED — Proprietary and Confidential  
© BuildChain Protocol, Inc. All rights reserved.

---

*BuildChain Protocol — Where Construction Finance Meets the Blockchain*
