/**
 * BuildChain Protocol API — Shared Types
 */

export const API_VERSION = '1.0.0';

// Re-export key types from main module
export {
  DrawRequestId,
  DRIDString,
  EscrowStatus,
  EscrowRecord,
  EscrowParties,
  EscrowTimeConditions,
  VerificationConditions,
  CreateEscrowInput,
  CreateEscrowResult,
  FinishEscrowInput,
  FinishEscrowResult,
  CancelEscrowInput,
  CancelEscrowResult,
  EscrowStatusResult,
} from '../src/types';

export {
  AuditTrail,
  DrawSummary,
  ProjectDashboard,
  AuditEvent,
  AuditEventType,
} from '../src/audit/types';

export {
  DexSwapInput,
  DexSwapResult,
  DirectTransferInput,
  DirectTransferResult,
  DexQuote,
  TrustLineStatus,
} from '../src/settlement/types';

// API-specific types
export interface ApiResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiError {
  success: false;
  error: string;
  code: string;
  details?: any;
  timestamp: string;
}

export type ApiReply<T = any> = ApiResponse<T> | ApiError;

// Escrow API request/response bodies
export interface CreateEscrowRequestBody {
  projectId: string;
  drawNumber: number;
  milestoneDescription: string;
  lenderAddress: string;
  gcAddress: string;
  amountXrp: number;
  finishAfterHours?: number;
  cancelAfterDays?: number;
}

export interface FinishEscrowRequestBody {
  finisherAddress: string;
}

export interface CancelEscrowRequestBody {
  reason: 'EXPIRED' | 'VERIFICATION_FAILED' | 'LENDER_REQUESTED';
}

export interface VerifyCredentialRequestBody {
  txHash: string;
}

export interface VerifyNftRequestBody {
  txHash: string;
}

// Settlement API request/response bodies
export interface DexQuoteRequestBody {
  gcAddress: string;
  xrpDrops: string;
  slippage?: number;
}

export interface TransferRlusdRequestBody {
  dridString: string;
  rlusdAmount: string;
  senderAddress: string;
  receiverAddress: string;
}

// Health check response
export interface HealthResponse {
  status: 'ok' | 'degraded';
  network: 'testnet' | 'mainnet';
  connected: boolean;
  timestamp: string;
}

// Registry summary
export interface RegistrySummary {
  totalEscrows: number;
  totalProjects: number;
  byStatus: Record<string, number>;
  totalValueXrp: string;
  timestamp: string;
}
