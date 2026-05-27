# BuildChain Protocol REST API

RESTful API wrapper for the 6-module BuildChain Protocol TypeScript system.

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- XRPL testnet account with XRP

### Installation

```bash
npm install
npm run build
```

### Running Locally

**Development mode (with auto-reload):**
```bash
npm run api:dev
```

**Production mode:**
```bash
npm run api
```

The API will start on `http://localhost:3000` (or port specified by `API_PORT` env var).

## Environment Variables

Create a `.env` file in the project root:

```env
# API Configuration
API_PORT=3000
NODE_ENV=development

# XRPL Network
XRPL_NETWORK=testnet
XRPL_SERVER_URL=wss://s.altnet.rippletest.net:51233

# Wallet Seeds (hex format, loaded from environment for testing)
# NOTE: In production, use HSM/vault for wallet management
LENDER_WALLET_SEED=sEd7rBGm5kxzauRTAV2hbsAVFu
PROTOCOL_WALLET_SEED=sEd7rBGm5kxzauRTAV2hbsAVFu
CANCELLER_WALLET_SEED=sEd7rBGm5kxzauRTAV2hbsAVFu

# Settlement (RLUSD)
RLUSD_ISSUER_ADDRESS=rLHzPsX6oXkzU9qL8RBoGV1N1b7rQJrFLr

# API Authentication (optional in dev mode)
BUILDCHAIN_API_KEY=your-api-key-here

# Registry
REGISTRY_PATH=./registry.json
```

## Authentication

All `/v1/` endpoints require the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key-here" http://localhost:3000/v1/escrow
```

If `BUILDCHAIN_API_KEY` is not set in development mode, authentication is skipped.

## API Endpoints

### Health & Status

**Check API health:**
```bash
curl http://localhost:3000/health
```

**Get registry summary:**
```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:3000/v1/registry/summary
```

### Escrow Operations

**Create escrow:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "PROJ-001",
    "drawNumber": 1,
    "milestoneDescription": "Foundation Complete",
    "lenderAddress": "rN7n7otQDd6FczFgLdhmKAmaEJWqZJxWUu",
    "gcAddress": "rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1",
    "amountXrp": 100,
    "finishAfterHours": 1,
    "cancelAfterDays": 90
  }' \
  http://localhost:3000/v1/escrow
```

**Get escrow status:**
```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:3000/v1/escrow/PROJ-001%3Adraw1
```

Note: The DRID must be URL-encoded (`:` becomes `%3A`).

**Finish (release) escrow:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "finisherAddress": "rN7n7otQDd6FczFgLdhmKAmaEJWqZJxWUu"
  }' \
  http://localhost:3000/v1/escrow/PROJ-001%3Adraw1/finish
```

**Cancel escrow:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "VERIFICATION_FAILED"
  }' \
  http://localhost:3000/v1/escrow/PROJ-001%3Adraw1/cancel
```

Valid reasons: `EXPIRED`, `VERIFICATION_FAILED`, `LENDER_REQUESTED`

**Mark inspector credential verified:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "txHash": "1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF"
  }' \
  http://localhost:3000/v1/escrow/PROJ-001%3Adraw1/verify-credential
```

**Mark lien waiver NFT verified:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "txHash": "1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF"
  }' \
  http://localhost:3000/v1/escrow/PROJ-001%3Adraw1/verify-nft
```

### Project Dashboard & Audit

**Get project dashboard:**
```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:3000/v1/project/PROJ-001/dashboard
```

**Get all audit trails for a project:**
```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:3000/v1/project/PROJ-001/audit
```

**List all escrows in a project:**
```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:3000/v1/project/PROJ-001/escrows
```

### Settlement Operations

**Get DEX quote (XRP to RLUSD):**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "gcAddress": "rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1",
    "xrpDrops": "100000000",
    "slippage": 0.01
  }' \
  http://localhost:3000/v1/settlement/quote
```

**Transfer RLUSD directly:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "dridString": "PROJ-001:draw1",
    "rlusdAmount": "100.50",
    "senderAddress": "rN7n7otQDd6FczFgLdhmKAmaEJWqZJxWUu",
    "receiverAddress": "rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1"
  }' \
  http://localhost:3000/v1/settlement/transfer
```

## Response Format

All responses follow a consistent JSON structure:

**Success (HTTP 2xx):**
```json
{
  "success": true,
  "data": {
    "dridString": "PROJ-001:draw1",
    "status": "FUNDED",
    "record": {...}
  },
  "timestamp": "2026-04-21T12:34:56.789Z"
}
```

**Error (HTTP 4xx/5xx):**
```json
{
  "success": false,
  "error": "Missing required fields: lenderAddress, gcAddress",
  "code": "INVALID_REQUEST",
  "details": null,
  "timestamp": "2026-04-21T12:34:56.789Z"
}
```

## DRID Format

Draw Request IDs (DRIDs) uniquely identify escrows. They are formatted as:

```
projectId:drawN
```

Example: `PROJ-001:draw1`

When used in URLs, the colon must be URL-encoded as `%3A`:

```
/v1/escrow/PROJ-001%3Adraw1
```

## OpenAPI Documentation

The API follows OpenAPI 3.0 specification. Access the spec at:

```
GET http://localhost:3000/api/openapi.json
```

Or view the YAML spec in `api/openapi.yaml`.

## Wallet Management

The API currently loads wallets from environment variables for testing:

- `LENDER_WALLET_SEED` — Funds and creates escrows
- `PROTOCOL_WALLET_SEED` — Finishes (releases) escrows
- `CANCELLER_WALLET_SEED` — Cancels escrows

**Production deployment** should use a Hardware Security Module (HSM) or secrets vault (e.g., AWS Secrets Manager, HashiCorp Vault) instead of storing seeds in environment variables.

## Docker Deployment

Build and run in Docker:

```bash
docker build -t buildchain-api .
docker run -p 3000:3000 \
  -e XRPL_NETWORK=testnet \
  -e LENDER_WALLET_SEED=... \
  -e PROTOCOL_WALLET_SEED=... \
  -e BUILDCHAIN_API_KEY=... \
  buildchain-api
```

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `INVALID_REQUEST` | 400 | Missing or invalid request fields |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `NOT_FOUND` | 404 | Escrow or resource not found |
| `ESCROW_CREATE_FAILED` | 400 | Failed to create escrow |
| `ESCROW_FINISH_FAILED` | 400 | Failed to finish escrow |
| `ESCROW_CANCEL_FAILED` | 400 | Failed to cancel escrow |
| `CONFIG_ERROR` | 500 | Missing configuration (e.g., wallet) |
| `SERVICE_UNAVAILABLE` | 503 | XRPL connection or service unavailable |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Development

### Build TypeScript
```bash
npm run build
```

### Type checking
```bash
npm run typecheck
```

### Linting
```bash
npm run lint
```

## Testing

Manual testing with curl (examples above) or use a tool like Postman:

1. Create `.env` with test wallets
2. Start server: `npm run api:dev`
3. Use curl examples or import OpenAPI spec into Postman

## Security Notes

- API keys are optional in development but **required in production**
- Never commit `.env` files with real wallet seeds
- Use HTTPS in production
- Implement rate limiting on endpoints
- Audit all escrow operations
- Store wallet seeds in HSM/vault, never in code or env vars

## Architecture

The API is organized into layers:

- **`server.ts`** — Express app setup, middleware, error handling
- **`middleware/`** — Auth, engine initialization
- **`routes/`** — Endpoint handlers (escrow, project, settlement, health)
- **`types.ts`** — Shared type definitions
- **`utils.ts`** — Helper functions

The API wraps the 6-module BuildChain system:

1. **Module 1** — Escrow Engine (create, finish, cancel)
2. **Module 2** — Inspector Credentials (XLS-0070)
3. **Module 3** — Lien Waiver NFTs (XLS-20)
4. **Module 4** — Verification Orchestrator
5. **Module 5** — Settlement Engine (RLUSD swaps)
6. **Module 6** — Audit Trails & Dashboard

Each module is accessed through the corresponding route or middleware.

## License

UNLICENSED — Confidential BuildChain Protocol, Inc.
