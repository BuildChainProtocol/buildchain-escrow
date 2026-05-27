/**
 * BuildChain Protocol — DRID Escrow Registry
 *
 * Maps Draw Request IDs (DRIDs) to their full EscrowRecord state.
 * Persists to a JSON file. In production, replace with a database (PostgreSQL).
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import * as fs from 'fs';
import * as path from 'path';
import { EscrowRecord, DRIDString, EscrowStatus, VerificationConditions } from '../types';

interface RegistryStore {
  version: string;
  lastUpdated: string;
  records: Record<DRIDString, EscrowRecord>;
}

export class EscrowRegistry {
  private registryPath: string;
  private store: RegistryStore;

  constructor(registryPath: string) {
    this.registryPath = path.resolve(registryPath);
    this.store = this.load();
  }

  // ─── PERSISTENCE ───────────────────────────────────────────────────────────

  private load(): RegistryStore {
    const dir = path.dirname(this.registryPath);

    // Create data directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.registryPath)) {
      const empty: RegistryStore = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        records: {},
      };
      this.persist(empty);
      return empty;
    }

    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8');
      return JSON.parse(raw) as RegistryStore;
    } catch (err) {
      throw new Error(`Failed to load escrow registry from ${this.registryPath}: ${err}`);
    }
  }

  private persist(store?: RegistryStore): void {
    const data = store || this.store;
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ─── CRUD OPERATIONS ───────────────────────────────────────────────────────

  /**
   * Store a new escrow record. Throws if DRID already exists.
   */
  save(record: EscrowRecord): void {
    if (this.store.records[record.drid]) {
      throw new Error(
        `DRID already exists in registry: ${record.drid}. ` +
        `Use update() to modify existing records.`
      );
    }
    this.store.records[record.drid] = record;
    this.persist();
    console.log(`📋 Registry: saved escrow record for DRID ${record.drid}`);
  }

  /**
   * Get an escrow record by DRID. Returns null if not found.
   */
  get(dridString: DRIDString): EscrowRecord | null {
    return this.store.records[dridString] || null;
  }

  /**
   * Get an escrow record or throw if not found.
   */
  getOrThrow(dridString: DRIDString): EscrowRecord {
    const record = this.get(dridString);
    if (!record) {
      throw new Error(`DRID not found in registry: ${dridString}`);
    }
    return record;
  }

  /**
   * Update an existing escrow record. Throws if DRID does not exist.
   */
  update(dridString: DRIDString, updates: Partial<EscrowRecord>): EscrowRecord {
    const existing = this.getOrThrow(dridString);
    const updated: EscrowRecord = {
      ...existing,
      ...updates,
      drid: dridString,                          // Prevent DRID mutation
      updatedAt: new Date().toISOString(),
    };
    this.store.records[dridString] = updated;
    this.persist();
    console.log(`📋 Registry: updated DRID ${dridString} → status: ${updated.status}`);
    return updated;
  }

  /**
   * Update the status of an escrow record.
   */
  updateStatus(dridString: DRIDString, status: EscrowStatus): EscrowRecord {
    return this.update(dridString, { status });
  }

  /**
   * Update verification conditions (called by Module 4 — Orchestrator).
   */
  updateVerification(
    dridString: DRIDString,
    conditions: Partial<VerificationConditions>
  ): EscrowRecord {
    const existing = this.getOrThrow(dridString);
    const updatedConditions: VerificationConditions = {
      ...existing.verificationConditions,
      ...conditions,
    };

    // Auto-detect if dual-condition is now met
    if (
      updatedConditions.inspectorCredentialVerified &&
      updatedConditions.lienWaiverNftVerified &&
      !updatedConditions.verifiedAt
    ) {
      updatedConditions.verifiedAt = new Date().toISOString();
      console.log(`🎯 DUAL-CONDITION MET for DRID: ${dridString}`);
    }

    const newStatus: EscrowStatus =
      updatedConditions.inspectorCredentialVerified &&
      updatedConditions.lienWaiverNftVerified
        ? 'DUAL_CONDITION_MET'
        : 'PENDING_VERIFICATION';

    return this.update(dridString, {
      verificationConditions: updatedConditions,
      status: newStatus,
    });
  }

  // ─── QUERIES ───────────────────────────────────────────────────────────────

  /**
   * Get all records with a given status.
   */
  getByStatus(status: EscrowStatus): EscrowRecord[] {
    return Object.values(this.store.records).filter((r) => r.status === status);
  }

  /**
   * Get all records for a given project.
   */
  getByProject(projectId: string): EscrowRecord[] {
    return Object.values(this.store.records).filter((r) => r.projectId === projectId);
  }

  /**
   * Get all records awaiting dual-condition verification.
   */
  getPendingVerification(): EscrowRecord[] {
    return this.getByStatus('PENDING_VERIFICATION');
  }

  /**
   * Get all records where dual-condition is met but EscrowFinish not yet submitted.
   */
  getDualConditionMet(): EscrowRecord[] {
    return this.getByStatus('DUAL_CONDITION_MET');
  }

  /**
   * Find records that are expired (past CancelAfter) but not yet cancelled.
   */
  getExpiredUncancelled(): EscrowRecord[] {
    const now = new Date();
    return Object.values(this.store.records).filter((r) => {
      if (r.status === 'RELEASED' || r.status === 'CANCELLED' || r.status === 'EXPIRED') {
        return false;
      }
      return new Date(r.cancelAfter) < now;
    });
  }

  /**
   * Get all records. Returns a copy to prevent mutation.
   */
  getAll(): EscrowRecord[] {
    return Object.values(this.store.records);
  }

  /**
   * Total count of records.
   */
  count(): number {
    return Object.keys(this.store.records).length;
  }

  /**
   * Summary stats for monitoring.
   */
  getSummary(): Record<EscrowStatus, number> {
    const summary: Record<string, number> = {
      FUNDED: 0,
      PENDING_VERIFICATION: 0,
      DUAL_CONDITION_MET: 0,
      RELEASED: 0,
      CANCELLED: 0,
      EXPIRED: 0,
    };
    for (const record of Object.values(this.store.records)) {
      summary[record.status] = (summary[record.status] || 0) + 1;
    }
    return summary as Record<EscrowStatus, number>;
  }
}
