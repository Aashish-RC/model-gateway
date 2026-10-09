export type VirtualKeyStatus = 'active' | 'revoked' | 'exhausted';

export interface VirtualKey {
  id: string;
  key: string;
  name: string;
  rpmLimit: number;
  tpmLimit: number;
  maxBudgetUsd?: number;
  currentSpendUsd: number;
  allowedModels: string[];
  status: VirtualKeyStatus;
  createdAt: string;
  lastUsedAt?: string;
}

export interface VirtualKeyView {
  id: string;
  name: string;
  maskedKey: string;
  rpmLimit: number;
  tpmLimit: number;
  currentRpm: number;
  currentTpm: number;
  maxBudgetUsd?: number;
  currentSpendUsd: number;
  budgetPercentage?: number;
  allowedModels: string[];
  status: VirtualKeyStatus;
  createdAt: string;
  lastUsedAt?: string;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?:
    | 'rpm_limit_exceeded'
    | 'tpm_limit_exceeded'
    | 'budget_exceeded'
    | 'model_not_allowed'
    | 'key_revoked'
    | 'key_not_found';
  retryAfterSeconds: number;
  limitRequests: number;
  remainingRequests: number;
  limitTokens: number;
  remainingTokens: number;
  resetSeconds: number;
}

export interface CreateVirtualKeyParams {
  name: string;
  rpmLimit?: number;
  tpmLimit?: number;
  maxBudgetUsd?: number;
  allowedModels?: string[];
  customKey?: string;
}

export interface UpdateVirtualKeyParams {
  name?: string;
  rpmLimit?: number;
  tpmLimit?: number;
  maxBudgetUsd?: number;
  allowedModels?: string[];
  status?: VirtualKeyStatus;
}
