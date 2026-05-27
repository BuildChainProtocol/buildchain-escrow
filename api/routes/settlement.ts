/**
 * BuildChain API — Settlement Routes
 *
 * POST   /v1/settlement/quote                 get DEX quote (XRP→RLUSD)
 * POST   /v1/settlement/transfer              direct RLUSD transfer
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Client, Wallet } from 'xrpl';
import { getClient } from '../../src/config/network';
import { SettlementEngine } from '../../src/settlement';
import {
  DexQuoteRequestBody,
  TransferRlusdRequestBody,
} from '../types';
import { sendSuccess, sendError, asyncHandler, validateRequired } from '../utils';

const router = Router();

// Get settlement engine instance
const getSettlementEngine = (): SettlementEngine => {
  const rlusdIssuer = process.env.RLUSD_ISSUER_ADDRESS;
  if (!rlusdIssuer) {
    throw new Error('RLUSD_ISSUER_ADDRESS not configured');
  }

  const client = getClient();
  return new SettlementEngine(client, rlusdIssuer);
};

// ─── GET DEX QUOTE ───────────────────────────────────────────────────────────

router.post(
  '/quote',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as DexQuoteRequestBody;
    const { valid, missing } = validateRequired(body, ['gcAddress', 'xrpDrops']);

    if (!valid) {
      return sendError(res, `Missing required fields: ${missing.join(', ')}`, 'INVALID_REQUEST', 400);
    }

    try {
      const settlement = getSettlementEngine();
      const quote = await settlement.getSwapQuote(
        body.gcAddress,
        body.xrpDrops,
        body.slippage || 0.01
      );

      if (!quote) {
        return sendError(
          res,
          'Unable to get quote from DEX',
          'DEX_QUOTE_ERROR',
          400
        );
      }

      sendSuccess(res, {
        quote,
        params: {
          gcAddress: body.gcAddress,
          xrpDrops: body.xrpDrops,
          slippage: body.slippage || 0.01,
        },
      });
    } catch (error) {
      next(error);
    }
  })
);

// ─── TRANSFER RLUSD DIRECTLY ─────────────────────────────────────────────────

router.post(
  '/transfer',
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as TransferRlusdRequestBody;
    const { valid, missing } = validateRequired(body, [
      'dridString',
      'rlusdAmount',
      'senderAddress',
      'receiverAddress',
    ]);

    if (!valid) {
      return sendError(res, `Missing required fields: ${missing.join(', ')}`, 'INVALID_REQUEST', 400);
    }

    try {
      // Get sender wallet from environment
      const senderSeed = process.env.LENDER_WALLET_SEED;
      if (!senderSeed) {
        return sendError(res, 'Sender wallet not configured', 'CONFIG_ERROR', 500);
      }

      const senderWallet = Wallet.fromSeed(senderSeed);
      const settlement = getSettlementEngine();

      const result = await settlement.transferRlusd(senderWallet, {
        dridString: body.dridString,
        rlusdAmount: body.rlusdAmount,
        senderAddress: body.senderAddress,
        receiverAddress: body.receiverAddress,
      });

      if (!result.success) {
        return sendError(
          res,
          result.error || 'Failed to transfer RLUSD',
          'SETTLEMENT_TRANSFER_FAILED',
          400
        );
      }

      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  })
);

export default router;
