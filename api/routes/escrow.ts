/**
 * BuildChain API — Escrow Routes
 *
 * POST   /v1/escrow                           create escrow
 * GET    /v1/escrow/:drid                     get status
 * POST   /v1/escrow/:drid/finish              finish escrow
 * POST   /v1/escrow/:drid/cancel              cancel escrow
 * POST   /v1/escrow/:drid/verify-credential   mark credential verified
 * POST   /v1/escrow/:drid/verify-nft          mark NFT verified
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Wallet } from 'xrpl';
import { EscrowEngine } from '../../src/index';
import { serializeDRID } from '../../src/types';
import {
  CreateEscrowRequestBody,
  FinishEscrowRequestBody,
  CancelEscrowRequestBody,
  VerifyCredentialRequestBody,
  VerifyNftRequestBody,
} from '../types';
import {
  sendSuccess,
  sendError,
  parseDridParam,
  asyncHandler,
  validateRequired,
} from '../utils';

const router = Router();

// ─── CREATE ESCROW ───────────────────────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const engine: EscrowEngine = req.app.locals.escrowEngine;

    // Validate request body
    const body = req.body as CreateEscrowRequestBody;
    const { valid, missing } = validateRequired(body, [
      'projectId',
      'drawNumber',
      'milestoneDescription',
      'lenderAddress',
      'gcAddress',
      'amountXrp',
    ]);

    if (!valid) {
      return sendError(res, `Missing required fields: ${missing.join(', ')}`, 'INVALID_REQUEST', 400);
    }

    try {
      // Get lender wallet from environment
      const lenderSeed = process.env.LENDER_WALLET_SEED;
      if (!lenderSeed) {
        return sendError(res, 'Lender wallet not configured', 'CONFIG_ERROR', 500);
      }

      const lenderWallet = Wallet.fromSeed(lenderSeed);

      // Create escrow
      const result = await engine.createEscrow(
        {
          drid: {
            projectId: body.projectId,
            drawNumber: body.drawNumber,
            milestoneDescription: body.milestoneDescription,
          },
          parties: {
            lenderAddress: body.lenderAddress,
            gcAddress: body.gcAddress,
          },
          amountXrp: body.amountXrp,
          timeConditions: {
            finishAfter: body.finishAfterHours
              ? new Date(Date.now() + body.finishAfterHours * 60 * 60 * 1000)
              : undefined,
            cancelAfter: body.cancelAfterDays
              ? new Date(Date.now() + body.cancelAfterDays * 24 * 60 * 60 * 1000)
              : undefined,
          },
        },
        lenderWallet
      );

      if (!result.success) {
        return sendError(res, result.error || 'Failed to create escrow', 'ESCROW_CREATE_FAILED', 400);
      }

      sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  })
);

// ─── GET ESCROW STATUS ────────────────────────────────────────────────────────

router.get(
  '/:drid',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const engine: EscrowEngine = req.app.locals.escrowEngine;

    try {
      const dridString = parseDridParam(req.params.drid);
      const result = await engine.getStatus(dridString);

      sendSuccess(res, result);
    } catch (error) {
      if ((error as any).message?.includes('not found')) {
        return sendError(res, 'Escrow not found', 'NOT_FOUND', 404);
      }
      next(error);
    }
  })
);

// ─── FINISH ESCROW ───────────────────────────────────────────────────────────

router.post(
  '/:drid/finish',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const engine: EscrowEngine = req.app.locals.escrowEngine;

    const body = req.body as FinishEscrowRequestBody;
    const { valid, missing } = validateRequired(body, ['finisherAddress']);

    if (!valid) {
      return sendError(res, `Missing required fields: ${missing.join(', ')}`, 'INVALID_REQUEST', 400);
    }

    try {
      const dridString = parseDridParam(req.params.drid);

      // Get protocol wallet from environment
      const protocolSeed = process.env.PROTOCOL_WALLET_SEED;
      if (!protocolSeed) {
        return sendError(res, 'Protocol wallet not configured', 'CONFIG_ERROR', 500);
      }

      const protocolWallet = Wallet.fromSeed(protocolSeed);

      const result = await engine.finishEscrow(
        {
          dridString,
          finisherAddress: body.finisherAddress,
        },
        protocolWallet
      );

      if (!result.success) {
        return sendError(res, result.error || 'Failed to finish escrow', 'ESCROW_FINISH_FAILED', 400);
      }

      sendSuccess(res, result);
    } catch (error) {
      if ((error as any).message?.includes('not found')) {
        return sendError(res, 'Escrow not found', 'NOT_FOUND', 404);
      }
      next(error);
    }
  })
);

// ─── CANCEL ESCROW ───────────────────────────────────────────────────────────

router.post(
  '/:drid/cancel',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const engine: EscrowEngine = req.app.locals.escrowEngine;

    const body = req.body as CancelEscrowRequestBody;
    const { valid, missing } = validateRequired(body, ['reason']);

    if (!valid) {
      return sendError(res, `Missing required fields: ${missing.join(', ')}`, 'INVALID_REQUEST', 400);
    }

    // Validate reason
    const validReasons = ['EXPIRED', 'VERIFICATION_FAILED', 'LENDER_REQUESTED'];
    if (!validReasons.includes(body.reason)) {
      return sendError(
        res,
        `Invalid reason. Must be one of: ${validReasons.join(', ')}`,
        'INVALID_REQUEST',
        400
      );
    }

    try {
      const dridString = parseDridParam(req.params.drid);

      // Get canceller wallet from environment
      const cancellerSeed = process.env.CANCELLER_WALLET_SEED;
      if (!cancellerSeed) {
        return sendError(res, 'Canceller wallet not configured', 'CONFIG_ERROR', 500);
      }

      const cancellerWallet = Wallet.fromSeed(cancellerSeed);

      const result = await engine.cancelEscrow(
        {
          dridString,
          reason: body.reason as 'EXPIRED' | 'VERIFICATION_FAILED' | 'LENDER_REQUESTED',
        },
        cancellerWallet
      );

      if (!result.success) {
        return sendError(res, result.error || 'Failed to cancel escrow', 'ESCROW_CANCEL_FAILED', 400);
      }

      sendSuccess(res, result);
    } catch (error) {
      if ((error as any).message?.includes('not found')) {
        return sendError(res, 'Escrow not found', 'NOT_FOUND', 404);
      }
      next(error);
    }
  })
);

// ─── VERIFY INSPECTOR CREDENTIAL ────────────────────────────────────────────

router.post(
  '/:drid/verify-credential',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const engine: EscrowEngine = req.app.locals.escrowEngine;

    const body = req.body as VerifyCredentialRequestBody;
    const { valid, missing } = validateRequired(body, ['txHash']);

    if (!valid) {
      return sendError(res, `Missing required fields: ${missing.join(', ')}`, 'INVALID_REQUEST', 400);
    }

    try {
      const dridString = parseDridParam(req.params.drid);
      const record = engine.markInspectorCredentialVerified(dridString, body.txHash);

      sendSuccess(res, {
        success: true,
        dridString,
        record,
        message: 'Inspector credential marked as verified',
      });
    } catch (error) {
      if ((error as any).message?.includes('not found')) {
        return sendError(res, 'Escrow not found', 'NOT_FOUND', 404);
      }
      next(error);
    }
  })
);

// ─── VERIFY LIEN WAIVER NFT ──────────────────────────────────────────────────

router.post(
  '/:drid/verify-nft',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const engine: EscrowEngine = req.app.locals.escrowEngine;

    const body = req.body as VerifyNftRequestBody;
    const { valid, missing } = validateRequired(body, ['txHash']);

    if (!valid) {
      return sendError(res, `Missing required fields: ${missing.join(', ')}`, 'INVALID_REQUEST', 400);
    }

    try {
      const dridString = parseDridParam(req.params.drid);
      const record = engine.markLienWaiverNftVerified(dridString, body.txHash);

      sendSuccess(res, {
        success: true,
        dridString,
        record,
        message: 'Lien waiver NFT marked as verified',
      });
    } catch (error) {
      if ((error as any).message?.includes('not found')) {
        return sendError(res, 'Escrow not found', 'NOT_FOUND', 404);
      }
      next(error);
    }
  })
);

export default router;
