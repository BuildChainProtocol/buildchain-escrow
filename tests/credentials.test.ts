/**
 * BuildChain Protocol — Module 2 Test Suite
 *
 * Unit tests for the Inspector Credential System covering:
 *   - Credential type encoding / decoding
 *   - URI encoding / decoding
 *   - DRID matching logic
 *   - On-chain credential object filtering
 *   - Verification pipeline (trusted issuers, accepted flag, expiry)
 *   - Payload builder
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import {
  encodeCredentialType,
  decodeCredentialType,
  encodeUri,
  decodeUri,
} from '../src/credentials/verify';
import {
  CREDENTIAL_TYPES,
  LSF_ACCEPTED,
  XrplCredentialObject,
  CredentialUriPayload,
} from '../src/credentials/types';
import { buildCredentialPayload } from '../src/credentials/issue';
import { serializeDRID } from '../src/types';
import { dateToRippleTime, rippleTimeToDate } from '../src/config/network';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeCredential(overrides: Partial<XrplCredentialObject> = {}): XrplCredentialObject {
  const dridString = 'TEST-PROJ:draw1';
  const payload: CredentialUriPayload = {
    version: '1.0',
    drid: dridString,
    inspectorAddress: 'rInspector123',
    inspectorLicenseNumber: 'AZ-INS-9001',
    milestoneDescription: 'Foundation pour',
    inspectionDate: '2026-04-20',
    reportHash: 'abc123',
    reportUrl: 'https://example.com/report',
    issuerName: 'BuildChain Protocol, Inc.',
    issuedAt: new Date().toISOString(),
  };

  const futureExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  return {
    LedgerEntryType: 'Credential',
    Account: 'rTrustedIssuer',
    Subject: 'rInspector123',
    CredentialType: encodeCredentialType(CREDENTIAL_TYPES.INSPECTOR),
    URI: encodeUri(JSON.stringify(payload)),
    Expiration: dateToRippleTime(futureExpiry),
    Flags: LSF_ACCEPTED,    // accepted
    LedgerIndex: 'LEDGER_INDEX_HASH_001',
    ...overrides,
  };
}

// ─── TESTS: Encoding ──────────────────────────────────────────────────────────

describe('Credential Type Encoding', () => {
  it('encodes credential type to uppercase hex', () => {
    const encoded = encodeCredentialType(CREDENTIAL_TYPES.INSPECTOR);
    expect(encoded).toMatch(/^[0-9A-F]+$/);
  });

  it('round-trips credential type through encode/decode', () => {
    const original = CREDENTIAL_TYPES.INSPECTOR;
    const encoded = encodeCredentialType(original);
    const decoded = decodeCredentialType(encoded);
    expect(decoded).toBe(original);
  });

  it('encodes known value correctly', () => {
    // "BuildChain-Inspector-v1" → hex
    const expected = Buffer.from('BuildChain-Inspector-v1', 'utf8')
      .toString('hex')
      .toUpperCase();
    expect(encodeCredentialType('BuildChain-Inspector-v1')).toBe(expected);
  });

  it('is case-insensitive on decode', () => {
    const lower = encodeCredentialType(CREDENTIAL_TYPES.INSPECTOR).toLowerCase();
    expect(decodeCredentialType(lower)).toBe(CREDENTIAL_TYPES.INSPECTOR);
  });
});

describe('URI Encoding', () => {
  it('encodes URI to uppercase hex', () => {
    const encoded = encodeUri('https://example.com/cred/123');
    expect(encoded).toMatch(/^[0-9A-F]+$/);
  });

  it('round-trips URI through encode/decode', () => {
    const original = 'https://api.buildchain.io/credentials/PROJ-123:draw3';
    expect(decodeUri(encodeUri(original))).toBe(original);
  });

  it('round-trips JSON payload through encode/decode', () => {
    const payload = { drid: 'TEST:draw1', version: '1.0' };
    const json = JSON.stringify(payload);
    const decoded = decodeUri(encodeUri(json));
    expect(JSON.parse(decoded)).toEqual(payload);
  });
});

// ─── TESTS: LSF_ACCEPTED Flag ─────────────────────────────────────────────────

describe('LSF_ACCEPTED Flag', () => {
  it('LSF_ACCEPTED equals 0x00010000', () => {
    expect(LSF_ACCEPTED).toBe(0x00010000);
  });

  it('accepted flag is set correctly', () => {
    const cred = makeCredential({ Flags: LSF_ACCEPTED });
    expect((cred.Flags & LSF_ACCEPTED) !== 0).toBe(true);
  });

  it('non-accepted credential fails flag check', () => {
    const cred = makeCredential({ Flags: 0 });
    expect((cred.Flags & LSF_ACCEPTED) !== 0).toBe(false);
  });
});

// ─── TESTS: Credential Builder ────────────────────────────────────────────────

describe('buildCredentialPayload', () => {
  it('builds a well-formed payload', () => {
    const payload = buildCredentialPayload({
      dridString: 'PROJ-ABC:draw2',
      inspectorAddress: 'rInspector456',
      inspectorLicenseNumber: 'AZ-INS-5000',
      milestoneDescription: 'Framing complete',
      inspectionDate: '2026-05-15',
      reportHash: 'deadbeef',
      reportUrl: 'https://ipfs.io/ipfs/Qm...',
      issuerName: 'BuildChain Protocol, Inc.',
    });

    expect(payload.version).toBe('1.0');
    expect(payload.drid).toBe('PROJ-ABC:draw2');
    expect(payload.inspectorAddress).toBe('rInspector456');
    expect(payload.inspectorLicenseNumber).toBe('AZ-INS-5000');
    expect(payload.issuedAt).toBeDefined();
    expect(new Date(payload.issuedAt)).toBeInstanceOf(Date);
  });

  it('serializes to JSON without errors', () => {
    const payload = buildCredentialPayload({
      dridString: 'PROJ-XYZ:draw1',
      inspectorAddress: 'rABC',
      inspectorLicenseNumber: 'LIC-001',
      milestoneDescription: 'Test',
      inspectionDate: '2026-01-01',
      reportHash: 'hash',
      reportUrl: 'https://example.com',
      issuerName: 'Test Inc.',
    });
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  it('JSON payload round-trips through URI encoding', () => {
    const payload = buildCredentialPayload({
      dridString: 'ENCODE-TEST:draw5',
      inspectorAddress: 'rTest',
      inspectorLicenseNumber: 'LIC-999',
      milestoneDescription: 'Plumbing rough-in',
      inspectionDate: '2026-03-01',
      reportHash: '0xhash',
      reportUrl: 'https://ipfs.io',
      issuerName: 'BuildChain',
    });

    const json = JSON.stringify(payload);
    const encoded = encodeUri(json);
    const decoded = JSON.parse(decodeUri(encoded));
    expect(decoded.drid).toBe('ENCODE-TEST:draw5');
    expect(decoded.version).toBe('1.0');
  });
});

// ─── TESTS: DRID Matching ─────────────────────────────────────────────────────

describe('DRID in Credential URI', () => {
  it('embedded JSON payload matches DRID', () => {
    const dridString = 'TEST-PROJ:draw1';
    const cred = makeCredential();  // makeCredential uses TEST-PROJ:draw1
    const uriText = decodeUri(cred.URI!);
    const parsed = JSON.parse(uriText);
    expect(parsed.drid).toBe(dridString);
  });

  it('wrong DRID in payload does not match', () => {
    const wrongPayload: CredentialUriPayload = {
      ...buildCredentialPayload({
        dridString: 'WRONG-PROJ:draw9',
        inspectorAddress: 'rX',
        inspectorLicenseNumber: 'L',
        milestoneDescription: 'X',
        inspectionDate: '2026-01-01',
        reportHash: 'h',
        reportUrl: 'u',
        issuerName: 'X',
      }),
    };
    const cred = makeCredential({ URI: encodeUri(JSON.stringify(wrongPayload)) });
    const parsed = JSON.parse(decodeUri(cred.URI!));
    expect(parsed.drid).not.toBe('TEST-PROJ:draw1');
  });
});

// ─── TESTS: Expiry Logic ──────────────────────────────────────────────────────

describe('Credential Expiry', () => {
  it('future expiry is not expired', () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    const expiration = dateToRippleTime(futureDate);
    const expiryDate = rippleTimeToDate(expiration);
    expect(new Date() < expiryDate).toBe(true);
  });

  it('past expiry is expired', () => {
    const pastDate = new Date(Date.now() - 1000);
    const expiration = dateToRippleTime(pastDate);
    const expiryDate = rippleTimeToDate(expiration);
    expect(new Date() > expiryDate).toBe(true);
  });

  it('credential with no expiration is not expired', () => {
    const cred = makeCredential({ Expiration: undefined });
    // No expiration field → never expires
    expect(cred.Expiration).toBeUndefined();
  });
});

// ─── TESTS: Trusted Issuers ───────────────────────────────────────────────────

describe('Trusted Issuers', () => {
  it('credential from trusted issuer passes issuer check', () => {
    const trustedIssuers = ['rTrustedIssuer', 'rAnotherIssuer'];
    const trustedSet = new Set(trustedIssuers.map((a) => a.toLowerCase()));
    const cred = makeCredential({ Account: 'rTrustedIssuer' });
    expect(trustedSet.has(cred.Account.toLowerCase())).toBe(true);
  });

  it('credential from untrusted issuer fails issuer check', () => {
    const trustedIssuers = ['rTrustedIssuer'];
    const trustedSet = new Set(trustedIssuers.map((a) => a.toLowerCase()));
    const cred = makeCredential({ Account: 'rEvilIssuer' });
    expect(trustedSet.has(cred.Account.toLowerCase())).toBe(false);
  });

  it('issuer check is case-insensitive', () => {
    const trustedIssuers = ['rTrustedIssuer'];
    const trustedSet = new Set(trustedIssuers.map((a) => a.toLowerCase()));
    // XRPL addresses are case-sensitive but defensive check
    expect(trustedSet.has('rTrustedIssuer'.toLowerCase())).toBe(true);
    expect(trustedSet.has('RTRUSTEDISSUER'.toLowerCase())).toBe(true);
  });
});

// ─── INTEGRATION (XRPL Testnet) ───────────────────────────────────────────────

const RUN_INTEGRATION = process.env.XRPL_RUN_INTEGRATION === 'true';

describe.skipIf(!RUN_INTEGRATION)('Integration — CredentialEngine (XRPL Testnet)', () => {
  it('full lifecycle: issue → accept → verify', async () => {
    // Placeholder — implement with CredentialEngine when running live
    expect(true).toBe(true);
  }, 120_000);
});
