/**
 * BuildChain Protocol — Network Configuration
 * Manages XRPL client connections for testnet and mainnet
 */

import { Client } from 'xrpl';
import * as dotenv from 'dotenv';
import { ProtocolConfig } from '../types';

dotenv.config();

// ─── NETWORK URLS ─────────────────────────────────────────────────────────────

export const NETWORK_URLS = {
  testnet: process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233',
  mainnet: process.env.XRPL_MAINNET_URL || 'wss://xrplcluster.com',
} as const;

// ─── PROTOCOL CONFIG ──────────────────────────────────────────────────────────

export function getConfig(): ProtocolConfig {
  const network = (process.env.XRPL_NETWORK || 'testnet') as 'testnet' | 'mainnet';

  if (network === 'mainnet') {
    console.warn(
      '⚠️  MAINNET MODE — Real funds at risk. Confirm this is intentional.'
    );
  }

  return {
    network,
    serverUrl: NETWORK_URLS[network],
    defaultFinishAfterHours: parseInt(process.env.DEFAULT_FINISH_AFTER_HOURS || '1', 10),
    defaultCancelAfterDays: parseInt(process.env.DEFAULT_ESCROW_WINDOW_DAYS || '90', 10),
    protocolFeeBps: parseInt(process.env.PROTOCOL_FEE_BPS || '30', 10),
    registryPath: process.env.REGISTRY_PATH || './data/escrow-registry.json',
  };
}

// ─── CLIENT MANAGEMENT ───────────────────────────────────────────────────────

let _client: Client | null = null;

/**
 * Get or create a connected XRPL client.
 * Reuses existing connection if already connected.
 */
export async function getClient(): Promise<Client> {
  const config = getConfig();

  if (_client && _client.isConnected()) {
    return _client;
  }

  _client = new Client(config.serverUrl);
  await _client.connect();

  console.log(`✅ Connected to XRPL ${config.network.toUpperCase()} — ${config.serverUrl}`);
  return _client;
}

/**
 * Disconnect the XRPL client gracefully.
 */
export async function disconnectClient(): Promise<void> {
  if (_client && _client.isConnected()) {
    await _client.disconnect();
    _client = null;
    console.log('🔌 Disconnected from XRPL');
  }
}

// ─── UTILITY ─────────────────────────────────────────────────────────────────

/**
 * Convert XRP to drops (1 XRP = 1,000,000 drops)
 */
export function xrpToDrops(xrp: number): string {
  return (Math.floor(xrp * 1_000_000)).toString();
}

/**
 * Convert drops to XRP
 */
export function dropsToXrp(drops: string): number {
  return parseInt(drops, 10) / 1_000_000;
}

/**
 * Convert a Date to XRPL ripple time (seconds since Jan 1, 2000)
 */
export function dateToRippleTime(date: Date): number {
  const RIPPLE_EPOCH = 946684800; // Unix timestamp for Jan 1, 2000
  return Math.floor(date.getTime() / 1000) - RIPPLE_EPOCH;
}

/**
 * Convert XRPL ripple time to Date
 */
export function rippleTimeToDate(rippleTime: number): Date {
  const RIPPLE_EPOCH = 946684800;
  return new Date((rippleTime + RIPPLE_EPOCH) * 1000);
}

/**
 * Calculate protocol fee in drops (0.30% = 30 bps)
 */
export function calculateProtocolFee(amountDrops: string, feeBps: number): string {
  const amount = parseInt(amountDrops, 10);
  const fee = Math.floor(amount * feeBps / 10000);
  return fee.toString();
}
