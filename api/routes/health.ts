/**
 * BuildChain API — Health & Info Routes
 *
 * GET    /health                              { status, network, connected, timestamp }
 * GET    /v1/registry/summary                 registry summary stats
 */

import { Router, Request, Response, NextFunction } from 'express';
import { EscrowEngine } from '../../src/index';
import { getConfig } from '../../src/config/network';
import { sendSuccess, sendError, asyncHandler } from '../utils';
import { HealthResponse, RegistrySummary } from '../types';

const router = Router();

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

router.get(
  '/health',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const engine = req.app.locals.escrowEngine as EscrowEngine;
      const config = getConfig();

      const response: HealthResponse = {
        status: engine && engine.connected ? 'ok' : 'degraded',
        network: config.network,
        connected: engine ? engine.connected : false,
        timestamp: new Date().toISOString(),
      };

      const statusCode = response.status === 'ok' ? 200 : 503;
      sendSuccess(res, response, statusCode);
    } catch (error) {
      next(error);
    }
  })
);

// Alias for GET /health
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const engine = req.app.locals.escrowEngine as EscrowEngine;
      const config = getConfig();

      const response: HealthResponse = {
        status: engine && engine.connected ? 'ok' : 'degraded',
        network: config.network,
        connected: engine ? engine.connected : false,
        timestamp: new Date().toISOString(),
      };

      const statusCode = response.status === 'ok' ? 200 : 503;
      sendSuccess(res, response, statusCode);
    } catch (error) {
      next(error);
    }
  })
);

// ─── REGISTRY SUMMARY ────────────────────────────────────────────────────────

router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const engine = req.app.locals.escrowEngine as EscrowEngine;

      if (!engine) {
        return sendError(res, 'Engine not initialized', 'SERVICE_UNAVAILABLE', 503);
      }

      // Get all records to calculate summary
      const byStatusFunded = engine.getByStatus('FUNDED');
      const byStatusPendingVerification = engine.getByStatus('PENDING_VERIFICATION');
      const byStatusDualConditionMet = engine.getByStatus('DUAL_CONDITION_MET');
      const byStatusReleased = engine.getByStatus('RELEASED');
      const byStatusCancelled = engine.getByStatus('CANCELLED');
      const byStatusExpired = engine.getByStatus('EXPIRED');

      const allRecords = [
        ...byStatusFunded,
        ...byStatusPendingVerification,
        ...byStatusDualConditionMet,
        ...byStatusReleased,
        ...byStatusCancelled,
        ...byStatusExpired,
      ];

      // Calculate total XRP
      const totalValueXrp = allRecords
        .reduce((sum, record) => {
          const xrp = parseFloat(record.amountXrp || '0');
          return sum + xrp;
        }, 0)
        .toFixed(6);

      // Get unique projects
      const projectIds = new Set(allRecords.map(r => r.projectId));

      const summary: RegistrySummary = {
        totalEscrows: allRecords.length,
        totalProjects: projectIds.size,
        byStatus: {
          FUNDED: byStatusFunded.length,
          PENDING_VERIFICATION: byStatusPendingVerification.length,
          DUAL_CONDITION_MET: byStatusDualConditionMet.length,
          RELEASED: byStatusReleased.length,
          CANCELLED: byStatusCancelled.length,
          EXPIRED: byStatusExpired.length,
        },
        totalValueXrp,
        timestamp: new Date().toISOString(),
      };

      sendSuccess(res, summary);
    } catch (error) {
      next(error);
    }
  })
);

export default router;
