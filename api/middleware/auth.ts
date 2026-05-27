/**
 * BuildChain API — Authentication Middleware
 *
 * Validates X-API-Key header against BUILDCHAIN_API_KEY environment variable.
 * Skips validation in development mode if API key is not set.
 */

import { Request, Response, NextFunction } from 'express';

const API_KEY = process.env.BUILDCHAIN_API_KEY;
const NODE_ENV = process.env.NODE_ENV || 'development';

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip auth in dev mode if no API key is configured
  if (!API_KEY) {
    if (NODE_ENV === 'development') {
      console.warn('[AUTH] API key not set — skipping authentication (dev mode)');
      return next();
    }
    return res.status(500).json({
      success: false,
      error: 'API key not configured',
      code: 'CONFIG_ERROR',
      timestamp: new Date().toISOString(),
    });
  }

  // Check X-API-Key header
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Missing X-API-Key header',
      code: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
  }

  if (apiKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      code: 'UNAUTHORIZED',
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

export default authMiddleware;
