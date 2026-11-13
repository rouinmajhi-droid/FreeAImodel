import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export const gatewayApp = express();
gatewayApp.use(cors());
gatewayApp.use(express.json({ limit: '10mb' }));

export type SupportedProvider =
  | 'inception'
  | 'groq'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'deepseek'
  | 'mistral'
  | 'cerebras'
  | 'anthropic'
  | 'custom';

export interface StoredApiKey {
  id: string;
  userId: string;
  name: string;
  key: string;
  keyPrefix: string;
  status: 'active' | 'revoked';
  totalRequests: number;
  totalTokens: number;
  createdAt: string;
  lastUsedAt?: string;
}

export interface StoredProviderKey {
  id: string;
  provider: SupportedProvider;
  key: string;
  keyHint: string;
  customBaseUrl?: string;
  status: 'active' | 'rate_limited' | 'exhausted' | 'disabled';
  supportedModels: string[];
  requestCount: number;
  errorCount: number;
  lastError?: string;
  cooldownUntil?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredModel {
  id: string;
  name: string;
  provider: string;
  ownerKeyId?: string;
  ownerKeyHint?: string;
  contextWindow?: number;
  pricingPrompt?: number;
  pricingCompletion?: number;
  activeKeysCount?: number;
  discoveredAt: string;
  description?: string;
}

export interface StoredRequestLog {
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

export const PRIMARY_ADMIN_EMAIL = 'Rouinmajhi@gmail.com';
export const DAILY_FREE_CREDITS = 50_000_000_000;

export interface StoredUserAccount {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  freeCreditsAllocated: number;
  freeCreditsSpent: number;
  lastResetDate: string; // YYYY-MM-DD (UTC)
  updatedAt: string;
}

export function isPrimaryAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
}

export function getUtcTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ensureDailyCreditsReset(account: StoredUserAccount): boolean {
  const today = getUtcTodayString();
  if (account.lastResetDate !== today || account.freeCreditsAllocated < DAILY_FREE_CREDITS) {
    account.freeCreditsAllocated = DAILY_FREE_CREDITS;
    account.freeCreditsSpent = 0;
    account.lastResetDate = today;
    account.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
}

// ==========================================
// In-memory Master Stores + File Persistence Cache
// ==========================================
export const masterApiKeys = new Map<string, StoredApiKey>();
export const masterProviderKeys: StoredProviderKey[] = [];
export const masterModels = new Map<string, StoredModel>();
export const masterLogs: StoredRequestLog[] = [];
export const masterUsers = new Map<string, StoredUserAccount>();

const defaultInitialModels: StoredModel[] = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', provider: 'groq', contextWindow: 128000, pricingPrompt: 0.00059, pricingCompletion: 0.00079, discoveredAt: new Date().toISOString() },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', provider: 'groq', contextWindow: 128000, pricingPrompt: 0.00005, pricingCompletion: 0.00008, discoveredAt: new Date().toISOString() },
  { id: 'gpt-4o', name: 'GPT-4o Omnimodel', provider: 'openai', contextWindow: 128000, pricingPrompt: 0.0025, pricingCompletion: 0.010, discoveredAt: new Date().toISOString() },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextWindow: 128000, pricingPrompt: 0.00015, pricingCompletion: 0.0006, discoveredAt: new Date().toISOString() },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1048576, pricingPrompt: 0.0001, pricingCompletion: 0.0004, discoveredAt: new Date().toISOString() },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini', contextWindow: 2097152, pricingPrompt: 0.00125, pricingCompletion: 0.005, discoveredAt: new Date().toISOString() },
  { id: 'deepseek-chat', name: 'DeepSeek-V3 Chat', provider: 'deepseek', contextWindow: 64000, pricingPrompt: 0.00014, pricingCompletion: 0.00028, discoveredAt: new Date().toISOString() },
  { id: 'deepseek-reasoner', name: 'DeepSeek-R1 Reasoner', provider: 'deepseek', contextWindow: 64000, pricingPrompt: 0.00055, pricingCompletion: 0.00219, discoveredAt: new Date().toISOString() },
  { id: 'mistral-large-latest', name: 'Mistral Large 2', provider: 'mistral', contextWindow: 128000, pricingPrompt: 0.002, pricingCompletion: 0.006, discoveredAt: new Date().toISOString() },
  { id: 'mercury-coder-small', name: 'Mercury Coder Small', provider: 'inception', contextWindow: 128000, pricingPrompt: 0.0002, pricingCompletion: 0.0006, discoveredAt: new Date().toISOString() },
  { id: 'llama-3.3-70b', name: 'Cerebras Llama 3.3 70B Ultra-Fast', provider: 'cerebras', contextWindow: 8192, pricingPrompt: 0.0006, pricingCompletion: 0.0006, discoveredAt: new Date().toISOString() }
];

function getCacheFilePath(): string {
  const cwdPath = path.resolve(process.cwd(), '.gateway-cache.json');
  try {
    // Check if cwd is writable (not read-only serverless bundle)
    fs.accessSync(process.cwd(), fs.constants.W_OK);
    return cwdPath;
  } catch {
    return '/tmp/.gateway-cache.json';
  }
}

export function saveGatewayCache(): void {
  try {
    const filePath = getCacheFilePath();
    const payload = {
      apiKeys: Array.from(masterApiKeys.values()),
      providerKeys: masterProviderKeys,
      models: Array.from(masterModels.values()),
      logs: masterLogs.slice(0, 200),
      users: Array.from(masterUsers.values()),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    // Non-fatal in constrained environments
  }
}

function loadGatewayCache(): void {
  try {
    const candidates = [
      path.resolve(process.cwd(), '.gateway-cache.json'),
      '/tmp/.gateway-cache.json'
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.apiKeys)) {
          for (const k of parsed.apiKeys) {
            if (k?.key) masterApiKeys.set(k.key, k);
          }
        }
        if (Array.isArray(parsed.providerKeys)) {
          masterProviderKeys.length = 0;
          for (const pk of parsed.providerKeys) {
            if (pk?.id && pk?.key) masterProviderKeys.push(pk);
          }
        }
        if (Array.isArray(parsed.models) && parsed.models.length > 0) {
          masterModels.clear();
          for (const m of parsed.models) {
            if (m?.id) masterModels.set(m.id, m);
          }
        }
        if (Array.isArray(parsed.logs)) {
          masterLogs.length = 0;
          masterLogs.push(...parsed.logs);
        }
        if (Array.isArray(parsed.users)) {
          masterUsers.clear();
          for (const u of parsed.users) {
            if (u?.uid) masterUsers.set(u.uid, u);
          }
        }
        return;
      }
    }
  } catch {
    // Ignore parse errors
  }

  // Fallback to default showcase models if nothing persisted yet
  if (masterModels.size === 0) {
    for (const m of defaultInitialModels) {
      masterModels.set(m.id, m);
    }
  }
}

loadGatewayCache();

// Ensure initial showcase models if cache was empty
if (masterProviderKeys.length === 0 && masterModels.size === 0) {
  for (const m of defaultInitialModels) {
    masterModels.set(m.id, m);
  }
}

// ==========================================
// Provider Endpoints & URL Normalization
// ==========================================
export const PROVIDER_CONFIGS: Record<string, { baseUrl: string; chatPath: string; modelsPath: string }> = {
  inception: {
    baseUrl: 'https://api.inceptionlabs.ai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    chatPath: '/messages',
    modelsPath: '/models'
  }
};

export function normalizeBaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || !rawUrl.trim()) return undefined;
  let cleaned = rawUrl.trim().replace(/\/+$/, '');
  if (cleaned.endsWith('/chat/completions')) {
    cleaned = cleaned.slice(0, -'/chat/completions'.length);
  } else if (cleaned.endsWith('/models')) {
    cleaned = cleaned.slice(0, -'/models'.length);
  }
  return cleaned;
}

export function resolveProviderBaseUrl(provider: string, customBaseUrl?: string): string {
  const normalizedCustom = normalizeBaseUrl(customBaseUrl);
  if (normalizedCustom) return normalizedCustom;
  return PROVIDER_CONFIGS[provider]?.baseUrl || 'https://api.openai.com/v1';
}

export function formatModelDisplayName(modelId: string): string {
  return modelId
    .replace(/^models\//, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/**
 * Auto-detect provider by API key format or optional customBaseUrl
 */
export function detectProviderByKey(key: string, customBaseUrl?: string): SupportedProvider {
  if (customBaseUrl) {
    const lower = customBaseUrl.toLowerCase();
    if (lower.includes('inceptionlabs')) return 'inception';
    if (lower.includes('groq.com')) return 'groq';
    if (lower.includes('openai.com')) return 'openai';
    if (lower.includes('generativelanguage')) return 'gemini';
    if (lower.includes('openrouter.ai')) return 'openrouter';
    if (lower.includes('deepseek.com')) return 'deepseek';
    if (lower.includes('mistral.ai')) return 'mistral';
    if (lower.includes('cerebras.ai')) return 'cerebras';
    if (lower.includes('anthropic.com')) return 'anthropic';
    return 'custom';
  }

  const trimmed = key.trim();
  if (trimmed.startsWith('gsk_')) return 'groq';
  if (trimmed.startsWith('sk-or-')) return 'openrouter';
  if (trimmed.startsWith('sk-ant-')) return 'anthropic';
  if (trimmed.startsWith('csk-')) return 'cerebras';
  if (trimmed.startsWith('AIzaSy')) return 'gemini';
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-admin-')) return 'openai';
  if (trimmed.startsWith('sk-') && trimmed.length > 40) return 'openai';
  if (trimmed.startsWith('sk-') && trimmed.length <= 40) return 'deepseek';
  if (/^[a-zA-Z0-9]{32}$/.test(trimmed)) return 'mistral';
  return 'custom';
}

/**
 * Official models fallback when upstream key is demo/test/sandbox
 */
export function getStandardProviderModels(provider: string): string[] {
  switch (provider) {
    case 'inception':
      return [
        'mercury-coder-small',
        'mercury-coder-mini',
        'mercury-small'
      ];
    case 'groq':
      return [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'llama-3.2-1b-preview',
        'llama-3.2-3b-preview',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
        'deepseek-r1-distill-llama-70b'
      ];
    case 'openai':
      return [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'o1',
        'o1-mini',
        'o3-mini',
        'chatgpt-4o-latest'
      ];
    case 'gemini':
      return [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite-preview-02-05',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b'
      ];
    case 'openrouter':
      return [
        'anthropic/claude-3.5-sonnet',
        'openai/gpt-4o',
        'meta-llama/llama-3.3-70b-instruct',
        'deepseek/deepseek-r1',
        'google/gemini-2.0-flash-001'
      ];
    case 'deepseek':
      return [
        'deepseek-chat',
        'deepseek-reasoner'
      ];
    case 'mistral':
      return [
        'mistral-large-latest',
        'mistral-small-latest',
        'codestral-latest',
        'pixtral-12b-2409'
      ];
    case 'cerebras':
      return [
        'llama-3.3-70b',
        'llama-3.1-8b',
        'llama-3.1-70b'
      ];
    case 'anthropic':
      return [
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022'
      ];
    default:
      return ['custom-model-1'];
  }
}

/**
 * Rebuild masterModels map strictly from active Admin Pool Keys when keys exist
 */
export function rebuildMasterModelsFromPool(): void {
  if (masterProviderKeys.length === 0) {
    // Keep default catalog only when admin hasn't added any provider keys yet
    if (masterModels.size === 0) {
      for (const m of defaultInitialModels) {
        masterModels.set(m.id, m);
      }
    }
    return;
  }

  const nextModels = new Map<string, StoredModel>();
  const keyCounts = new Map<string, number>();

  for (const pk of masterProviderKeys) {
    if (pk.status === 'disabled') continue;
    const list = Array.isArray(pk.supportedModels) ? pk.supportedModels : [];
    for (const rawId of list) {
      const modelId = String(rawId).trim();
      if (!modelId) continue;
      keyCounts.set(modelId, (keyCounts.get(modelId) || 0) + 1);

      const existing = nextModels.get(modelId);
      const prevMeta = masterModels.get(modelId);
      nextModels.set(modelId, {
        id: modelId,
        name: prevMeta?.name || formatModelDisplayName(modelId),
        provider: pk.provider,
        ownerKeyId: existing?.ownerKeyId || pk.id,
        ownerKeyHint: existing?.ownerKeyHint || pk.keyHint,
        contextWindow: prevMeta?.contextWindow,
        pricingPrompt: prevMeta?.pricingPrompt,
        pricingCompletion: prevMeta?.pricingCompletion,
        activeKeysCount: keyCounts.get(modelId),
        discoveredAt: prevMeta?.discoveredAt || pk.updatedAt || new Date().toISOString(),
        description: prevMeta?.description
      });
    }
  }

  masterModels.clear();
  for (const [id, model] of nextModels.entries()) {
    masterModels.set(id, model);
  }
  saveGatewayCache();
}

function isTestOrSandboxKey(apiKey: string): boolean {
  const lower = apiKey.toLowerCase();
  return (
    lower.includes('test') ||
    lower.includes('demo') ||
    lower.includes('sample') ||
    lower.includes('sandbox') ||
    lower.includes('master_pool_key')
  );
}

/**
 * Fetch models directly from upstream provider GET /v1/models endpoint
 */
export async function fetchUpstreamModels(
  provider: string,
  apiKey: string,
  customBaseUrl?: string,
  ownerKeyId?: string,
  ownerKeyHint?: string
): Promise<string[]> {
  const baseUrl = resolveProviderBaseUrl(provider, customBaseUrl);
  const modelsPath = PROVIDER_CONFIGS[provider]?.modelsPath || '/models';
  const url = `${baseUrl}${modelsPath}`;

  const headers: Record<string, string> = {
    'User-Agent': 'FreeAIModel-Gateway/1.0',
    'Accept': 'application/json'
  };

  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (isTestOrSandboxKey(apiKey)) {
        const fallback = getStandardProviderModels(provider);
        for (const modelId of fallback) {
          masterModels.set(modelId, {
            id: modelId,
            name: formatModelDisplayName(modelId),
            provider,
            ownerKeyId,
            ownerKeyHint,
            discoveredAt: new Date().toISOString()
          });
        }
        return fallback;
      }
      throw new Error(`Upstream ${provider} (${url}) returned HTTP ${response.status}: ${errorText.slice(0, 180)}`);
    }

    const json: any = await response.json();
    const rawItems: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json)
      ? json
      : [];

    const models: string[] = [];
    for (const item of rawItems) {
      const rawId = typeof item === 'string' ? item : item?.id || item?.name;
      if (rawId && typeof rawId === 'string') {
        const cleanId = rawId.replace(/^models\//, '');
        models.push(cleanId);
        masterModels.set(cleanId, {
          id: cleanId,
          name: item?.display_name || item?.name || formatModelDisplayName(cleanId),
          provider,
          ownerKeyId,
          ownerKeyHint,
          contextWindow: item?.context_length || item?.context_window || item?.input_token_limit,
          discoveredAt: new Date().toISOString()
        });
      }
    }

    return models;
  } catch (err: any) {
    if (isTestOrSandboxKey(apiKey)) {
      const fallback = getStandardProviderModels(provider);
      for (const modelId of fallback) {
        masterModels.set(modelId, {
          id: modelId,
          name: formatModelDisplayName(modelId),
          provider,
          ownerKeyId,
          ownerKeyHint,
          discoveredAt: new Date().toISOString()
        });
      }
      return fallback;
    }
    throw err;
  }
}

// ==========================================
// Middleware: User Gateway API Key Validation
// ==========================================
export async function validateGatewayKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        message: 'Missing or malformed Authorization header. Expected "Authorization: Bearer sk-gateway-..."',
        type: 'invalid_request_error',
        code: 'missing_api_key'
      }
    });
    return;
  }

  const apiKeyToken = authHeader.substring(7).trim();
  if (!apiKeyToken.startsWith('sk-gateway-') || apiKeyToken.length < 16) {
    res.status(401).json({
      error: {
        message: 'Invalid API key format. FreeAIModel keys begin with "sk-gateway-".',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
    return;
  }

  let matchedKey = masterApiKeys.get(apiKeyToken);

  if (!matchedKey) {
    matchedKey = {
      id: 'key_' + apiKeyToken.slice(-8),
      userId: 'usr_default',
      name: 'Gateway Key',
      key: apiKeyToken,
      keyPrefix: apiKeyToken.slice(0, 11) + '...' + apiKeyToken.slice(-4),
      status: 'active',
      totalRequests: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString()
    };
    masterApiKeys.set(apiKeyToken, matchedKey);
    saveGatewayCache();
  }

  if (matchedKey.status !== 'active') {
    res.status(403).json({
      error: {
        message: 'Your FreeAIModel API key has been revoked or suspended.',
        type: 'permission_denied',
        code: 'key_revoked'
      }
    });
    return;
  }

  (req as any).gatewayKey = matchedKey;
  next();
}

// Helper to build strict OpenAI models list response
function buildOpenAiModelsList() {
  const createdTs = Math.floor(Date.now() / 1000) - 86400;
  return {
    object: 'list',
    data: Array.from(masterModels.values()).map(m => ({
      id: m.id,
      object: 'model',
      created: m.discoveredAt ? Math.floor(new Date(m.discoveredAt).getTime() / 1000) || createdTs : createdTs,
      owned_by: 'freeaimodel',
      provider: m.provider,
      name: m.name || formatModelDisplayName(m.id),
      permission: [{
        id: `modelperm-${m.id}`,
        object: 'model_permission',
        created: createdTs,
        allow_create_engine: false,
        allow_sampling: true,
        allow_logprobs: true,
        allow_search_indices: false,
        allow_view: true,
        allow_fine_tuning: false,
        organization: '*',
        group: null,
        is_blocking: false
      }],
      root: m.id,
      parent: null
    }))
  };
}

// ==========================================
// Public / Frontend Dashboard Model Catalog Endpoint
// ==========================================
gatewayApp.get('/api/models', (req: Request, res: Response) => {
  res.json(buildOpenAiModelsList());
});

// ==========================================
// Route: GET /v1/models (Authenticated OpenAI-compatible)
// ==========================================
gatewayApp.get('/v1/models', validateGatewayKey, (req: Request, res: Response) => {
  res.json(buildOpenAiModelsList());
});

gatewayApp.get('/models', validateGatewayKey, (req: Request, res: Response) => {
  res.json(buildOpenAiModelsList());
});

// ==========================================
// Route: POST /v1/chat/completions (OpenAI-compatible Universal Router)
// ==========================================
const handleChatCompletions = async (req: Request, res: Response) => {
  const startTime = Date.now();
  const apiKeyRecord: StoredApiKey = (req as any).gatewayKey;
  const {
    model,
    messages,
    stream,
    temperature,
    max_tokens,
    top_p,
    stop,
    presence_penalty,
    frequency_penalty,
    tools,
    tool_choice,
    response_format
  } = req.body;

  if (!model) {
    res.status(400).json({
      error: {
        message: 'Missing "model" parameter in chat completion payload.',
        type: 'invalid_request_error',
        code: 'model_missing'
      }
    });
    return;
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      error: {
        message: 'Missing or empty "messages" array in request body.',
        type: 'invalid_request_error',
        code: 'messages_missing'
      }
    });
    return;
  }

  const now = Date.now();
  const availableKeys = masterProviderKeys.filter(k => {
    if (k.status === 'disabled') return false;
    if (k.status === 'rate_limited' && k.cooldownUntil && k.cooldownUntil > now) return false;
    return true;
  });

  const modelRecord = masterModels.get(model);
  const modelProvider = modelRecord?.provider;

  // Match keys that own or support this requested model:
  // 1. Explicit supportedModels match OR ownerKeyId match
  // 2. Fallback to same provider as modelRecord (if modelRecord exists)
  let candidateKeys = availableKeys.filter(k => {
    const ownsModel = (Array.isArray(k.supportedModels) && k.supportedModels.includes(model)) ||
      (modelRecord?.ownerKeyId && k.id === modelRecord.ownerKeyId);
    const sameProvider = modelProvider && k.provider === modelProvider;
    return ownsModel || sameProvider;
  });

  // Sort: exact model ownership first, then lowest error count
  candidateKeys.sort((a, b) => {
    const aOwns = (a.supportedModels?.includes(model) || a.id === modelRecord?.ownerKeyId) ? 1 : 0;
    const bOwns = (b.supportedModels?.includes(model) || b.id === modelRecord?.ownerKeyId) ? 1 : 0;
    if (aOwns !== bOwns) return bOwns - aOwns;
    return (a.errorCount || 0) - (b.errorCount || 0);
  });

  let success = false;
  let failoverCount = 0;
  let lastErrorMsg = '';
  let lastErrorStatus = 502;
  let providerUsed = '';
  let promptTokens = Math.max(12, Math.round(JSON.stringify(messages).length / 4));
  let completionTokens = 0;

  for (const providerKey of candidateKeys) {
    const baseUrl = resolveProviderBaseUrl(providerKey.provider, providerKey.customBaseUrl);
    const isAnthropic = providerKey.provider === 'anthropic';
    const chatPath = isAnthropic ? '/messages' : (PROVIDER_CONFIGS[providerKey.provider]?.chatPath || '/chat/completions');
    const endpoint = `${baseUrl}${chatPath}`;

    try {
      providerKey.requestCount = (providerKey.requestCount || 0) + 1;
      providerKey.updatedAt = new Date().toISOString();

      let headers: Record<string, string>;
      let upstreamPayload: any;

      if (isAnthropic) {
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': providerKey.key,
          'anthropic-version': '2023-06-01',
          'User-Agent': 'FreeAIModel-Gateway/1.0'
        };
        const sysMsgs = messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
        const nonSysMsgs = messages.filter((m: any) => m.role !== 'system').map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }));
        upstreamPayload = {
          model,
          messages: nonSysMsgs,
          max_tokens: max_tokens ?? 2048,
          temperature: temperature ?? 0.7,
          stream: Boolean(stream)
        };
        if (sysMsgs) upstreamPayload.system = sysMsgs;
      } else {
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerKey.key}`,
          'User-Agent': 'FreeAIModel-Gateway/1.0'
        };
        upstreamPayload = {
          model,
          messages,
          stream: Boolean(stream)
        };
        if (temperature !== undefined) upstreamPayload.temperature = temperature;
        if (max_tokens !== undefined) upstreamPayload.max_tokens = max_tokens;
        if (top_p !== undefined) upstreamPayload.top_p = top_p;
        if (stop !== undefined) upstreamPayload.stop = stop;
        if (presence_penalty !== undefined) upstreamPayload.presence_penalty = presence_penalty;
        if (frequency_penalty !== undefined) upstreamPayload.frequency_penalty = frequency_penalty;
        if (tools !== undefined) upstreamPayload.tools = tools;
        if (tool_choice !== undefined) upstreamPayload.tool_choice = tool_choice;
        if (response_format !== undefined) upstreamPayload.response_format = response_format;
      }

      const upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamPayload)
      });

      if (upstreamResponse.status === 429 || upstreamResponse.status === 402) {
        failoverCount++;
        lastErrorStatus = upstreamResponse.status;
        lastErrorMsg = await upstreamResponse.text();
        providerKey.status = 'rate_limited';
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;
        providerKey.lastError = `Rate limit ${upstreamResponse.status} hit at ${new Date().toLocaleTimeString()}`;
        providerKey.cooldownUntil = Date.now() + 60000;
        continue;
      }

      if (!upstreamResponse.ok) {
        const errorBody = await upstreamResponse.text();
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;
        providerKey.lastError = `HTTP ${upstreamResponse.status}: ${errorBody.slice(0, 150)}`;
        failoverCount++;
        lastErrorStatus = upstreamResponse.status;
        lastErrorMsg = errorBody;
        continue;
      }

      // Streaming SSE
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('x-gateway-provider', providerKey.provider);
        res.setHeader('x-gateway-failover-count', String(failoverCount));

        if (upstreamResponse.body) {
          const reader = upstreamResponse.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
          }
          res.end();
          success = true;
          providerUsed = providerKey.provider;
          providerKey.status = 'active';
          break;
        }
      }

      // Non-streaming JSON
      let data: any = await upstreamResponse.json();
      providerUsed = providerKey.provider;
      providerKey.status = 'active';

      // Normalize Anthropic response into OpenAI format
      if (isAnthropic && data.content) {
        const text = Array.isArray(data.content)
          ? data.content.map((c: any) => c.text || '').join('')
          : '';
        data = {
          id: data.id || 'chatcmpl-' + Math.random().toString(36).substring(2, 10),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: data.stop_reason === 'end_turn' ? 'stop' : (data.stop_reason || 'stop')
          }],
          usage: {
            prompt_tokens: data.usage?.input_tokens || promptTokens,
            completion_tokens: data.usage?.output_tokens || Math.max(15, Math.round(text.length / 4)),
            total_tokens: (data.usage?.input_tokens || promptTokens) + (data.usage?.output_tokens || 0)
          }
        };
      }

      if (data.usage) {
        promptTokens = data.usage.prompt_tokens || promptTokens;
        completionTokens = data.usage.completion_tokens || completionTokens;
      } else {
        const content = data.choices?.[0]?.message?.content || '';
        completionTokens = Math.max(15, Math.round(content.length / 4));
      }

      data.gateway_meta = {
        provider_used: providerKey.provider,
        failover_count: failoverCount,
        latency_ms: Date.now() - startTime,
        cost_usd: (promptTokens * 0.000002) + (completionTokens * 0.000006)
      };

      res.setHeader('x-gateway-provider', providerKey.provider);
      res.setHeader('x-gateway-failover-count', String(failoverCount));
      res.json(data);
      success = true;
      break;
    } catch (err: any) {
      failoverCount++;
      providerKey.errorCount = (providerKey.errorCount || 0) + 1;
      providerKey.lastError = err.message || 'Network error';
      lastErrorMsg = err.message || 'Network error';
    }
  }

  // Fallback only if no provider keys are configured in Admin Pool yet
  if (!success && masterProviderKeys.length === 0) {
    const envGeminiKey = process.env.GEMINI_API_KEY;
    if (envGeminiKey && envGeminiKey !== 'MY_GEMINI_API_KEY') {
      try {
        const geminiEndpoint = `${PROVIDER_CONFIGS.gemini.baseUrl}${PROVIDER_CONFIGS.gemini.chatPath}`;
        const geminiModel = model.includes('gemini') ? model : 'gemini-2.0-flash';
        const geminiRes = await fetch(geminiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${envGeminiKey}`
          },
          body: JSON.stringify({
            model: geminiModel,
            messages,
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 2048,
            stream: Boolean(stream)
          })
        });

        if (geminiRes.ok) {
          if (stream && geminiRes.body) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('x-gateway-provider', 'gemini-fallback');
            const reader = geminiRes.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(decoder.decode(value, { stream: true }));
            }
            res.end();
            success = true;
            providerUsed = 'gemini-fallback';
          } else {
            const data = await geminiRes.json();
            providerUsed = 'gemini-fallback';
            const content = data.choices?.[0]?.message?.content || '';
            completionTokens = Math.max(15, Math.round(content.length / 4));
            data.gateway_meta = {
              provider_used: 'gemini-fallback',
              failover_count: failoverCount,
              latency_ms: Date.now() - startTime,
              cost_usd: 0
            };
            res.json(data);
            success = true;
          }
        }
      } catch {
        // Ignore fallback failure
      }
    }
  }

  if (!success) {
    const statusToSend = candidateKeys.length === 0 ? 404 : (lastErrorStatus >= 400 ? lastErrorStatus : 502);
    const errorMessage = candidateKeys.length === 0
      ? `No active Admin Pool provider key owns model "${model}". Add a provider key that supports "${model}" in the Admin Panel.`
      : `Upstream request for "${model}" failed after ${failoverCount} attempt(s): ${lastErrorMsg.slice(0, 220)}`;

    res.status(statusToSend).json({
      error: {
        message: errorMessage,
        type: candidateKeys.length === 0 ? 'model_not_found' : 'gateway_upstream_error',
        code: candidateKeys.length === 0 ? 'model_not_found' : 'upstream_failed',
        failover_count: failoverCount
      }
    });
    return;
  }

  // Record request telemetry
  const totalTokens = promptTokens + completionTokens;
  const cost = (promptTokens * 0.000002) + (completionTokens * 0.000006);

  apiKeyRecord.totalRequests = (apiKeyRecord.totalRequests || 0) + 1;
  apiKeyRecord.totalTokens = (apiKeyRecord.totalTokens || 0) + totalTokens;
  apiKeyRecord.lastUsedAt = new Date().toISOString();

  masterLogs.unshift({
    id: 'log_' + Math.random().toString(36).substring(2, 10),
    userId: apiKeyRecord.userId,
    apiKeyId: apiKeyRecord.id,
    model,
    provider: providerUsed,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: cost,
    latencyMs: Date.now() - startTime,
    status: 200,
    timestamp: new Date().toISOString(),
    failoverAttempts: failoverCount
  });

  if (masterLogs.length > 500) masterLogs.length = 500;

  // Deduct daily credits for user account (with automatic daily reset)
  const userAccount = masterUsers.get(apiKeyRecord.userId);
  if (userAccount) {
    ensureDailyCreditsReset(userAccount);
    userAccount.freeCreditsSpent = (userAccount.freeCreditsSpent || 0) + totalTokens;
    userAccount.updatedAt = new Date().toISOString();
  }

  saveGatewayCache();
};

gatewayApp.post('/v1/chat/completions', validateGatewayKey, handleChatCompletions);
gatewayApp.post('/chat/completions', validateGatewayKey, handleChatCompletions);

// ==========================================
// User Session, Role Verification & Daily 50B Credits Reset
// ==========================================
gatewayApp.post('/api/auth/session', (req: Request, res: Response) => {
  const { uid, email, displayName } = req.body || {};
  if (!uid || !email) {
    res.status(400).json({ error: 'uid and email are required' });
    return;
  }

  const isAdmin = isPrimaryAdminEmail(email);
  const role: 'admin' | 'user' = isAdmin ? 'admin' : 'user';
  const today = getUtcTodayString();

  let account = masterUsers.get(uid);
  if (!account) {
    account = {
      uid,
      email,
      displayName: displayName || email.split('@')[0] || 'Developer',
      role,
      freeCreditsAllocated: DAILY_FREE_CREDITS,
      freeCreditsSpent: 0,
      lastResetDate: today,
      updatedAt: new Date().toISOString()
    };
    masterUsers.set(uid, account);
  } else {
    account.email = email;
    account.displayName = displayName || account.displayName;
    account.role = role;
    ensureDailyCreditsReset(account);
  }

  saveGatewayCache();

  res.json({
    uid: account.uid,
    email: account.email,
    role: account.role,
    isAdmin,
    freeCreditsAllocated: account.freeCreditsAllocated,
    freeCreditsSpent: account.freeCreditsSpent,
    freeCreditsRemaining: Math.max(0, account.freeCreditsAllocated - account.freeCreditsSpent),
    lastResetDate: account.lastResetDate,
    resetsDaily: true,
    bannerText: '⚡ 50 Billion Free Credits Allocated — Refreshes & Resets Daily for Unlimited Developer Testing'
  });
});

gatewayApp.get('/api/user/credits', (req: Request, res: Response) => {
  const uid = String(req.query.uid || '');
  const email = String(req.query.email || '');
  const account = uid
    ? masterUsers.get(uid)
    : Array.from(masterUsers.values()).find(u => u.email.toLowerCase() === email.toLowerCase());

  if (account) {
    const resetOccurred = ensureDailyCreditsReset(account);
    if (resetOccurred) saveGatewayCache();
    res.json({
      uid: account.uid,
      role: account.role,
      isAdmin: isPrimaryAdminEmail(account.email),
      freeCreditsAllocated: account.freeCreditsAllocated,
      freeCreditsSpent: account.freeCreditsSpent,
      freeCreditsRemaining: Math.max(0, account.freeCreditsAllocated - account.freeCreditsSpent),
      lastResetDate: account.lastResetDate,
      resetsDaily: true
    });
    return;
  }

  res.json({
    role: isPrimaryAdminEmail(email) ? 'admin' : 'user',
    isAdmin: isPrimaryAdminEmail(email),
    freeCreditsAllocated: DAILY_FREE_CREDITS,
    freeCreditsSpent: 0,
    freeCreditsRemaining: DAILY_FREE_CREDITS,
    lastResetDate: getUtcTodayString(),
    resetsDaily: true
  });
});

// ==========================================
// Admin APIs: Key Pool & Dynamic Model Discovery
// ==========================================
function checkOptionalAdminHeader(req: Request, res: Response, next: NextFunction): void {
  const userEmailHeader = req.headers['x-user-email'];
  if (typeof userEmailHeader === 'string' && userEmailHeader.trim().length > 0) {
    if (!isPrimaryAdminEmail(userEmailHeader)) {
      res.status(403).json({
        error: `Access denied. Only primary administrator (${PRIMARY_ADMIN_EMAIL}) can manage the Admin Key Pool.`
      });
      return;
    }
  }
  next();
}

const handleBulkAddKeys = async (req: Request, res: Response) => {
  try {
    const { keysText, provider, customBaseUrl } = req.body;
    if (!keysText || typeof keysText !== 'string') {
      res.status(400).json({ error: 'keysText is required as a string.' });
      return;
    }

    const lines = keysText
      .split(/[\r\n,]+/)
      .map(line => line.trim())
      .filter(line => line.length > 5 && !line.startsWith('#'));

    if (lines.length === 0) {
      res.status(400).json({ error: 'No valid keys detected in input.' });
      return;
    }

    const normalizedCustomUrl = normalizeBaseUrl(customBaseUrl);
    const addedKeys: StoredProviderKey[] = [];
    const discoveredModelsSummary: Record<string, string[]> = {};

    for (const rawKey of lines) {
      const targetProvider: SupportedProvider =
        (provider && provider !== 'auto')
          ? provider
          : detectProviderByKey(rawKey, normalizedCustomUrl);

      const hint = rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : rawKey;
      const keyId = 'pk_' + Math.random().toString(36).substring(2, 11);

      const newKeyRecord: StoredProviderKey = {
        id: keyId,
        provider: targetProvider,
        key: rawKey,
        keyHint: hint,
        customBaseUrl: normalizedCustomUrl,
        status: 'active',
        supportedModels: [],
        requestCount: 0,
        errorCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Auto-fetch models from provider's /models endpoint using this key
      try {
        const models = await fetchUpstreamModels(targetProvider, rawKey, normalizedCustomUrl, keyId, hint);
        newKeyRecord.supportedModels = models;
        discoveredModelsSummary[hint] = models;
      } catch (err: any) {
        console.warn(`[FreeAIModel] Model fetch for ${hint} failed:`, err.message);
        newKeyRecord.lastError = `Model fetch: ${err.message}`;
      }

      masterProviderKeys.push(newKeyRecord);
      addedKeys.push(newKeyRecord);
    }

    rebuildMasterModelsFromPool();
    saveGatewayCache();

    res.json({
      success: true,
      message: `Successfully added ${addedKeys.length} key(s) to Master Key Pool.`,
      addedCount: addedKeys.length,
      keys: addedKeys.map(k => ({
        id: k.id,
        provider: k.provider,
        key: k.key,
        keyHint: k.keyHint,
        customBaseUrl: k.customBaseUrl,
        status: k.status,
        supportedModels: k.supportedModels,
        modelsCount: k.supportedModels?.length || 0,
        lastError: k.lastError,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt
      })),
      discoveredModelsSummary,
      models: Array.from(masterModels.values()),
      totalKeysInPool: masterProviderKeys.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

gatewayApp.post('/api/admin/bulk-add-keys', checkOptionalAdminHeader, handleBulkAddKeys);
gatewayApp.post('/api/models/add-keys', handleBulkAddKeys);

// Get current admin pool keys
gatewayApp.get('/api/admin/keys', checkOptionalAdminHeader, (req: Request, res: Response) => {
  res.json({ keys: masterProviderKeys });
});

// Toggle admin key status
gatewayApp.patch('/api/admin/keys/:id/status', checkOptionalAdminHeader, (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const target = masterProviderKeys.find(k => k.id === id);
  if (!target) {
    res.status(404).json({ error: 'Provider key not found' });
    return;
  }
  target.status = status === 'disabled' ? 'disabled' : 'active';
  target.cooldownUntil = undefined;
  target.updatedAt = new Date().toISOString();
  rebuildMasterModelsFromPool();
  saveGatewayCache();
  res.json({ success: true, key: target, models: Array.from(masterModels.values()) });
});

// Delete admin key
gatewayApp.delete('/api/admin/keys/:id', checkOptionalAdminHeader, (req: Request, res: Response) => {
  const { id } = req.params;
  const idx = masterProviderKeys.findIndex(k => k.id === id);
  if (idx >= 0) {
    masterProviderKeys.splice(idx, 1);
  }
  rebuildMasterModelsFromPool();
  saveGatewayCache();
  res.json({ success: true, models: Array.from(masterModels.values()), totalKeysInPool: masterProviderKeys.length });
});

// Refresh models across all active provider keys
gatewayApp.post('/api/models/refresh', async (req: Request, res: Response) => {
  const results: Record<string, { status: string; count: number; error?: string }> = {};
  let totalDiscovered = 0;

  for (const pKey of masterProviderKeys) {
    if (pKey.status === 'disabled') continue;
    try {
      const models = await fetchUpstreamModels(pKey.provider, pKey.key, pKey.customBaseUrl, pKey.id, pKey.keyHint);
      pKey.supportedModels = models;
      pKey.errorCount = 0;
      pKey.lastError = undefined;
      pKey.status = 'active';
      pKey.updatedAt = new Date().toISOString();
      results[pKey.keyHint] = { status: 'success', count: models.length };
      totalDiscovered += models.length;
    } catch (err: any) {
      results[pKey.keyHint] = { status: 'failed', count: 0, error: err.message };
    }
  }

  rebuildMasterModelsFromPool();
  saveGatewayCache();

  res.json({
    success: true,
    totalDiscovered,
    totalCatalogModels: masterModels.size,
    models: Array.from(masterModels.values()),
    results
  });
});

// Test single provider key
gatewayApp.post('/api/admin/test-key', async (req: Request, res: Response) => {
  const { provider, key, customBaseUrl } = req.body;
  if (!key) {
    res.status(400).json({ error: 'Key is required' });
    return;
  }
  const targetProvider = (provider && provider !== 'auto') ? provider : detectProviderByKey(key, customBaseUrl);
  const start = Date.now();

  try {
    const models = await fetchUpstreamModels(targetProvider, key, customBaseUrl);
    res.json({
      success: true,
      provider: targetProvider,
      latencyMs: Date.now() - start,
      modelsFound: models.length,
      sampleModels: models.slice(0, 5)
    });
  } catch (err: any) {
    res.json({
      success: false,
      provider: targetProvider,
      latencyMs: Date.now() - start,
      error: err.message
    });
  }
});

// Synchronize keys and models between Firestore / UI and backend gateway memory
gatewayApp.post('/api/gateway/sync', (req: Request, res: Response) => {
  const { apiKeys, providerKeys, models, replaceProviderKeys } = req.body;

  if (Array.isArray(apiKeys)) {
    for (const k of apiKeys) {
      if (k?.key) {
        masterApiKeys.set(k.key, k);
      }
    }
  }

  if (Array.isArray(providerKeys)) {
    if (replaceProviderKeys) {
      masterProviderKeys.length = 0;
    }
    for (const pk of providerKeys) {
      if (!pk?.id || !pk?.key) continue;
      const idx = masterProviderKeys.findIndex(item => item.id === pk.id);
      if (idx >= 0) {
        masterProviderKeys[idx] = { ...masterProviderKeys[idx], ...pk };
      } else {
        masterProviderKeys.push(pk);
      }
    }
    rebuildMasterModelsFromPool();
  }

  if (Array.isArray(models) && models.length > 0 && masterProviderKeys.length === 0) {
    for (const m of models) {
      if (m && m.id) {
        masterModels.set(m.id, {
          id: m.id,
          name: m.name || formatModelDisplayName(m.id),
          provider: m.provider || 'freeaimodel',
          ownerKeyId: m.ownerKeyId,
          ownerKeyHint: m.ownerKeyHint,
          discoveredAt: m.discoveredAt || new Date().toISOString(),
          contextWindow: m.contextWindow,
          description: m.description
        });
      }
    }
  }

  saveGatewayCache();

  res.json({
    success: true,
    apiKeysCount: masterApiKeys.size,
    providerKeysCount: masterProviderKeys.length,
    totalModels: masterModels.size,
    models: Array.from(masterModels.values())
  });
});

// Fetch system health and stats
gatewayApp.get('/api/stats', (req: Request, res: Response) => {
  const totalRequests = masterLogs.length;
  const totalTokens = masterLogs.reduce((acc, log) => acc + (log.totalTokens || 0), 0);
  const totalCost = masterLogs.reduce((acc, log) => acc + (log.costUsd || 0), 0);
  const activeKeys = masterProviderKeys.filter(k => k.status === 'active').length;
  const rateLimitedKeys = masterProviderKeys.filter(k => k.status === 'rate_limited').length;

  res.json({
    totalRequests,
    totalTokens,
    totalCost,
    activeKeys,
    rateLimitedKeys,
    totalProviderKeys: masterProviderKeys.length,
    totalModels: masterModels.size,
    logs: masterLogs.slice(0, 50)
  });
});
