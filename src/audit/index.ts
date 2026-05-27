/**
 * BuildChain Protocol — Audit Engine (Module 6)
 *
 * Public API for audit trail generation and lender dashboard reporting.
 *
 * Usage:
 *   const audit = new AuditEngine(registry, 'testnet');
 *
 *   // Single draw audit
 *   const trail = audit.getTrail('PROJ-001:draw1');
 *   audit.printTrail(trail);
 *   const json = audit.exportTrailJson(trail);
 *
 *   // Full project dashboard
 *   const dashboard = audit.getDashboard('PROJ-001');
 *   audit.printDashboard(dashboard);
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import * as fs from 'fs';
import * as path from 'path';
import { EscrowRegistry } from '../registry/registry';
import { DRIDString, EscrowRecord } from '../types';
import {
  AuditTrail,
  DrawSummary,
  ProjectDashboard,
  ReportOptions,
} from './types';
import {
  buildAuditTrail,
  buildDrawSummary,
  buildProjectDashboard,
} from './trail';
import {
  formatAuditTrailText,
  formatDashboardText,
  exportAuditTrailJson,
  exportDashboardJson,
  printAuditTrail,
  printDashboard,
} from './report';

export class AuditEngine {
  private registry: EscrowRegistry;
  private network: 'testnet' | 'mainnet';

  /**
   * @param registry  EscrowRegistry (provides all escrow data)
   * @param network   XRPL network (used for explorer URL generation)
   */
  constructor(registry: EscrowRegistry, network: 'testnet' | 'mainnet' = 'testnet') {
    this.registry = registry;
    this.network = network;

    console.log(`\n📋 AuditEngine initialized`);
    console.log(`   Network: ${network}`);
  }

  // ─── AUDIT TRAIL ───────────────────────────────────────────────────────────

  /**
   * Build a complete audit trail for a single DRID.
   * Chronological event log with on-chain TX hashes and explorer links.
   */
  getTrail(dridString: DRIDString): AuditTrail {
    return buildAuditTrail(this.registry, dridString, this.network);
  }

  /**
   * Print audit trail to console.
   */
  printTrail(trail: AuditTrail, options?: ReportOptions): void {
    printAuditTrail(trail, { ...options, network: this.network });
  }

  /**
   * Get audit trail as formatted text string.
   */
  formatTrail(trail: AuditTrail, options?: ReportOptions): string {
    return formatAuditTrailText(trail, { ...options, network: this.network });
  }

  /**
   * Export audit trail as JSON string.
   */
  exportTrailJson(trail: AuditTrail): string {
    return exportAuditTrailJson(trail);
  }

  /**
   * Save audit trail to a JSON file.
   * @param trail     AuditTrail to save
   * @param filePath  Output file path (e.g. './audits/PROJ-001_draw1.json')
   */
  saveTrailJson(trail: AuditTrail, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, exportAuditTrailJson(trail), 'utf-8');
    console.log(`📋 Audit trail saved: ${filePath}`);
  }

  /**
   * Save audit trail as formatted text file.
   */
  saveTrailText(trail: AuditTrail, filePath: string, options?: ReportOptions): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, formatAuditTrailText(trail, options), 'utf-8');
    console.log(`📋 Audit trail text saved: ${filePath}`);
  }

  // ─── DRAW SUMMARY ─────────────────────────────────────────────────────────

  /**
   * Build a lender-facing DrawSummary for a single DRID.
   */
  getDrawSummary(dridString: DRIDString): DrawSummary {
    const record = this.registry.getOrThrow(dridString);
    return buildDrawSummary(record, this.network);
  }

  // ─── PROJECT DASHBOARD ────────────────────────────────────────────────────

  /**
   * Build a full ProjectDashboard for a lender (all draws in a project).
   */
  getDashboard(projectId: string): ProjectDashboard {
    return buildProjectDashboard(this.registry, projectId, this.network);
  }

  /**
   * Print the project dashboard to console.
   */
  printDashboard(dashboard: ProjectDashboard): void {
    printDashboard(dashboard);
  }

  /**
   * Get dashboard as formatted text string.
   */
  formatDashboard(dashboard: ProjectDashboard): string {
    return formatDashboardText(dashboard);
  }

  /**
   * Export dashboard as JSON string.
   */
  exportDashboardJson(dashboard: ProjectDashboard): string {
    return exportDashboardJson(dashboard);
  }

  /**
   * Save dashboard JSON to file.
   */
  saveDashboardJson(dashboard: ProjectDashboard, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, exportDashboardJson(dashboard), 'utf-8');
    console.log(`📋 Dashboard saved: ${filePath}`);
  }

  // ─── BULK OPERATIONS ──────────────────────────────────────────────────────

  /**
   * Export all trails for a project to a directory.
   * Creates one JSON file per draw.
   */
  exportProjectAudits(projectId: string, outputDir: string): void {
    const records = this.registry.getByProject(projectId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`\n📦 Exporting ${records.length} audit trail(s) for project ${projectId}`);

    for (const record of records) {
      const trail = buildAuditTrail(this.registry, record.drid, this.network);
      const safeDrid = record.drid.replace(/[:/]/g, '_');
      const filePath = path.join(outputDir, `audit_${safeDrid}.json`);
      this.saveTrailJson(trail, filePath);
    }

    // Also export the full dashboard
    const dashboard = buildProjectDashboard(this.registry, projectId, this.network);
    this.saveDashboardJson(dashboard, path.join(outputDir, `dashboard_${projectId}.json`));

    console.log(`✅ Exported to: ${outputDir}`);
  }
}

// Re-export types and formatters
export {
  AuditTrail,
  DrawSummary,
  ProjectDashboard,
  ReportOptions,
  AuditEvent,
  AuditEventType,
} from './types';
export {
  formatAuditTrailText,
  formatDashboardText,
  exportAuditTrailJson,
  exportDashboardJson,
  printAuditTrail,
  printDashboard,
} from './report';
export { buildAuditTrail, buildDrawSummary, buildProjectDashboard } from './trail';
