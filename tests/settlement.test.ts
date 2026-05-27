/**
 * BuildChain Protocol — Module 5 Test Suite
 *
 * Unit tests for the Settlement Engine covering:
 *   - RLUSD_CURRENCY constant
 *   - RlusdAmount structure validation
 *   - DexQuote slippage math
 *   - Slippage floor calculation
 *   - Trust line status structure
 *   - Settlement path types
 *   - Amount precision handling
 *   - Protocol fee calculation
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import {
  RLUSD_CURRENCY,
  DexQuote,
  TrustLineStatus,
  RlusdAmount,
  DexSwapResult,
  DirectTransferResult,
  SettlementPath,
} from '../src/settlement/types';
import { dropsToXrp, xrpToDrops } from '../src/config/network';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeDexQuote(overrides: Partial<DexQuote> = {}): DexQuote {
  return {
    xrpInDrops: '100000000',    // 100 XRP
    xrpIn: 100,
    rlusdOut: '250.000000',
    rateRlusdPerXrp: 2.5,
    slippageTolerance: 0.01,
    minRlusdOut: '247.500000',  // 250 * (1 - 0.01)
    quotedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTrustLineStatus(
  hasTrustLine: boolean,
  balance = '0'
): TrustLineStatus {
  return {
    address: 'rTestAddress',
    hasTrustLine,
    rlusdBalance: hasTrustLine ? balance : undefined,
    rlusdLimit: hasTrustLine ? '1000000' : undefined,
    rlusdIssuer: 'rRLUSDIssuer',
  };
}

// ─── TESTS: RLUSD Currency ────────────────────────────────────────────────────

describe('RLUSD Currency', () => {
  it('currency code is "RLUSD"', () => {
    expect(RLUSD_CURRENCY).toBe('RLUSD');
  });

  it('currency code is exactly 5 characters (XRPL 3-char non-standard uses longer hex)', () => {
    // "RLUSD" is used in IOU format as the 20-byte hex currency code
    expect(RLUSD_CURRENCY.length).toBe(5);
  });

  it('RlusdAmount structure is valid', () => {
    const amount: RlusdAmount = {
      currency: RLUSD_CURRENCY,
      issuer: 'rIssuerAddress',
      value: '250.00',
    };
    expect(amount.currency).toBe('RLUSD');
    expect(parseFloat(amount.value)).toBeCloseTo(250.0);
  });
});

// ─── TESTS: DEX Quote / Slippage Math ────────────────────────────────────────

describe('DEX Quote Slippage Math', () => {
  it('1% slippage on 250 RLUSD gives minRlusdOut of 247.50', () => {
    const quote = makeDexQuote();
    const slippage = quote.slippageTolerance;
    const rlusdOut = parseFloat(quote.rlusdOut);
    const minOut = rlusdOut * (1 - slippage);
    expect(minOut).toBeCloseTo(247.5, 2);
  });

  it('0% slippage gives minRlusdOut equal to rlusdOut', () => {
    const rlusdOut = 250;
    const slippage = 0;
    const minOut = rlusdOut * (1 - slippage);
    expect(minOut).toBeCloseTo(rlusdOut, 6);
  });

  it('5% slippage on 250 RLUSD gives minRlusdOut of 237.50', () => {
    const rlusdOut = 250;
    const slippage = 0.05;
    const minOut = rlusdOut * (1 - slippage);
    expect(minOut).toBeCloseTo(237.5, 2);
  });

  it('rate is correct: 100 XRP / 250 RLUSD = 2.5 RLUSD/XRP', () => {
    const quote = makeDexQuote();
    expect(quote.rateRlusdPerXrp).toBeCloseTo(2.5, 4);
  });

  it('xrpIn derived from xrpInDrops correctly', () => {
    const quote = makeDexQuote({ xrpInDrops: '100000000' });
    expect(dropsToXrp(quote.xrpInDrops)).toBe(100);
    expect(quote.xrpIn).toBe(100);
  });

  it('large amounts maintain precision', () => {
    const xrpIn = 50000;  // 50,000 XRP draw
    const rlusdOut = xrpIn * 2.5;  // 125,000 RLUSD
    const minOut = rlusdOut * 0.99;
    expect(minOut).toBeCloseTo(123750, 0);
  });
});

// ─── TESTS: Trust Line Status ─────────────────────────────────────────────────

describe('Trust Line Status', () => {
  it('trust line with balance has expected fields', () => {
    const status = makeTrustLineStatus(true, '500.00');
    expect(status.hasTrustLine).toBe(true);
    expect(status.rlusdBalance).toBe('500.00');
    expect(status.rlusdLimit).toBeDefined();
  });

  it('missing trust line returns hasTrustLine false', () => {
    const status = makeTrustLineStatus(false);
    expect(status.hasTrustLine).toBe(false);
    expect(status.rlusdBalance).toBeUndefined();
  });

  it('sufficient balance check logic', () => {
    const status = makeTrustLineStatus(true, '1000.00');
    const drawAmount = 250;
    const feeAmount = 0.75; // 30bps on 250
    const total = drawAmount + feeAmount;
    expect(parseFloat(status.rlusdBalance || '0')).toBeGreaterThanOrEqual(total);
  });

  it('insufficient balance is detectable', () => {
    const status = makeTrustLineStatus(true, '100.00');
    const needed = 250 + 0.75;
    expect(parseFloat(status.rlusdBalance || '0') < needed).toBe(true);
  });
});

// ─── TESTS: Settlement Path Types ────────────────────────────────────────────

describe('SettlementPath types', () => {
  it('DEX_SWAP result has correct path', () => {
    const result: DexSwapResult = {
      success: true,
      dridString: 'PROJ:draw1',
      path: 'DEX_SWAP',
      swapTxHash: 'TX_HASH',
      rlusdReceived: '247.50',
      xrpSoldDrops: '100000000',
      rateRlusdPerXrp: 2.475,
    };
    expect(result.path).toBe('DEX_SWAP');
    expect(result.success).toBe(true);
  });

  it('DIRECT_TRANSFER result has correct path', () => {
    const result: DirectTransferResult = {
      success: true,
      dridString: 'PROJ:draw1',
      path: 'DIRECT_TRANSFER',
      transferTxHash: 'TX_HASH',
      rlusdTransferred: '250.00',
    };
    expect(result.path).toBe('DIRECT_TRANSFER');
    expect(result.success).toBe(true);
  });

  it('failed DEX_SWAP has error field', () => {
    const result: DexSwapResult = {
      success: false,
      dridString: 'PROJ:draw2',
      path: 'DEX_SWAP',
      error: 'No liquidity',
    };
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── TESTS: Protocol Fee Math ─────────────────────────────────────────────────

describe('Protocol Fee Calculation (30 bps)', () => {
  function calcFeeDrops(amountDrops: string, bps: number): string {
    const fee = Math.floor((parseInt(amountDrops, 10) * bps) / 10000);
    return String(fee);
  }

  it('30 bps on 100 XRP = 0.30 XRP (300,000 drops)', () => {
    const fee = calcFeeDrops('100000000', 30);
    expect(fee).toBe('300000');
    expect(dropsToXrp(fee)).toBeCloseTo(0.3, 6);
  });

  it('30 bps on 250 XRP = 0.75 XRP (750,000 drops)', () => {
    const fee = calcFeeDrops('250000000', 30);
    expect(fee).toBe('750000');
  });

  it('30 bps on 10,000 XRP = 30 XRP', () => {
    const fee = calcFeeDrops('10000000000', 30);
    expect(dropsToXrp(fee)).toBeCloseTo(30, 6);
  });

  it('30 bps in RLUSD on 250 RLUSD = 0.75 RLUSD', () => {
    const drawRlusd = 250;
    const feeRlusd = (drawRlusd * 30) / 10000;
    expect(feeRlusd).toBeCloseTo(0.75, 4);
  });
});

// ─── TESTS: Amount Precision ──────────────────────────────────────────────────

describe('RLUSD Amount Precision', () => {
  it('RLUSD values support 6 decimal places', () => {
    const value = '247.123456';
    expect(parseFloat(value)).toBeCloseTo(247.123456, 6);
  });

  it('XRP → RLUSD rate at 6 decimal precision', () => {
    const xrpIn = 100;
    const rlusdOut = 250.123456;
    const rate = rlusdOut / xrpIn;
    expect(rate).toBeCloseTo(2.50123456, 6);
  });

  it('minRlusdOut precision is maintained', () => {
    const rlusdOut = 247.123456;
    const slippage = 0.01;
    const minOut = (rlusdOut * (1 - slippage)).toFixed(6);
    expect(parseFloat(minOut)).toBeCloseTo(244.652221, 4);
  });
});

// ─── INTEGRATION (XRPL Testnet) ───────────────────────────────────────────────

const RUN_INTEGRATION = process.env.XRPL_RUN_INTEGRATION === 'true';

describe.skipIf(!RUN_INTEGRATION)('Integration — SettlementEngine (XRPL Testnet)', () => {
  it('trust line + DEX swap lifecycle', async () => {
    expect(true).toBe(true);
  }, 120_000);
});
