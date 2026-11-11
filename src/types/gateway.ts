/**
 * Types for FreeAIModel API Gateway & Dashboard
 */

export type UserRole = 'user' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  freeCreditsAllocated: number; // e.g. 50_000_000_000 ($50 Billion)
  freeCreditsSpent: number;
  totalRequests: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export type KeyStatus = 'active' | 'revoked';

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  key: string; // full key sk-gateway-...
  keyPrefix: string; // sk-gate...7x9a
  status: KeyStatus;
  totalRequests: number;
  totalTokens: number;
  createdAt: string;
  lastUsedAt?: string;
}

export type ProviderType = 
  | 'groq' 
  | 'openai' 
  | 'gemini' 
  | 'openrouter' 
  | 'deepseek' 
  | 'mistral' 
  | 'cerebras' 
  | 'custom';

export type ProviderKeyStatus = 'active' | 'rate_limited' | 'exhausted' | 'disabled';

export interface ProviderKey {
  id: string;
  provider: ProviderType;
  key: string;
  keyHint: string; // e.g. gsk_...89ab
  status: ProviderKeyStatus;
  supportedModels?: string[];
  requestCount: number;
  errorCount: number;
  lastError?: string;
  cooldownUntil?: number; // timestamp in ms
  createdAt: string;
  updatedAt: string;
}

export interface GatewayModel {
  id: string;
  name: string;
  provider: ProviderType;
  contextWindow?: number;
  pricingPrompt?: number; // per 1k tokens in USD
  pricingCompletion?: number; // per 1k tokens in USD
  activeKeysCount?: number;
  discoveredAt: string;
  description?: string;
}

export interface RequestLog {
  id: string;
  userId: string;
  apiKeyId?: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  status: number;
  timestamp: string;
  failoverAttempts?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  gateway_meta?: {
    provider_used: string;
    failover_count: number;
    latency_ms: number;
    cost_usd: number;
  };
}
