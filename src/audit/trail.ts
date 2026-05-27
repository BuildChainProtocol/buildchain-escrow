/**
 * BuildChain Protocol — Audit Trail Builder (Module 6)
 *
 * Constructs a complete chronological audit trail for a DRID by
 * synthesizing data from the EscrowRegistry and on-chain TX lookups.
 *
 * Every escrow status transition, on-chain verification, and settlement
 * event is captured as an AuditEvent with timestamps and explorer links.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import { Client } from 'xrpl';
import { EscrowRegistry } from '../registry/registry';
import { EscrowRecord, DRIDString } from '../types';
import { getConfig, dropsToXrp } from '../config/network';
import { getExplorerUrl } from '../escrow/monitor';
import {
  AuditTrail,
  AuditEvent,
  AuditEventType,
  DrawSummary,
  ProjectDashboard,
} from './types';

// ─── EXPLORER URL HELPER ─────────────────────────────────────────────────────

function explorerLink(txHash: string | undefined, network: 'testnet' | 'mainnet'): string | undefined {
  if (!txHash) return undefined;
  return getExplorerUrl(txHash, network);
}

// ─── BUILD AUDIT EVENTS FROM RECORD ──────────────────────────────────────────

/**
 * Build a chronological list of AuditEvents from an EscrowRecord.
 * Events are derived from TX hashes, timestamps, and verification conditions
 * stored in the registry.
 */
function buildEventsFromRecord(
  record: EscrowRecord,
  network: 'testnet' | 'mainnet'
): AuditEvent[] {
  const events: AuditEvent[] = [];
  let seq = 1;

  const addEvent = (
    type: AuditEventType,
    description: string,
    timestamp: string,
    overrides: Partial<AuditEvent> = {}
  ) => {
    events.push({
      sequence: seq++,
      type,
      description,
      timestamp,
      ...overrides,
    });
  };

  // ── Escrow creation ───────────────────────────────────────────────────────
  addEvent(
    'ESCROW_CREATED',
    `Escrow created for "${record.milestoneDescription}". ` +
    `${dropsToXrp(record.amountDrops)} XRP locked until ${record.finishAfter}.`,
    record.createdAt,
    {
      txHash: record.createTxHash,
      explorerUrl: explorerLink(record.createTxHash, network),
      actor: record.lenderAddress,
      toStatus: 'FUNDED',
      metadata: {
        amountXrp: dropsToXrp(record.amountDrops).toString(),
        lender: record.lenderAddress,
        gc: record.gcAddress,
        finishAfter: record.finishAfter,
        cancelAfter: record.cancelAfter,
      },
    }
  );

  // ── Status transition from FUNDED → PENDING_VERIFICATION ─────────────────
  const vc = record.verificationConditions;

  if (vc.inspectorCredentialVerified || vc.lienWaiverNftVerified) {
    addEvent(
      'VERIFICATION_STARTED',
      `Verification process initiated. Awaiting dual-condition: ` +
      `Inspector Credential + Lien Waiver NFT.`,
      record.updatedAt,
      {
        fromStatus: 'FUNDED',
        toStatus: 'PENDING_VERIFICATION',
      }
    );
  }

  // ── Inspector credential verified ─────────────────────────────────────────
  if (vc.inspectorCredentialVerified) {
    addEvent(
      'CREDENTIAL_VERIFIED',
      `XLS-0070 Inspector Credential verified on-chain for DRID ${record.drid}.`,
      vc.verifiedAt || record.updatedAt,
      {
        onChainRef: vc.inspectorCredentialTxHash,
        explorerUrl: explorerLink(vc.inspectorCredentialTxHash, network),
        metadata: {
          credentialTxHash: vc.inspectorCredentialTxHash || 'N/A',
        },
      }
    );
  }

  // ── Lien waiver NFT verified ──────────────────────────────────────────────
  if (vc.lienWaiverNftVerified) {
    addEvent(
      'NFT_VERIFIED',
      `XLS-20 Lien Waiver NFT verified on-chain for DRID ${record.drid}.`,
      vc.verifiedAt || record.updatedAt,
      {
        onChainRef: vc.lienWaiverNftTxHash,
        explorerUrl: explorerLink(vc.lienWaiverNftTxHash, network),
        metadata: {
          nftTxHash: vc.lienWaiverNftTxHash || 'N/A',
        },
      }
    );
  }

  // ── Dual condition met ────────────────────────────────────────────────────
  if (vc.inspectorCredentialVerified && vc.lienWaiverNftVerified && vc.verifiedAt) {
    addEvent(
      'DUAL_CONDITION_MET',
      `Both verification conditions met simultaneously. ` +
      `Orchestrator authorized EscrowFinish.`,
      vc.verifiedAt,
      {
        fromStatus: 'PENDING_VERIFICATION',
        toStatus: 'DUAL_CONDITION_MET',
        metadata: {
          credentialRef: vc.inspectorCredentialTxHash || 'N/A',
          nftRef: vc.lienWaiverNftTxHash || 'N/A',
        },
      }
    );
  }

  // ── Escrow released ───────────────────────────────────────────────────────
  if (record.status === 'RELEASED' && record.finishTxHash) {
    addEvent(
      'ESCROW_RELEASED',
      `EscrowFinish executed. ${dropsToXrp(record.amountDrops)} XRP released to GC (${record.gcAddress}).`,
      record.updatedAt,
      {
        txHash: record.finishTxHash,
        explorerUrl: explorerLink(record.finishTxHash, network),
        actor: record.gcAddress,
        fromStatus: 'DUAL_CONDITION_MET',
        toStatus: 'RELEASED',
        metadata: {
          amountXrp: dropsToXrp(record.amountDrops).toString(),
          recipient: record.gcAddress,
        },
      }
    );
  }

  // ── Escrow cancelled ──────────────────────────────────────────────────────
  if (record.status === 'CANCELLED' && record.cancelTxHash) {
    addEvent(
      'ESCROW_CANCELLED',
      `EscrowCancel executed. Funds returned to lender (${record.lenderAddress}).`,
      record.updatedAt,
      {
        txHash: record.cancelTxHash,
        explorerUrl: explorerLink(record.cancelTxHash, network),
        actor: record.lenderAddress,
        fromStatus: 'PENDING_VERIFICATION',
        toStatus: 'CANCELLED',
        metadata: { recipient: record.lenderAddress },
      }
    );
  }

  // ── Escrow expired ────────────────────────────────────────────────────────
  if (record.status === 'EXPIRED') {
    addEvent(
      'ESCROW_EXPIRED',
      `Escrow expired at CancelAfter (${record.cancelAfter}). ` +
      `Dual-condition was not met in time.`,
      record.cancelAfter,
      {
        fromStatus: 'PENDING_VERIFICATION',
        toStatus: 'EXPIRED',
        metadata: {
          cancelAfter: record.cancelAfter,
          inspectorCredential: vc.inspectorCredentialVerified ? 'verified' : 'not verified',
          lienWaiverNft: vc.lienWaiverNftVerified ? 'verified' : 'not verified',
        },
      }
    );
  }

  // Sort events by timestamp ascending
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Re-sequence after sort
  events.forEach((e, i) => { e.sequence = i + 1; });

  return events;
}

// ─── BUILD AUDIT TRAIL ────────────────────────────────────────────────────────

/**
 * Build a complete AuditTrail for a DRID from registry data.
 *
 * @param registry   EscrowRegistry
 * @param dridString DRID to build trail for
 * @param network    XRPL network (for explorer URLs)
 */
export function buildAuditTrail(
  registry: EscrowRegistry,
  dridString: DRIDString,
  network: 'testnet' | 'mainnet' = 'testnet'
): AuditTrail {
  const record = registry.getOrThrow(dridString);
  const events = buildEventsFromRecord(record, network);

  return {
    dridString,
    projectId: record.projectId,
    drawNumber: record.drawNumber,
    milestoneDescription: record.milestoneDescription,
    currentStatus: record.status,
    events,
    eventCount: events.length,
    createdAt: record.createdAt,
    lastUpdatedAt: record.updatedAt,
    createTxHash: record.createTxHash,
    finishTxHash: record.finishTxHash,
    cancelTxHash: record.cancelTxHash,
    credentialLedgerIndex: record.verificationConditions.inspectorCredentialTxHash,
    nfTokenId: record.verificationConditions.lienWaiverNftTxHash,
    network,
  };
}

// ─── BUILD DRAW SUMMARY ───────────────────────────────────────────────────────

/**
 * Build a lender-facing DrawSummary for dashboard display.
 */
export function buildDrawSummary(
  record: EscrowRecord,
  network: 'testnet' | 'mainnet' = 'testnet'
): DrawSummary {
  const now = new Date();
  const cancelAfter = new Date(record.cancelAfter);
  const timeRemaining = Math.max(0, Math.floor((cancelAfter.getTime() - now.getTime()) / 1000));

  const statusLabels: Record<string, string> = {
    FUNDED: '💰 Funded — Awaiting Verification',
    PENDING_VERIFICATION: '🔍 Pending Dual-Condition Verification',
    DUAL_CONDITION_MET: '🎯 Dual Condition Met — Releasing Funds',
    RELEASED: '✅ Released — Funds Paid to GC',
    CANCELLED: '❌ Cancelled — Funds Returned to Lender',
    EXPIRED: '⏰ Expired — CancelAfter Passed',
  };

  const hrs = Math.floor(timeRemaining / 3600);
  const mins = Math.floor((timeRemaining % 3600) / 60);
  const timeLabel =
    record.status === 'RELEASED' || record.status === 'CANCELLED' || record.status === 'EXPIRED'
      ? '—'
      : `${hrs}h ${mins}m remaining`;

  return {
    dridString: record.drid,
    projectId: record.projectId,
    drawNumber: record.drawNumber,
    milestoneDescription: record.milestoneDescription,
    status: record.status,
    statusLabel: statusLabels[record.status] || record.status,
    amountXrp: dropsToXrp(record.amountDrops).toString(),
    amountDrops: record.amountDrops,
    lenderAddress: record.lenderAddress,
    gcAddress: record.gcAddress,
    finishAfter: record.finishAfter,
    cancelAfter: record.cancelAfter,
    timeRemainingSeconds: timeRemaining,
    timeRemainingLabel: timeLabel,
    onChainConfirmed: !!record.createTxHash,
    inspectorCredentialVerified: record.verificationConditions.inspectorCredentialVerified,
    lienWaiverNftVerified: record.verificationConditions.lienWaiverNftVerified,
    dualConditionMet:
      record.verificationConditions.inspectorCredentialVerified &&
      record.verificationConditions.lienWaiverNftVerified,
    createTxHash: record.createTxHash,
    finishTxHash: record.finishTxHash,
    cancelTxHash: record.cancelTxHash,
    explorerLinks: {
      create: explorerLink(record.createTxHash, network),
      finish: explorerLink(record.finishTxHash, network),
      cancel: explorerLink(record.cancelTxHash, network),
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ─── BUILD PROJECT DASHBOARD ──────────────────────────────────────────────────

/**
 * Build a full ProjectDashboard for a lender, covering all draws for a project.
 */
export function buildProjectDashboard(
  registry: EscrowRegistry,
  projectId: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): ProjectDashboard {
  const records = registry.getByProject(projectId);
  const draws = records.map((r) => buildDrawSummary(r, network));

  const totalAmountXrp = draws.reduce((sum, d) => sum + parseFloat(d.amountXrp), 0);
  const releasedDraws = draws.filter((d) => d.status === 'RELEASED');
  const pendingDraws = draws.filter(
    (d) => d.status === 'FUNDED' || d.status === 'PENDING_VERIFICATION' || d.status === 'DUAL_CONDITION_MET'
  );

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    network,
    stats: {
      totalDraws: draws.length,
      totalAmountXrp,
      releasedDraws: releasedDraws.length,
      releasedAmountXrp: releasedDraws.reduce((s, d) => s + parseFloat(d.amountXrp), 0),
      pendingDraws: pendingDraws.length,
      pendingAmountXrp: pendingDraws.reduce((s, d) => s + parseFloat(d.amountXrp), 0),
      cancelledDraws: draws.filter((d) => d.status === 'CANCELLED').length,
      expiredDraws: draws.filter((d) => d.status === 'EXPIRED').length,
    },
    draws: draws.sort((a, b) => a.drawNumber - b.drawNumber),
  };
}
