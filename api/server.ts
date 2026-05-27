/**
 * BuildChain Protocol — REST API Server
 *
 * Main Express.js entry point for the 6-module TypeScript system.
 * Provides RESTful endpoints for escrow, settlement, auditing, and health checks.
 *
 * PATENT PENDING — Docket BLDCHN-001-P
 * © BuildChain Protocol, Inc. — CONFIDENTIAL
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import authMiddleware from './middleware/auth';
import engineMiddleware from './middleware/engine';
import escrowRoutes from './routes/escrow';
import projectRoutes from './routes/project';
import settlementRoutes from './routes/settlement';
import healthRoutes from './routes/health';
import { API_VERSION } from './types';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ApiError {
  success: false;
  error: string;
  code: string;
  details?: any;
  timestamp: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  timestamp: string;
}

// ─── SERVER SETUP ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

const app: Express = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Custom middleware to add timestamp to all responses
app.use((req: Request, res: Response, next: NextFunction) => {
  res.locals.timestamp = new Date().toISOString();
  next();
});

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// Health check (no auth required)
app.use('/health', healthRoutes);

// Engine middleware (initializes escrow & audit engines)
app.use(engineMiddleware);

// API key authentication (optional in dev mode)
app.use('/v1/', authMiddleware);

// API routes
app.use('/v1/escrow', escrowRoutes);
app.use('/v1/project', projectRoutes);
app.use('/v1/settlement', settlementRoutes);
app.use('/v1/registry', healthRoutes); // Registry summary is under /v1/registry/summary

// OpenAPI spec
app.get('/api/openapi.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  // In a real app, load from openapi.yaml
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'BuildChain Protocol REST API',
      version: API_VERSION,
      description: 'RESTful API for 6-module BuildChain escrow system',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
      { url: 'https://api.buildchain.io', description: 'Production' },
    ],
  });
});

// ─── ERROR HANDLING ──────────────────────────────────────────────────────────

// 404 Not Found
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    code: 'NOT_FOUND',
    timestamp: res.locals.timestamp,
  } as ApiError);
});

// Global error handler
app.use(
  (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[ERROR]', err.message);

    let statusCode = err.statusCode || 500;
    let errorCode = err.code || 'INTERNAL_ERROR';
    let errorMessage = err.message || 'Internal server error';

    // Handle known error types
    if (err.message?.includes('not found')) {
      statusCode = 404;
      errorCode = 'NOT_FOUND';
    } else if (err.message?.includes('Invalid') || err.message?.includes('invalid')) {
      statusCode = 400;
      errorCode = 'INVALID_REQUEST';
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: errorCode,
      details: NODE_ENV === 'development' ? { stack: err.stack } : undefined,
      timestamp: res.locals.timestamp,
    } as ApiError);
  }
);

// ─── GRACEFUL SHUTDOWN ───────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log('\n' + '='.repeat(70));
  console.log('🏗️  BuildChain Protocol — REST API Server');
  console.log('='.repeat(70));
  console.log(`Server running on port ${PORT} (${NODE_ENV})`);
  console.log(`API Version: ${API_VERSION}`);
  console.log(`OpenAPI spec: GET /api/openapi.json`);
  console.log('\nEndpoints:');
  console.log('  Health:');
  console.log('    GET  /health');
  console.log('    GET  /v1/registry/summary');
  console.log('\n  Escrow:');
  console.log('    POST   /v1/escrow');
  console.log('    GET    /v1/escrow/:drid');
  console.log('    POST   /v1/escrow/:drid/finish');
  console.log('    POST   /v1/escrow/:drid/cancel');
  console.log('    POST   /v1/escrow/:drid/verify-credential');
  console.log('    POST   /v1/escrow/:drid/verify-nft');
  console.log('\n  Project:');
  console.log('    GET    /v1/project/:projectId/dashboard');
  console.log('    GET    /v1/project/:projectId/audit');
  console.log('    GET    /v1/project/:projectId/escrows');
  console.log('\n  Settlement:');
  console.log('    POST   /v1/settlement/quote');
  console.log('    POST   /v1/settlement/transfer');
  console.log('='.repeat(70) + '\n');
});

// Handle termination signals
const shutdown = async () => {
  console.log('\n[SHUTDOWN] Received termination signal');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
