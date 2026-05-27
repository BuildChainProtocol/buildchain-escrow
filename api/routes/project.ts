/**
 * BuildChain API — Project Routes
 *
 * GET    /v1/project/:projectId/dashboard     full project dashboard JSON
 * GET    /v1/project/:projectId/audit         all audit trails JSON
 * GET    /v1/project/:projectId/escrows       list all escrows for project
 */

import { Router, Request, Response, NextFunction } from 'express';
import { EscrowEngine } from '../../src/index';
import { AuditEngine } from '../../src/audit';
import { sendSuccess, sendError, asyncHandler, validateRequired } from '../utils';

const router = Router();

// ─── GET PROJECT DASHBOARD ───────────────────────────────────────────────────

router.get(
  '/:projectId/dashboard',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const escrowEngine: EscrowEngine = req.app.locals.escrowEngine;
    const auditEngine: AuditEngine = req.app.locals.auditEngine;

    try {
      const { projectId } = req.params;

      if (!projectId) {
        return sendError(res, 'projectId is required', 'INVALID_REQUEST', 400);
      }

      const dashboard = auditEngine.getDashboard(projectId);

      sendSuccess(res, dashboard);
    } catch (error) {
      if ((error as any).message?.includes('not found')) {
        return sendError(res, 'Project not found', 'NOT_FOUND', 404);
      }
      next(error);
    }
  })
);

// ─── GET ALL AUDIT TRAILS FOR PROJECT ────────────────────────────────────────

router.get(
  '/:projectId/audit',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const escrowEngine: EscrowEngine = req.app.locals.escrowEngine;
    const auditEngine: AuditEngine = req.app.locals.auditEngine;

    try {
      const { projectId } = req.params;

      if (!projectId) {
        return sendError(res, 'projectId is required', 'INVALID_REQUEST', 400);
      }

      // Get all escrows for project
      const records = escrowEngine.getByProject(projectId);

      if (records.length === 0) {
        return sendSuccess(res, {
          projectId,
          trails: [],
          message: 'No escrows found for this project',
        });
      }

      // Build audit trails for each
      const trails = records.map(record => auditEngine.getTrail(record.drid));

      sendSuccess(res, {
        projectId,
        totalDraws: trails.length,
        trails,
      });
    } catch (error) {
      if ((error as any).message?.includes('not found')) {
        return sendError(res, 'Project not found', 'NOT_FOUND', 404);
      }
      next(error);
    }
  })
);

// ─── LIST ALL ESCROWS FOR PROJECT ────────────────────────────────────────────

router.get(
  '/:projectId/escrows',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const escrowEngine: EscrowEngine = req.app.locals.escrowEngine;

    try {
      const { projectId } = req.params;

      if (!projectId) {
        return sendError(res, 'projectId is required', 'INVALID_REQUEST', 400);
      }

      const records = escrowEngine.getByProject(projectId);

      sendSuccess(res, {
        projectId,
        totalEscrows: records.length,
        escrows: records.map(record => ({
          drid: record.drid,
          drawNumber: record.drawNumber,
          milestoneDescription: record.milestoneDescription,
          status: record.status,
          amountXrp: record.amountXrp,
          lenderAddress: record.lenderAddress,
          gcAddress: record.gcAddress,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          verificationConditions: record.verificationConditions,
        })),
      });
    } catch (error) {
      next(error);
    }
  })
);

export default router;
