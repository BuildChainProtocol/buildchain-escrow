# Contributing to BuildChain Protocol

> PATENT PENDING — Docket BLDCHN-001-P  
> © BuildChain Protocol, Inc. — CONFIDENTIAL  
> This repository is private. External contributions require a signed CLA.

---

## Development Setup

```bash
git clone <repo>
cd buildchain-escrow
npm install
cp .env.example .env
npx ts-node scripts/setup-testnet.ts   # provision testnet wallets
npx ts-node scripts/check-amendments.ts  # verify XRPL network
```

## Project Structure

```
buildchain-escrow/
├── src/
│   ├── types/          Module 1 shared types (DRID, EscrowRecord, etc.)
│   ├── config/         Network config, XRPL client management
│   ├── registry/       JSON-persisted EscrowRegistry
│   ├── escrow/         EscrowCreate / EscrowFinish / EscrowCancel
│   ├── credentials/    Module 2 — XLS-0070 Inspector Credentials
│   ├── nfts/           Module 3 — XLS-20 Lien Waiver NFTs
│   ├── orchestrator/   Module 4 — Dual-condition Verification Orchestrator
│   ├── settlement/     Module 5 — RLUSD Settlement Engine
│   ├── audit/          Module 6 — Audit Trail + Lender Dashboard
│   └── index.ts        EscrowEngine public API (Module 1)
├── scripts/
│   ├── check-amendments.ts   Verify XRPL amendment readiness
│   ├── setup-testnet.ts      Provision testnet wallets + RLUSD
│   ├── testnet-demo.ts       Full 6-module testnet demo
│   ├── demo-full.ts          Cinematic presentation demo
│   └── demo.ts               Module 1 standalone demo
└── tests/                    Jest unit tests (100+ tests across all modules)
```

## Scripts Reference

| Command | Description |
|---|---|
| `npm run check` | Verify XRPL amendments + network readiness |
| `npm run setup` | Provision testnet wallets from faucet |
| `npm run testnet` | Run full 6-module demo on XRPL testnet |
| `npm run demo:full` | Cinematic presentation demo |
| `npm test` | Run all unit tests |
| `npm run typecheck` | TypeScript type check without compiling |
| `npm run build` | Compile TypeScript to dist/ |

## Code Standards

- **TypeScript strict mode** — all new code must typecheck with `--noEmit`
- **No `any` types** unless wrapping XRPL library responses (document the reason)
- **Every public function has a JSDoc comment**
- **Tests required** — every new module needs corresponding tests in `tests/`
- **Registry writes** — always use `registry.save()` — never mutate records directly

## Testing

Tests run against a temporary in-memory registry. No XRPL connection is required.

```bash
npm test                    # run all tests
npm run test:watch          # watch mode
npx jest tests/escrow       # single module
npx jest --coverage         # with coverage report
```

## XRPL Amendment Dependencies

| Module | Amendment | Status |
|---|---|---|
| Module 1 | Escrow | Always active |
| Module 2 | Credentials (XLS-0070) | Verify with `npm run check` |
| Module 3 | NonFungibleTokensV1_1 | Active on testnet |
| Module 5 | Cross-currency Payment | Always active |

If an amendment is not yet active on the target network, the relevant module
runs in simulation mode (placeholder TX hashes). See `scripts/check-amendments.ts`.

## Security Notes

- **Never commit `.env`** — it contains live wallet seeds
- **Testnet only** — never run `setup-testnet.ts` against mainnet
- **Protocol wallet** — the EscrowFinish submitter wallet must be kept secure in production
- **RLUSD issuer** — the testnet issuer is a test IOU. Mainnet uses Ripple's official RLUSD issuer.

## Intellectual Property

All code in this repository is the confidential and proprietary property of
BuildChain Protocol, Inc. The dual-condition escrow pattern is Patent Pending
(Docket BLDCHN-001-P). Contributors must sign a Contributor License Agreement
and an IP Assignment Agreement before submitting any pull requests.
