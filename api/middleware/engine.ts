/**
 * BuildChain API — Engine Middleware
 *
 * Initializes EscrowEngine and AuditEngine singletons.
 * Ensures XRPL client is connected before handling requests.
 * Attaches instances to req.app.locals for access in routes.
 */

import { Request, Response, NextFunction } from 'express';
import { EscrowEngine } from '../../src/index';
import { AuditEngine } from '../../src/audit';
import { Client } from 'xrpl';

let escrowEngine: EscrowEngine | null = null;
let auditEngine: AuditEngine | null = null;
let isConnecting = false;

const initializeEngines = async (): Promise<void> => {
  if (escrowEngine && escrowEngine.connected) {
    return; // Already initialized and connected
  }

  if (isConnecting) {
    // Wait for ongoing connection attempt
    let attempts = 0;
    while (isConnecting && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    return;
  }

  isConnecting = true;

  try {
    // Create engines if not already created
    if (!escrowEngine) {
      const registryPath = process.env.REGISTRY_PATH || './registry.json';
      escrowEngine = new EscrowEngine(registryPath);
    }

    if (!auditEngine) {
      const network = (process.env.XRPL_NETWORK as 'testnet' | 'mainnet') || 'testnet';
      if (!escrowEngine.getRecord) {
        throw new Error('EscrowEngine not properly initialized');
      }
      // Access registry through escrow engine
      auditEngine = new AuditEngine(
        (escrowEngine as any).registry,
        network
      );
    }

    // Connect if not already connected
    if (!escrowEngine.connected) {
      await escrowEngine.connect();
    }

    console.log('[ENGINE] EscrowEngine and AuditEngine initialized and connected');
  } catch (error) {
    console.error('[ENGINE] Initialization error:', error);
    throw error;
  } finally {
    isConnecting = false;
  }
};

const engineMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Initialize engines if needed
    if (!escrowEngine || !escrowEngine.connected) {
      await initializeEngines();
    }

    // Attach to request for use in routes
    if (!req.app.locals.escrowEngine) {
      req.app.locals.escrowEngine = escrowEngine;
      req.app.locals.auditEngine = auditEngine;
    }

    next();
  } catch (error) {
    console.error('[ENGINE] Connection error:', error);
    res.status(503).json({
      success: false,
      error: 'Service unavailable — unable to connect to XRPL',
      code: 'SERVICE_UNAVAILABLE',
      details: {
        message: (error as any).message,
      },
      timestamp: new Date().toISOString(),
    });
  }
};

// Graceful cleanup on exit
process.on('SIGTERM', async () => {
  console.log('[ENGINE] Disconnecting...');
  if (escrowEngine && escrowEngine.connected) {
    await escrowEngine.disconnect();
  }
});

export default engineMiddleware;

// Helper to get engines
export const getEngines = () => {
  if (!escrowEngine || !auditEngine) {
    throw new Error('Engines not initialized');
  }
  return { escrowEngine, auditEngine };
};
