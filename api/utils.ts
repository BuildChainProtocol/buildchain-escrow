/**
 * BuildChain API — Utility Functions
 */

import { Response } from 'express';
import { ApiResponse, ApiError } from './types';

/**
 * Send a successful API response
 */
export const sendSuccess = <T = any>(
  res: Response,
  data: T,
  statusCode: number = 200
): Response => {
  return res.status(statusCode).json({
    success: true,
    data,
    timestamp: res.locals.timestamp,
  } as ApiResponse<T>);
};

/**
 * Send an error API response
 */
export const sendError = (
  res: Response,
  message: string,
  code: string,
  statusCode: number = 400,
  details?: any
): Response => {
  return res.status(statusCode).json({
    success: false,
    error: message,
    code,
    details,
    timestamp: res.locals.timestamp,
  } as ApiError);
};

/**
 * Parse and validate a DRID string from URL params
 * Expects URL-encoded format: PROJECT%3Adraw1 (colon is %3A)
 */
export const parseDridParam = (dridParam: string): string => {
  // Decode URL-encoded colons
  const dridString = decodeURIComponent(dridParam);

  // Validate format: projectId:drawN
  const parts = dridString.split(':');
  if (parts.length !== 2 || !parts[1].startsWith('draw')) {
    throw new Error('Invalid DRID format. Expected: projectId:drawN');
  }

  return dridString;
};

/**
 * Encode a DRID string for use in URLs
 * Converts colons to %3A for URL safety
 */
export const encodeDrid = (dridString: string): string => {
  return encodeURIComponent(dridString);
};

/**
 * Validate required fields in a request body
 */
export const validateRequired = (
  body: Record<string, any>,
  fields: string[]
): { valid: boolean; missing: string[] } => {
  const missing = fields.filter(field => !body[field]);
  return {
    valid: missing.length === 0,
    missing,
  };
};

/**
 * Safe async route handler wrapper
 * Catches and forwards errors to the error middleware
 */
export const asyncHandler = (
  fn: (req: any, res: any, next: any) => Promise<any>
) => {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Format XRP drops as human-readable XRP
 */
export const dropsToXrp = (drops: string): string => {
  const xrp = parseInt(drops, 10) / 1_000_000;
  return xrp.toFixed(6);
};

/**
 * Format XRP as drops
 */
export const xrpToDrops = (xrp: number): string => {
  return Math.floor(xrp * 1_000_000).toString();
};
