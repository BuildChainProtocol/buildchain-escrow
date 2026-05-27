# BuildChain REST API — Integration Guide

Complete documentation for integrating the Express.js REST API with the 6-module BuildChain Protocol system.

## Overview

The REST API provides a clean HTTP interface to all BuildChain Protocol operations:

| Module | Functionality | API Endpoints |
|--------|---------------|---------------|
| **Module 1** | Smart Escrow | POST/GET `/v1/escrow/*` |
| **Module 2** | Inspector Credentials | POST `/v1/escrow/:drid/verify-credential` |
| **Module 3** | Lien Waiver NFTs | POST `/v1/escrow/:drid/verify-nft` |
| **Module 4** | Verification Orchestrator | Called internally for verification checks |
| **Module 5** | Settlement Engine | POST `/v1/settlement/*` |
| **Module 6** | Audit Trail & Dashboard | GET `/v1/project/:projectId/*` |

## File Structure

```
/api/
  ├── server.ts                 # Express app, middleware setup, error handler
  ├── types.ts                  # Shared TypeScript types (re-exports from src/)
  ├── utils.ts                  # Helper functions (DRID parsing, response formatting)
  ├── openapi.yaml              # OpenAPI 3.0 specification
  ├── README.md                 # API usage guide with curl examples
  │
  ├── middleware/
  │   ├── auth.ts               # X-API-Key authentication
  │   └── engine.ts             # EscrowEngine & AuditEngine singleton
  │
  └── routes/
      ├── escrow.ts             # Escrow lifecycle (create, finish, cancel, verify)
      ├── project.ts            # Project dashboard & audit trails
      ├── settlement.ts          # Settlement & DEX operations
      └── health.ts             # Health checks & registry summary
```

## Startup Flow

When the API starts (`npm run api`):

1. **Express server initializes** (`server.ts`)
   - Loads environment variables via `dotenv`
   - Sets up middleware (helmet, CORS, JSON)
   - Mounts routes

2. **Request arrives at `/v1/` endpoint**
   - `authMiddleware` validates X-API-Key header (optional in dev)
   - `engineMiddleware` initializes EscrowEngine & AuditEngine
     - Connects to XRPL network
     - Attaches to `req.app.locals` for use in routes
   - Route handler processes request
   - Response formatted consistently

3. **Graceful shutdown (SIGTERM/SIGINT)**
   - Server closes listener
   - XRPL client disconnects
   - Exit with code 0

## Key Design Patterns

### 1. Consistent Response Format

All endpoints return a consistent JSON structure:

**Success (HTTP 2xx):**
```typescript
{
  success: true,
  data: { /* endpoint-specific data */ },
  timestamp: "ISO-8601 datetime"
}
```

**Error (HTTP 4xx/5xx):**
```typescript
{
  success: false,
  error: "Human-readable message",
  code: "ERROR_CODE",
  details?: { /* development only */ },
  timestamp: "ISO-8601 datetime"
}
```

Helper functions in `utils.ts`:
- `sendSuccess<T>(res, data, statusCode?)` — Send success response
- `sendError(res, message, code, statusCode?, details?)` — Send error response

### 2. Async Error Handling

All route handlers are wrapped with `asyncHandler()` to catch and forward errors:

```typescript
router.post(
  '/:drid/finish',
  asyncHandler(async (req, res, next) => {
    // If any error is thrown, it's caught and forwarded to error middleware
    try {
      // ... operations
    } catch (error) {
      if (error.message.includes('not found')) {
        return sendError(res, 'Escrow not found', 'NOT_FOUND', 404);
      }
      next(error); // Forward to error middleware
    }
  })
);
```

### 3. DRID Parsing

Draw Request IDs are formatted as `projectId:drawN`. When used in URLs, they must be URL-encoded (`:` becomes `%3A`):

```typescript
// URL: /v1/escrow/PROJ-001%3Adraw1
const dridString = parseDridParam(req.params.drid);
// Result: "PROJ-001:draw1"
```

Helper functions in `utils.ts`:
- `parseDridParam(urlParam)` — Decode and validate DRID from URL
- `encodeDrid(dridString)` — Encode DRID for use in URLs

### 4. Wallet Management

The API loads wallets from environment variables (for testing):

```env
LENDER_WALLET_SEED=sEd7rBGm...      # Creates escrows
PROTOCOL_WALLET_SEED=sEd7rBGm...    # Finishes escrows
CANCELLER_WALLET_SEED=sEd7rBGm...   # Cancels escrows
```

Each route that requires a wallet:
1. Reads seed from env
2. Creates Wallet instance: `Wallet.fromSeed(seed)`
3. Passes to engine method

**Production note:** In production, integrate with HSM/vault instead of loading from env vars.

### 5. Engine Singleton Pattern

`engineMiddleware.ts` initializes engines once and caches them:

```typescript
// First request
await initializeEngines(); // Connects to XRPL, creates engines
req.app.locals.escrowEngine = escrowEngine;
req.app.locals.auditEngine = auditEngine;

// Subsequent requests
if (escrowEngine.connected) return; // Already connected
```

This ensures:
- Single XRPL connection per server instance
- Engines available across all routes
- Automatic reconnection if disconnected

## Module Integration

### Module 1: Escrow Engine

**Entry point:** `EscrowEngine` from `src/index.ts`

**API endpoints:**
- `POST /v1/escrow` → `engine.createEscrow(input, lenderWallet)`
- `GET /v1/escrow/:drid` → `engine.getStatus(dridString)`
- `POST /v1/escrow/:drid/finish` → `engine.finishEscrow(input, protocolWallet)`
- `POST /v1/escrow/:drid/cancel` → `engine.cancelEscrow(input, cancellerWallet)`

**Example:**
```typescript
const result = await engine.createEscrow(
  {
    drid: {
      projectId: 'PROJ-001',
      drawNumber: 1,
      milestoneDescription: 'Foundation Complete',
    },
    parties: {
      lenderAddress: 'rN7n7otQDd6FczFgLdhmKAmaEJWqZJxWUu',
      gcAddress: 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1',
    },
    amountXrp: 100,
  },
  lenderWallet
);
```

### Module 2 & 3: Inspector Credentials & NFTs

**Integration:** Module 4 (Verification Orchestrator) handles credential and NFT verification.

**API endpoints:**
- `POST /v1/escrow/:drid/verify-credential` → `engine.markInspectorCredentialVerified(dridString, txHash)`
- `POST /v1/escrow/:drid/verify-nft` → `engine.markLienWaiverNftVerified(dridString, nftTxHash)`

These endpoints update the escrow record's `verificationConditions`:
```typescript
{
  inspectorCredentialVerified: boolean,
  lienWaiverNftVerified: boolean,
  inspectorCredentialTxHash?: string,
  lienWaiverNftTxHash?: string,
  verifiedAt?: string,
}
```

When both conditions are `true`, the escrow status becomes `DUAL_CONDITION_MET` and can be finished.

### Module 4: Verification Orchestrator

**Integration:** Currently implicit through Module 1's verification marking.

In a production system, a separate microservice would:
1. Listen for credential issuance (Module 2)
2. Listen for NFT transfers (Module 3)
3. Call API endpoints to mark verification complete
4. Trigger automatic EscrowFinish when both are verified

Example flow:
```
[Inspector issues credential via Module 2]
  ↓
[Orchestrator detects issuance]
  ↓
[POST /v1/escrow/:drid/verify-credential with txHash]
  ↓
[Escrow updated: inspectorCredentialVerified = true]
  ↓
[Same for NFT via Module 3]
  ↓
[Both verified → status = DUAL_CONDITION_MET]
  ↓
[Orchestrator calls POST /v1/escrow/:drid/finish]
  ↓
[EscrowFinish executed on-chain]
```

### Module 5: Settlement Engine

**Entry point:** `SettlementEngine` from `src/settlement/index.ts`

**API endpoints:**
- `POST /v1/settlement/quote` → `settlement.getSwapQuote(gcAddress, xrpDrops, slippage)`
- `POST /v1/settlement/transfer` → `settlement.transferRlusd(senderWallet, input)`

**Example:**
```typescript
// Get DEX quote for XRP → RLUSD
const quote = await settlement.getSwapQuote(
  'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1',
  '100000000', // 100 XRP in drops
  0.01 // 1% slippage
);

// Or transfer RLUSD directly
const result = await settlement.transferRlusd(lenderWallet, {
  dridString: 'PROJ-001:draw1',
  rlusdAmount: '100.50',
  senderAddress: 'rN7n7otQDd6FczFgLdhmKAmaEJWqZJxWUu',
  receiverAddress: 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1',
});
```

### Module 6: Audit Trail & Dashboard

**Entry point:** `AuditEngine` from `src/audit/index.ts`

**API endpoints:**
- `GET /v1/project/:projectId/dashboard` → `audit.getDashboard(projectId)`
- `GET /v1/project/:projectId/audit` → `audit.getTrail(dridString)` for all DRIDs in project
- `GET /v1/project/:projectId/escrows` → `engine.getByProject(projectId)`

**Example:**
```typescript
// Get full project dashboard (lender-facing report)
const dashboard = audit.getDashboard('PROJ-001');
// Returns ProjectDashboard with:
// - projectId
// - totalDraws
// - totalAmount
// - draws[] with status, timeline, verification state

// Get single audit trail
const trail = audit.getTrail('PROJ-001:draw1');
// Returns AuditTrail with:
// - dridString
// - events[] (chronological log of all state changes)
// - explorer links for each transaction
```

## Development Workflow

### 1. Local Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start API server (with auto-reload)
npm run api:dev
```

### 2. Testing Endpoints

Use curl or Postman to test. Examples in `api/README.md`.

```bash
# Create escrow
curl -X POST http://localhost:3000/v1/escrow \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "PROJ-001",
    "drawNumber": 1,
    "milestoneDescription": "Foundation Complete",
    "lenderAddress": "...",
    "gcAddress": "...",
    "amountXrp": 100
  }'

# Get status
curl http://localhost:3000/v1/escrow/PROJ-001%3Adraw1

# Mark credential verified
curl -X POST http://localhost:3000/v1/escrow/PROJ-001%3Adraw1/verify-credential \
  -H "Content-Type: application/json" \
  -d '{"txHash": "..."}'
```

### 3. Debugging

**Enable verbose logging:**
```bash
DEBUG=* npm run api:dev
```

**Check XRPL connection:**
```bash
curl http://localhost:3000/health
```

**View request/response in browser:**
- Use browser DevTools Network tab
- Or use `curl -v` for verbose output

## Configuration Reference

### Environment Variables

```bash
# API Server
API_PORT=3000                          # Listen port
NODE_ENV=development|production        # Environment

# XRPL Network
XRPL_NETWORK=testnet|mainnet          # Network
XRPL_SERVER_URL=wss://...             # Network URL

# Wallets (loaded from seeds for testing)
LENDER_WALLET_SEED=...                # Lender wallet
PROTOCOL_WALLET_SEED=...              # Protocol wallet
CANCELLER_WALLET_SEED=...             # Canceller wallet

# Settlement
RLUSD_ISSUER_ADDRESS=...              # RLUSD issuer address

# Security
BUILDCHAIN_API_KEY=...                # API key (optional in dev)

# Storage
REGISTRY_PATH=./registry.json          # Escrow registry path
```

### Recommended .env for Development

```env
API_PORT=3000
NODE_ENV=development
XRPL_NETWORK=testnet
XRPL_SERVER_URL=wss://s.altnet.rippletest.net:51233

# Use the account from src/config/network.ts or your own testnet accounts
LENDER_WALLET_SEED=sEd7...
PROTOCOL_WALLET_SEED=sEd7...
CANCELLER_WALLET_SEED=sEd7...

RLUSD_ISSUER_ADDRESS=rLHzPsX6oXkzU9qL8RBoGV1N1b7rQJrFLr
BUILDCHAIN_API_KEY=dev-key-only

REGISTRY_PATH=./registry.json
```

## Error Codes & Responses

| Code | HTTP | Cause |
|------|------|-------|
| `INVALID_REQUEST` | 400 | Missing/invalid fields or malformed DRID |
| `UNAUTHORIZED` | 401 | Missing or incorrect X-API-Key header |
| `NOT_FOUND` | 404 | Escrow or project doesn't exist |
| `ESCROW_CREATE_FAILED` | 400 | Failed to create escrow on-chain |
| `ESCROW_FINISH_FAILED` | 400 | Escrow not in correct state or dual-condition not met |
| `ESCROW_CANCEL_FAILED` | 400 | Failed to cancel escrow |
| `CONFIG_ERROR` | 500 | Missing environment variable (wallet seed, API key) |
| `SERVICE_UNAVAILABLE` | 503 | XRPL connection lost or engine not initialized |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Production Deployment

### Docker

```bash
# Build image
docker build -t buildchain-api .

# Run container
docker run -d \
  --name buildchain-api \
  -p 3000:3000 \
  -e XRPL_NETWORK=mainnet \
  -e XRPL_SERVER_URL=wss://xrplcluster.com \
  -e LENDER_WALLET_SEED=$(cat /secure/lender.seed) \
  -e PROTOCOL_WALLET_SEED=$(cat /secure/protocol.seed) \
  -e BUILDCHAIN_API_KEY=$(cat /secure/api.key) \
  -v /data/registry.json:/app/registry.json \
  buildchain-api
```

### Kubernetes

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: buildchain-api-config
data:
  XRPL_NETWORK: mainnet
  XRPL_SERVER_URL: wss://xrplcluster.com
  API_PORT: "3000"
---
apiVersion: v1
kind: Secret
metadata:
  name: buildchain-api-secrets
type: Opaque
stringData:
  LENDER_WALLET_SEED: <base64-encoded-seed>
  PROTOCOL_WALLET_SEED: <base64-encoded-seed>
  BUILDCHAIN_API_KEY: <base64-encoded-key>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: buildchain-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: buildchain-api
  template:
    metadata:
      labels:
        app: buildchain-api
    spec:
      containers:
      - name: api
        image: buildchain-api:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: buildchain-api-config
        - secretRef:
            name: buildchain-api-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
```

### Secrets Management (Production)

Replace environment variable wallet seeds with:

**AWS Secrets Manager:**
```typescript
const secretsManager = new AWS.SecretsManager();
const secret = await secretsManager.getSecretValue({
  SecretId: 'buildchain/lender-wallet'
}).promise();
const lenderSeed = JSON.parse(secret.SecretString).seed;
```

**HashiCorp Vault:**
```typescript
const vault = new Vault({
  endpoint: process.env.VAULT_ADDR,
  token: process.env.VAULT_TOKEN,
});
const secret = await vault.read('secret/buildchain/lender-wallet');
const lenderSeed = secret.data.data.seed;
```

**Azure Key Vault:**
```typescript
const credential = new DefaultAzureCredential();
const vaultUrl = process.env.VAULT_URL;
const client = new SecretClient(vaultUrl, credential);
const lenderSeed = (await client.getSecret('buildchain-lender-wallet')).value;
```

## Monitoring & Logging

### Health Checks

The API provides health endpoints for monitoring:

```bash
# Basic health check (no auth required)
curl http://localhost:3000/health

# Response:
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

### Logging

All significant events are logged to console:

- Server startup: `🏗️  BuildChain Protocol — REST API Server`
- XRPL connection: `✅ Connected to XRPL testnet`
- Escrow creation: `✅ Escrow created: PROJ-001:draw1`
- Errors: `[ERROR] <message>`
- Shutdown: `[SHUTDOWN] <message>`

For production, pipe logs to a service like:
- **CloudWatch:** AWS log aggregation
- **ELK Stack:** Elasticsearch, Logstash, Kibana
- **DataDog:** Observability platform
- **Sentry:** Error tracking

```typescript
// Example: Add Sentry error tracking
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

app.use(Sentry.Handlers.errorHandler());
```

## Testing

### Unit Tests (Proposed)

```bash
npm test
```

Test files should cover:
- Route handlers (request validation, response format)
- Middleware (auth, engine initialization)
- Utils (DRID parsing, response formatting)

### Integration Tests (Proposed)

Test full flows:
1. Create escrow
2. Verify conditions
3. Finish/cancel
4. Query audit trail

Use testnet accounts and mock the XRPL client if needed.

### Load Testing

Use tools like `k6` or `Apache JMeter` to test under load:

```javascript
// k6 load test
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 10,          // 10 virtual users
  duration: '30s',  // Run for 30 seconds
};

export default function () {
  const res = http.get('http://localhost:3000/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
```

## Security Checklist

- [x] X-API-Key authentication on all `/v1/` routes
- [x] Helmet security headers (HSTS, CSP, etc.)
- [x] CORS configured (whitelist origins in production)
- [x] Input validation on all endpoints
- [x] Error messages don't leak sensitive info (stack traces in dev only)
- [ ] HTTPS required in production
- [ ] Rate limiting (implement with express-rate-limit)
- [ ] Request signing (HMAC-SHA256)
- [ ] Audit logging of all operations
- [ ] Wallet seeds in HSM/vault, not env vars
- [ ] Database encryption at rest

## Support & Resources

- **OpenAPI Spec:** `api/openapi.yaml` — Import into Postman or Swagger UI
- **API README:** `api/README.md` — Curl examples and quick reference
- **Main README:** `README.md` — Architecture and module overview
- **Contributing:** `CONTRIBUTING.md` — Development guidelines

For issues or questions, file an issue in the GitHub repository.

---

**PATENT PENDING — Docket BLDCHN-001-P**  
© BuildChain Protocol, Inc. — CONFIDENTIAL
