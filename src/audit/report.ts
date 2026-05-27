/**
 * BuildChain Protocol — Audit Report Generator (Module 6)
 *
 * Formats AuditTrails and ProjectDashboards into human-readable
 * text reports and structured JSON exports.
 *
 * Output formats:
 *   TEXT — formatted console/terminal report with unicode borders
 *   JSON — structured export for downstream systems (PDF renderer, API, etc.)
 *
 * Use cases:
 *   - Lender disputes: export full trail as JSON for legal review
 *   - GC payment confirmation: text receipt with all TX links
 *   - Regulatory compliance: timestamped event log with on-chain anchors
 *   - Dashboard API: JSON feed for the web UI
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { AuditTrail, AuditEvent, ProjectDashboard, DrawSummary, ReportOptions } from './types';
import { dropsToXrp } from '../config/network';

// ─── TEXT REPORT ─────────────────────────────────────────────────────────────

const LINE  = '─'.repeat(64);
const DLINE = '═'.repeat(64);

/**
 * Generate a formatted text report for a single DRID's audit trail.
 */
export function formatAuditTrailText(trail: AuditTrail, options: ReportOptions = {}): string {
  const includeEvents = options.includeEvents !== false;
  const includeLinks  = options.includeExplorerLinks !== false;
  const lines: string[] = [];

  lines.push(DLINE);
  lines.push(`  BuildChain Protocol — Escrow Audit Trail`);
  lines.push(`  DRID: ${trail.dridString}`);
  lines.push(DLINE);
  lines.push('');
  lines.push(`  Project:     ${trail.projectId}`);
  lines.push(`  Draw #:      ${trail.drawNumber}`);
  lines.push(`  Milestone:   ${trail.milestoneDescription}`);
  lines.push(`  Network:     ${trail.network.toUpperCase()}`);
  lines.push(`  Status:      ${trail.currentStatus}`);
  lines.push(`  Generated:   ${new Date().toISOString()}`);
  lines.push('');
  lines.push(LINE);
  lines.push('  ON-CHAIN TRANSACTIONS');
  lines.push(LINE);

  if (trail.createTxHash) {
    lines.push(`  EscrowCreate:  ${trail.createTxHash}`);
    if (includeLinks && trail.network) {
      lines.push(`    Explorer: https://${trail.network === 'testnet' ? 'testnet' : 'livenet'}.xrpl.org/transactions/${trail.createTxHash}`);
    }
  }
  if (trail.finishTxHash) {
    lines.push(`  EscrowFinish:  ${trail.finishTxHash}`);
    if (includeLinks) {
      lines.push(`    Explorer: https://${trail.network === 'testnet' ? 'testnet' : 'livenet'}.xrpl.org/transactions/${trail.finishTxHash}`);
    }
  }
  if (trail.cancelTxHash) {
    lines.push(`  EscrowCancel:  ${trail.cancelTxHash}`);
    if (includeLinks) {
      lines.push(`    Explorer: https://${trail.network === 'testnet' ? 'testnet' : 'livenet'}.xrpl.org/transactions/${trail.cancelTxHash}`);
    }
  }
  if (trail.credentialLedgerIndex) {
    lines.push(`  Credential:    ${trail.credentialLedgerIndex}`);
  }
  if (trail.nfTokenId) {
    lines.push(`  NFTokenID:     ${trail.nfTokenId}`);
  }
  if (!trail.createTxHash && !trail.finishTxHash && !trail.cancelTxHash) {
    lines.push(`  No on-chain transactions recorded.`);
  }

  if (includeEvents && trail.events.length > 0) {
    lines.push('');
    lines.push(LINE);
    lines.push(`  EVENT LOG (${trail.events.length} events)`);
    lines.push(LINE);

    for (const event of trail.events) {
      lines.push('');
      lines.push(`  [${String(event.sequence).padStart(2, '0')}] ${event.type}`);
      lines.push(`       Time:  ${event.timestamp}`);
      lines.push(`       ${event.description}`);
      if (event.txHash) {
        lines.push(`       TX:    ${event.txHash}`);
      }
      if (event.onChainRef && event.onChainRef !== event.txHash) {
        lines.push(`       Ref:   ${event.onChainRef}`);
      }
      if (event.fromStatus && event.toStatus) {
        lines.push(`       State: ${event.fromStatus} → ${event.toStatus}`);
      }
      if (event.metadata) {
        for (const [k, v] of Object.entries(event.metadata)) {
          lines.push(`       ${k}: ${v}`);
        }
      }
    }
  }

  lines.push('');
  lines.push(DLINE);
  lines.push(`  PATENT PENDING — Docket BLDCHN-001-P`);
  lines.push(`  © BuildChain Protocol, Inc. — CONFIDENTIAL`);
  lines.push(DLINE);
  lines.push('');

  return lines.join('\n');
}

// ─── PROJECT DASHBOARD REPORT ────────────────────────────────────────────────

/**
 * Generate a formatted text dashboard report for a lender.
 */
export function formatDashboardText(dashboard: ProjectDashboard): string {
  const lines: string[] = [];
  const s = dashboard.stats;

  lines.push(DLINE);
  lines.push(`  BuildChain Protocol — Lender Dashboard`);
  lines.push(`  Project: ${dashboard.projectId}`);
  lines.push(DLINE);
  lines.push('');
  lines.push(`  Generated:          ${dashboard.generatedAt}`);
  lines.push(`  Network:            ${dashboard.network.toUpperCase()}`);
  lines.push('');
  lines.push(LINE);
  lines.push('  PROJECT SUMMARY');
  lines.push(LINE);
  lines.push(`  Total draws:        ${s.totalDraws}`);
  lines.push(`  Total committed:    ${s.totalAmountXrp.toFixed(2)} XRP`);
  lines.push(`  Released (paid):    ${s.releasedDraws} draws — ${s.releasedAmountXrp.toFixed(2)} XRP`);
  lines.push(`  Pending:            ${s.pendingDraws} draws — ${s.pendingAmountXrp.toFixed(2)} XRP`);
  lines.push(`  Cancelled:          ${s.cancelledDraws} draws`);
  lines.push(`  Expired:            ${s.expiredDraws} draws`);
  lines.push('');

  const pct = s.totalAmountXrp > 0
    ? ((s.releasedAmountXrp / s.totalAmountXrp) * 100).toFixed(1)
    : '0.0';
  const barLen = 40;
  const filled = Math.round((s.releasedAmountXrp / (s.totalAmountXrp || 1)) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  lines.push(`  Disbursed: [${bar}] ${pct}%`);
  lines.push('');

  lines.push(LINE);
  lines.push('  DRAW DETAILS');
  lines.push(LINE);

  for (const draw of dashboard.draws) {
    lines.push('');
    lines.push(`  Draw #${draw.drawNumber} — ${draw.milestoneDescription}`);
    lines.push(`  DRID:     ${draw.dridString}`);
    lines.push(`  Amount:   ${draw.amountXrp} XRP`);
    lines.push(`  Status:   ${draw.statusLabel}`);
    lines.push(`  GC:       ${draw.gcAddress}`);
    lines.push(`  Credential: ${draw.inspectorCredentialVerified ? '✅ Verified' : '⏳ Pending'}`);
    lines.push(`  NFT:        ${draw.lienWaiverNftVerified ? '✅ Verified' : '⏳ Pending'}`);
    if (draw.status !== 'RELEASED' && draw.status !== 'CANCELLED' && draw.status !== 'EXPIRED') {
      lines.push(`  Time left:  ${draw.timeRemainingLabel}`);
    }
    if (draw.createTxHash) {
      lines.push(`  Create TX:  ${draw.createTxHash}`);
    }
    if (draw.finishTxHash) {
      lines.push(`  Finish TX:  ${draw.finishTxHash}`);
    }
    lines.push(`  ${LINE.slice(2)}`);
  }

  lines.push('');
  lines.push(DLINE);
  lines.push(`  PATENT PENDING — Docket BLDCHN-001-P`);
  lines.push(`  © BuildChain Protocol, Inc. — CONFIDENTIAL`);
  lines.push(DLINE);
  lines.push('');

  return lines.join('\n');
}

// ─── JSON EXPORT ─────────────────────────────────────────────────────────────

/**
 * Export an AuditTrail as a formatted JSON string.
 */
export function exportAuditTrailJson(trail: AuditTrail): string {
  return JSON.stringify(trail, null, 2);
}

/**
 * Export a ProjectDashboard as a formatted JSON string.
 */
export function exportDashboardJson(dashboard: ProjectDashboard): string {
  return JSON.stringify(dashboard, null, 2);
}

// ─── CONSOLE PRINTERS ────────────────────────────────────────────────────────

/**
 * Print an audit trail report to the console.
 */
export function printAuditTrail(trail: AuditTrail, options?: ReportOptions): void {
  console.log(formatAuditTrailText(trail, options));
}

/**
 * Print a lender dashboard to the console.
 */
export function printDashboard(dashboard: ProjectDashboard): void {
  console.log(formatDashboardText(dashboard));
}
