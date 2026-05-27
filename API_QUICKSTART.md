# BuildChain API — Quick Start

Get the REST API running in 5 minutes.

## 1. Install Dependencies

```bash
npm install
```

This installs:
- `express` & `helmet` — HTTP server & security
- `cors` — Cross-origin support
- `xrpl` — XRPL client (already installed)
- `dotenv` — Environment variables

## 2. Configure Environment

Create `.env` in project root:

```env
# Required
XRPL_NETWORK=testnet
XRPL_SERVER_URL=wss://s.altnet.rippletest.net:51233

# Wallet seeds (for testing — use HSM/vault in production)
LENDER_WALLET_SEED=sEd7...
PROTOCOL_WALLET_SEED=sEd7...
CANCELLER_WALLET_SEED=sEd7...

# Settlement
RLUSD_ISSUER_ADDRESS=rLHzPsX6oXkzU9qL8RBoGV1N1b7rQJrFLr

# Optional
API_PORT=3000
NODE_ENV=development
BUILDCHAIN_API_KEY=dev-key
REGISTRY_PATH=./registry.json
```

**Need testnet accounts?** Run:
```bash
npm run setup
```

This generates test wallets and funds them from the faucet.

## 3. Build TypeScript

```bash
npm run build
```

Compiles `src/` and `api/` to `dist/`.

## 4. Start the API

**Development (with auto-reload):**
```bash
npm run api:dev
```

**Production:**
```bash
npm run api
```

You should see:
```
======================================================================
🏗️  BuildChain Protocol — REST API Server
======================================================================
Server running on port 3000 (development)
API Version: 1.0.0

Endpoints:
  Health:
    GET  /health
    GET  /v1/registry/summary

  Escrow:
    POST   /v1/escrow
    GET    /v1/escrow/:drid
    ...
======================================================================
```

## 5. Test the API

### Health Check (no auth required)

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "network": "testnet",
    "connected": true,
    "timestamp": "2026-04-21T12:34:56.789Z"
  }
}
```

### Create Escrow

```bash
curl -X POST http://localhost:3000/v1/escrow \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "PROJ-TEST-001",
    "drawNumber": 1,
    "milestoneDescription": "Foundation Complete",
    "lenderAddress": "rN7n7otQDd6FczFgLdhmKAmaEJWqZJxWUu",
    "gcAddress": "rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1",
    "amountXrp": 10
  }'
```

Replace wallet addresses with ones from your environment.

Response:
```json
{
  "success": true,
  "data": {
    "success": true,
    "dridString": "PROJ-TEST-001:draw1",
    "record": {
      "drid": "PROJ-TEST-001:draw1",
      "status": "FUNDED",
      "amountXrp": "10.000000",
      ...
    },
    "txHash": "1234567890ABCDEF..."
  },
  "timestamp": "2026-04-21T12:34:56.789Z"
}
```

### Get Escrow Status

```bash
curl http://localhost:3000/v1/escrow/PROJ-TEST-001%3Adraw1
```

**Note:** The colon (`:`) is URL-encoded as `%3A`.

### Verify Conditions

Mark inspector credential verified:
```bash
curl -X POST http://localhost:3000/v1/escrow/PROJ-TEST-001%3Adraw1/verify-credential \
  -H "Content-Type: application/json" \
  -d '{"txHash": "abc123..."}'
```

Mark NFT verified:
```bash
curl -X POST http://localhost:3000/v1/escrow/PROJ-TEST-001%3Adraw1/verify-nft \
  -H "Content-Type: application/json" \
  -d '{"txHash": "def456..."}'
```

### Finish Escrow

Once both conditions are verified:
```bash
curl -X POST http://localhost:3000/v1/escrow/PROJ-TEST-001%3Adraw1/finish \
  -H "Content-Type: application/json" \
  -d '{"finisherAddress": "rN7n7otQDd6FczFgLdhmKAmaEJWqZJxWUu"}'
```

## 6. View OpenAPI Spec

Open `api/openapi.yaml` in your editor, or import into Postman/Swagger UI.

API endpoint: `http://localhost:3000/api/openapi.json`

## 7. Check Logs

All operations are logged to console:

```
✅ Connected to XRPL testnet (wss://s.altnet.rippletest.net:51233)
✅ Escrow created: PROJ-TEST-001:draw1
✅ Inspector credential verified for DRID: PROJ-TEST-001:draw1
✅ Lien waiver NFT verified for DRID: PROJ-TEST-001:draw1
```

## Common Tasks

### Enable API Key Authentication

Set in `.env`:
```env
BUILDCHAIN_API_KEY=my-secret-key-123
```

Now all `/v1/` requests require:
```bash
curl -H "X-API-Key: my-secret-key-123" http://localhost:3000/v1/escrow
```

### Run in Docker

```bash
docker build -t buildchain-api .
docker run -p 3000:3000 \
  -e XRPL_NETWORK=testnet \
  -e LENDER_WALLET_SEED=... \
  -e PROTOCOL_WALLET_SEED=... \
  buildchain-api
```

### View Project Dashboard

```bash
curl http://localhost:3000/v1/project/PROJ-TEST-001/dashboard
```

Returns:
```json
{
  "success": true,
  "data": {
    "projectId": "PROJ-TEST-001",
    "totalDraws": 1,
    "totalAmount": "10.000000",
    "draws": [
      {
        "drid": "PROJ-TEST-001:draw1",
        "drawNumber": 1,
        "status": "RELEASED",
        ...
      }
    ]
  }
}
```

### Get Audit Trail

```bash
curl http://localhost:3000/v1/project/PROJ-TEST-001/audit
```

Returns chronological log of all events with transaction hashes and timestamps.

## Troubleshooting

### Port Already in Use

```bash
# Use different port
API_PORT=3001 npm run api:dev
```

### Connection Refused

```
Error: connect ECONNREFUSED — unable to connect to XRPL
```

Check:
1. Internet connection is active
2. `XRPL_SERVER_URL` is correct
3. Testnet server is online: `wss://s.altnet.rippletest.net:51233`

### Wallet Not Configured

```
Error: Wallet not configured
```

Add wallet seeds to `.env`:
```env
LENDER_WALLET_SEED=sEd7...
PROTOCOL_WALLET_SEED=sEd7...
```

Or run:
```bash
npm run setup
```

### Insufficient Funds

```json
{
  "success": false,
  "error": "Account does not have enough funds to pay transaction fee",
  "code": "ESCROW_CREATE_FAILED"
}
```

Fund the lender account from the faucet:
```bash
npm run setup
```

### Registry Not Found

```json
{
  "success": false,
  "error": "Escrow not found",
  "code": "NOT_FOUND"
}
```

Make sure the DRID format is correct: `projectId:drawN` with colon URL-encoded as `%3A`.

## Next Steps

1. **Read the full docs:** `api/README.md`
2. **Explore the OpenAPI spec:** `api/openapi.yaml`
3. **Review integration guide:** `API_INTEGRATION.md`
4. **Deploy to production:** See Docker/Kubernetes examples in `API_INTEGRATION.md`

## API Routes Quick Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/v1/registry/summary` | Yes | Registry stats |
| **POST** | **`/v1/escrow`** | Yes | **Create escrow** |
| **GET** | **`/v1/escrow/:drid`** | Yes | **Get status** |
| **POST** | **`/v1/escrow/:drid/finish`** | Yes | **Release funds** |
| **POST** | **`/v1/escrow/:drid/cancel`** | Yes | **Cancel escrow** |
| POST | `/v1/escrow/:drid/verify-credential` | Yes | Mark credential verified |
| POST | `/v1/escrow/:drid/verify-nft` | Yes | Mark NFT verified |
| GET | `/v1/project/:projectId/dashboard` | Yes | Project dashboard |
| GET | `/v1/project/:projectId/audit` | Yes | Audit trails |
| GET | `/v1/project/:projectId/escrows` | Yes | List escrows |
| POST | `/v1/settlement/quote` | Yes | DEX quote |
| POST | `/v1/settlement/transfer` | Yes | Transfer RLUSD |

## Support

- File issues on GitHub
- Check OpenAPI spec for schema details
- Review example curl commands in `api/README.md`

---

**PATENT PENDING — Docket BLDCHN-001-P**  
© BuildChain Protocol, Inc. — CONFIDENTIAL
