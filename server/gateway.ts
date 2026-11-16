import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listCollectionFromFirestore,
  upsertDocumentInFirestore,
  deleteDocumentFromFirestore,
  findApiKeyBySecretInFirestore,
  syncModelsInFirestore,
  hasServerAdminCredentials,
  getFirestoreBridgeStatus
} from './firestoreStore.js';

dotenv.config();

export const gatewayApp = express();

// ==========================================
// Explicit CORS & Preflight Headers for all gateway routes (/v1/*, /api/*, /models)
// ==========================================
gatewayApp.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-user-email, x-firebase-token');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

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
  lastUsedAt?: string;
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
  isActive?: boolean;
  discoveredAt: string;
  updatedAt?: string;
  description?: string;
}

export interface StoredRequestLog {
  id: string;
  userId: string;
  apiKeyId?: string;
  model: string;
  routedModel?: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  status: number;
  timestamp: string;
  failoverAttempts?: number;
  fallbackRouted?: boolean;
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
// In-memory Master Stores + File Persistence Cache (Zero Fake/Demo Seed Models)
// ==========================================
export const masterApiKeys = new Map<string, StoredApiKey>();
export const masterProviderKeys: StoredProviderKey[] = [];
export const masterModels = new Map<string, StoredModel>();
export const masterLogs: StoredRequestLog[] = [];
export const masterUsers = new Map<string, StoredUserAccount>();

function getCacheFilePath(): string {
  return path.join(os.tmpdir(), '.gateway-cache.json');
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
  } catch {
    // Non-fatal in read-only environments
  }
}

function loadGatewayCache(): void {
  try {
    const candidates = [
      path.join(os.tmpdir(), '.gateway-cache.json'),
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
        if (Array.isArray(parsed.models)) {
          masterModels.clear();
          for (const m of parsed.models) {
            if (m?.id && m?.ownerKeyId) masterModels.set(m.id, m);
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
    // Ignore cache parse errors
  }
}

loadGatewayCache();

let lastHydratedAt = 0;
let hydrationInFlight: Promise<void> | null = null;

function extractFirebaseToken(req: Request): string | undefined {
  const token = req.headers['x-firebase-token'];
  return typeof token === 'string' && token.trim().length > 20 ? token.trim() : undefined;
}

/**
 * Hydrate in-memory stores from Firestore on cold starts or when cache is empty.
 */
export async function ensureGatewayHydrated(explicitIdToken?: string, force = false): Promise<void> {
  const now = Date.now();
  const hasTokenOrCreds = Boolean(explicitIdToken || hasServerAdminCredentials());
  if (!hasTokenOrCreds) return;
  if (!force && masterProviderKeys.length > 0 && now - lastHydratedAt < 30_000) return;

  if (hydrationInFlight) {
    await hydrationInFlight;
    return;
  }

  hydrationInFlight = (async () => {
    try {
      const [dbProviderKeys, dbModels, dbApiKeys, dbLogs] = await Promise.all([
        listCollectionFromFirestore<StoredProviderKey>('provider_keys', explicitIdToken, 300),
        listCollectionFromFirestore<StoredModel>('models', explicitIdToken, 500),
        listCollectionFromFirestore<StoredApiKey>('api_keys', explicitIdToken, 500),
        listCollectionFromFirestore<StoredRequestLog>('request_logs', explicitIdToken, 100)
      ]);

      if (Array.isArray(dbProviderKeys) && dbProviderKeys.length > 0) {
        const byId = new Map<string, StoredProviderKey>();
        for (const existing of masterProviderKeys) byId.set(existing.id, existing);
        for (const pk of dbProviderKeys) {
          if (pk?.id && pk?.key) {
            const local = byId.get(pk.id);
            byId.set(pk.id, local ? { ...pk, ...local, supportedModels: pk.supportedModels?.length ? pk.supportedModels : local.supportedModels } : pk);
          }
        }
        masterProviderKeys.length = 0;
        masterProviderKeys.push(...Array.from(byId.values()));
      }

      if (Array.isArray(dbModels) && dbModels.length > 0) {
        for (const m of dbModels) {
          if (m?.id && m?.ownerKeyId) {
            masterModels.set(m.id, m);
          }
        }
      } else if (masterProviderKeys.length > 0 && masterModels.size === 0) {
        rebuildMasterModelsFromPool();
      }

      if (Array.isArray(dbApiKeys)) {
        for (const ak of dbApiKeys) {
          if (ak?.key) {
            masterApiKeys.set(ak.key, ak);
          }
        }
      }

      if (Array.isArray(dbLogs) && dbLogs.length > 0 && masterLogs.length === 0) {
        const sorted = [...dbLogs].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        masterLogs.push(...sorted.slice(0, 200));
      }

      lastHydratedAt = Date.now();
      saveGatewayCache();
    } catch (err) {
      console.warn('[FreeAIModel] Firestore hydration skipped:', err);
    } finally {
      hydrationInFlight = null;
    }
  })();

  await hydrationInFlight;
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
  if (trimmed.startsWith('AIza')) return 'gemini';
  if (trimmed.startsWith('gsk_')) return 'groq';
  if (trimmed.startsWith('sk-or-')) return 'openrouter';
  if (trimmed.startsWith('sk-ant-')) return 'anthropic';
  if (trimmed.startsWith('csk-')) return 'cerebras';
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-admin-') || trimmed.startsWith('sk-svcacct-')) {
    return 'openai';
  }
  if (trimmed.startsWith('sk_')) return 'inception';
  if (trimmed.startsWith('sk-') && trimmed.length > 40) return 'openai';
  if (trimmed.startsWith('sk-')) return 'deepseek';
  if (/^[a-zA-Z0-9]{32}$/.test(trimmed)) return 'mistral';
  return 'custom';
}

export function cleanRawApiKeyToken(raw: string): string {
  return String(raw || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
    .replace(/^(authorization\s*:\s*)?bearer\s+/i, '')
    .replace(/^["'`(\[{<]+|["'`)\]}>]+$/g, '')
    .replace(/[^\x21-\x7E]/g, '')
    .trim();
}

export function sanitizeAndExtractBulkKeys(rawText: string): { keys: string[]; maskedFound: boolean } {
  const normalized = String(rawText || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  const lines = normalized.split(/[\r\n]+/);
  const seen = new Set<string>();
  const keys: string[] = [];
  let maskedFound = false;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    line = line.replace(/^([-*•]|\d+[.)])\s+/, '').trim();
    line = line.replace(/^export\s+/i, '').trim();

    const envMatch = line.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/);
    if (envMatch) {
      line = envMatch[1].trim();
    }

    line = line.replace(/^(authorization\s*:\s*)?bearer\s+/i, '').trim();

    const tokens = line.split(/[\s,;]+/);
    for (let token of tokens) {
      token = token.replace(/^["'`(\[{<]+|["'`)\]}>]+$/g, '').trim();
      if (!token) continue;
      if (/^(bearer|api_key|apikey|key|token|authorization|header|curl|-h|--header)$/i.test(token)) {
        continue;
      }
      if (token.includes('…') || token.includes('...') || /\*{4,}|•{2,}/.test(token)) {
        maskedFound = true;
        continue;
      }
      const cleanAscii = token.replace(/[^\x21-\x7E]/g, '');
      if (cleanAscii.length < 6) continue;
      if (!seen.has(cleanAscii)) {
        seen.add(cleanAscii);
        keys.push(cleanAscii);
      }
    }
  }

  return { keys, maskedFound };
}

/**
 * Rebuild masterModels map strictly from active Admin Pool Keys (100% dynamic, zero fake models)
 */
export function rebuildMasterModelsFromPool(): void {
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
        isActive: true,
        discoveredAt: prevMeta?.discoveredAt || pk.updatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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

export function isMaskedOrInvalidHeaderKey(rawKey: string): string | null {
  const trimmed = String(rawKey || '').trim();
  if (trimmed.includes('…') || trimmed.includes('...') || /\*{4,}|•{2,}/.test(trimmed)) {
    return 'Masked key detected, please paste the full raw API key';
  }
  const cleanAscii = cleanRawApiKeyToken(trimmed);
  if (cleanAscii.length < 6) {
    return 'API key appears empty or too short. Please paste the full raw API key.';
  }
  return null;
}

export async function discoverModelsWithAutoProbe(
  initialProvider: SupportedProvider,
  rawKey: string,
  customBaseUrl?: string,
  ownerKeyId?: string,
  ownerKeyHint?: string,
  allowAutoProbe = true,
  mutateCatalog = true
): Promise<{ provider: SupportedProvider; models: string[] }> {
  const cleanKey = cleanRawApiKeyToken(rawKey);
  const normalizedUrl = normalizeBaseUrl(customBaseUrl);

  if (normalizedUrl || !allowAutoProbe) {
    const models = await fetchUpstreamModels(
      initialProvider,
      cleanKey,
      normalizedUrl,
      ownerKeyId,
      ownerKeyHint,
      mutateCatalog
    );
    return { provider: initialProvider, models };
  }

  // Build ordered candidate list for auto-detection when prefix is shared across providers (e.g. sk-...)
  const candidates: SupportedProvider[] = [initialProvider];
  if (
    cleanKey.startsWith('sk-') &&
    !cleanKey.startsWith('sk-or-') &&
    !cleanKey.startsWith('sk-ant-') &&
    !cleanKey.startsWith('sk-proj-') &&
    !cleanKey.startsWith('sk-admin-') &&
    !cleanKey.startsWith('sk-svcacct-')
  ) {
    for (const p of ['openai', 'deepseek', 'openrouter', 'inception', 'groq', 'mistral'] as SupportedProvider[]) {
      if (!candidates.includes(p)) candidates.push(p);
    }
  } else if (cleanKey.startsWith('sk_')) {
    for (const p of ['inception', 'openai', 'openrouter'] as SupportedProvider[]) {
      if (!candidates.includes(p)) candidates.push(p);
    }
  } else if (/^[a-zA-Z0-9]{32}$/.test(cleanKey)) {
    for (const p of ['mistral', 'inception'] as SupportedProvider[]) {
      if (!candidates.includes(p)) candidates.push(p);
    }
  } else if (initialProvider === 'custom') {
    for (const p of ['inception', 'mistral', 'openai', 'openrouter', 'deepseek', 'groq'] as SupportedProvider[]) {
      if (!candidates.includes(p)) candidates.push(p);
    }
  }

  let primaryError: Error | null = null;
  for (const candidate of candidates) {
    try {
      const models = await fetchUpstreamModels(
        candidate,
        cleanKey,
        undefined,
        ownerKeyId,
        ownerKeyHint,
        mutateCatalog
      );
      if (models.length > 0) {
        return { provider: candidate, models };
      }
    } catch (err: any) {
      if (!primaryError) {
        primaryError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw primaryError || new Error(`Failed to discover models for ${initialProvider}`);
}

/**
 * Fetch real live models directly from upstream provider GET /v1/models endpoint
 */
export async function fetchUpstreamModels(
  provider: string,
  apiKey: string,
  customBaseUrl?: string,
  ownerKeyId?: string,
  ownerKeyHint?: string,
  mutateCatalog = true
): Promise<string[]> {
  const cleanKey = cleanRawApiKeyToken(apiKey);
  const keyValidationError = isMaskedOrInvalidHeaderKey(cleanKey);
  if (keyValidationError) {
    throw new Error(keyValidationError);
  }

  const baseUrl = resolveProviderBaseUrl(provider, customBaseUrl);
  const modelsPath = PROVIDER_CONFIGS[provider]?.modelsPath || '/models';
  const primaryUrl = `${baseUrl}${modelsPath}`;

  const headers: Record<string, string> = {
    'User-Agent': 'FreeAIModel-Gateway/1.0',
    'Accept': 'application/json'
  };

  if (provider === 'anthropic') {
    headers['x-api-key'] = cleanKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${cleanKey}`;
  }

  let response = await fetch(primaryUrl, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15000)
  });

  // Fallback for Google Gemini native REST /v1beta/models?key=... if OpenAI-compat endpoint rejects
  let usedUrl = primaryUrl;
  if (!response.ok && provider === 'gemini' && !customBaseUrl) {
    const nativeGeminiUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
    const fallbackRes = await fetch(nativeGeminiUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'FreeAIModel-Gateway/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (fallbackRes.ok) {
      response = fallbackRes;
      usedUrl = nativeGeminiUrl.replace(cleanKey, '***');
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Upstream ${provider} (${usedUrl}) returned HTTP ${response.status}: ${errorText.slice(0, 180) || response.statusText}`);
  }

  const rawText = await response.text();
  let json: any;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Upstream ${provider} (${usedUrl}) returned non-JSON response: ${rawText.slice(0, 140)}`);
  }

  const rawItems: any[] = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
    ? json.models
    : Array.isArray(json)
    ? json
    : [];

  const models: string[] = [];
  const seen = new Set<string>();
  for (const item of rawItems) {
    const rawId = typeof item === 'string' ? item : item?.id || item?.name;
    if (rawId && typeof rawId === 'string') {
      const cleanId = rawId.replace(/^models\//, '').trim();
      if (!cleanId || seen.has(cleanId)) continue;
      seen.add(cleanId);
      models.push(cleanId);
      if (mutateCatalog) {
        masterModels.set(cleanId, {
          id: cleanId,
          name: item?.display_name || item?.name || formatModelDisplayName(cleanId),
          provider,
          ownerKeyId,
          ownerKeyHint,
          contextWindow: item?.context_length || item?.context_window || item?.input_token_limit,
          isActive: true,
          discoveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }
  }

  return models;
}

function extractGatewayTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
    return authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : authHeader.trim();
  }
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
    return xApiKey.trim();
  }
  const queryKey = req.query.key || req.query.api_key;
  if (typeof queryKey === 'string' && queryKey.trim().length > 0) {
    return queryKey.trim();
  }
  return null;
}

async function resolveRegisteredGatewayKey(apiKeyToken: string): Promise<StoredApiKey | null> {
  const localMatch = masterApiKeys.get(apiKeyToken);
  if (localMatch) return localMatch;

  await ensureGatewayHydrated();
  const afterHydration = masterApiKeys.get(apiKeyToken);
  if (afterHydration) return afterHydration;

  const dbMatch = await findApiKeyBySecretInFirestore<StoredApiKey>(apiKeyToken);
  if (dbMatch && dbMatch.key) {
    masterApiKeys.set(dbMatch.key, dbMatch);
    saveGatewayCache();
    return dbMatch;
  }

  return null;
}

// ==========================================
// Middleware: Strict User Gateway API Key Validation (POST /v1/chat/completions)
// ==========================================
export async function validateGatewayKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKeyToken = extractGatewayTokenFromRequest(req);
  if (!apiKeyToken) {
    res.status(401).json({
      error: {
        message: 'Missing Authorization key. Expected "Authorization: Bearer sk-gateway-..."',
        type: 'invalid_request_error',
        code: 'missing_api_key'
      }
    });
    return;
  }

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

  const matchedKey = await resolveRegisteredGatewayKey(apiKeyToken);

  if (!matchedKey) {
    res.status(401).json({
      error: {
        message: 'Invalid or unregistered FreeAIModel API key. Please generate an active sk-gateway-... key in your Dashboard.',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
    return;
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

// ==========================================
// Middleware: Flexible Auth for Model Listing (GET /v1/models & GET /models)
// - If an API key IS supplied, verifies it strictly against registered database keys.
// - If NO API key is supplied, allows public OpenAI-compatible model catalog discovery.
// ==========================================
export async function optionalFlexibleGatewayAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKeyToken = extractGatewayTokenFromRequest(req);
  if (!apiKeyToken) {
    next();
    return;
  }

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

  const matchedKey = await resolveRegisteredGatewayKey(apiKeyToken);
  if (!matchedKey) {
    res.status(401).json({
      error: {
        message: 'Invalid or unregistered FreeAIModel API key.',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
    return;
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

function buildOpenAiModelsList() {
  const createdTs = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: Array.from(masterModels.values()).map(m => ({
      id: m.id,
      object: 'model',
      created: m.discoveredAt ? Math.floor(new Date(m.discoveredAt).getTime() / 1000) || createdTs : createdTs,
      owned_by: 'freeaimodel',
      provider: m.provider,
      name: m.name || formatModelDisplayName(m.id),
      ownerKeyId: m.ownerKeyId,
      ownerKeyHint: m.ownerKeyHint,
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
// Public / Frontend Dashboard Model Catalog Endpoint (100% live models only)
// ==========================================
gatewayApp.get('/api/models', async (req: Request, res: Response) => {
  await ensureGatewayHydrated(extractFirebaseToken(req));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(buildOpenAiModelsList());
});

// ==========================================
// Route: GET /v1/models & GET /models (Strict Key Verification if provided + Public Discovery)
// ==========================================
gatewayApp.get('/v1/models', optionalFlexibleGatewayAuth, async (req: Request, res: Response) => {
  await ensureGatewayHydrated(extractFirebaseToken(req));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(buildOpenAiModelsList());
});

gatewayApp.get('/models', optionalFlexibleGatewayAuth, async (req: Request, res: Response, next: NextFunction) => {
  const hasExplicitKey = Boolean(extractGatewayTokenFromRequest(req));
  const acceptHeader = String(req.headers['accept'] || '').toLowerCase();
  const isBrowserHtmlNav = acceptHeader.includes('text/html') && !acceptHeader.includes('application/json') && !hasExplicitKey;

  if (isBrowserHtmlNav) {
    next();
    return;
  }

  await ensureGatewayHydrated(extractFirebaseToken(req));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(buildOpenAiModelsList());
});

// ==========================================
// Route: POST /v1/chat/completions (OpenAI-compatible Universal Router + Limit-Shift Failover)
// ==========================================
const NON_CHAT_MODEL_RE = /realtime|tts|whisper|transcribe|image|dall-e|sora|embedding|moderation|gpt-audio|gpt-live|diarize/i;
const PREFERRED_CHAT_IDS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-5-mini',
  'gpt-5',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'deepseek-chat',
  'mercury'
];

function parseRetryAfterMs(retryHeader: string | null): number {
  if (!retryHeader) return 60_000;
  const seconds = Number(retryHeader);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.max(seconds * 1000, 10_000), 300_000);
  }
  const dateMs = Date.parse(retryHeader);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 10_000), 300_000);
  }
  return 60_000;
}

function isQuotaExhaustedError(status: number, bodyText: string): boolean {
  if (status === 402) return true;
  return /insufficient_quota|exceeded your current quota|billing|credit balance|out of credits|payment required/i.test(bodyText);
}

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
  } = req.body || {};

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

  await ensureGatewayHydrated();

  const now = Date.now();
  const dirtyProviderKeys = new Set<StoredProviderKey>();

  // Recover expired 429 cooldowns and build healthy active key pool
  const availableKeys = masterProviderKeys.filter(k => {
    if (k.status === 'disabled' || k.status === 'exhausted') return false;
    if (k.status === 'rate_limited') {
      if (k.cooldownUntil && k.cooldownUntil > now) return false;
      k.status = 'active';
      k.cooldownUntil = undefined;
      k.updatedAt = new Date().toISOString();
      dirtyProviderKeys.add(k);
    }
    if (isMaskedOrInvalidHeaderKey(k.key)) return false;
    return true;
  });

  // Resolve requested model: exact -> case-insensitive -> fallback to best chat-capable active synced model
  let effectiveModel = String(model).trim();
  let usedFallbackModel = false;

  let modelRecord = masterModels.get(effectiveModel);
  if (!modelRecord) {
    const lowerReq = effectiveModel.toLowerCase();
    for (const [id, rec] of masterModels.entries()) {
      if (id.toLowerCase() === lowerReq) {
        effectiveModel = id;
        modelRecord = rec;
        break;
      }
    }
  }

  const findKeysForModel = (targetModelId: string, targetRecord?: StoredModel, keyPool = availableKeys) => {
    const targetProvider = targetRecord?.provider;
    const keys = keyPool.filter(k => {
      const ownsModel = (Array.isArray(k.supportedModels) && k.supportedModels.includes(targetModelId)) ||
        (targetRecord?.ownerKeyId && k.id === targetRecord.ownerKeyId);
      const sameProvider = Boolean(targetProvider && k.provider === targetProvider);
      return ownsModel || sameProvider;
    });

    // Fair Load-Balanced Rotation: model owner -> fewest errors -> oldest lastUsedAt / fewest requests
    keys.sort((a, b) => {
      const aOwns = (a.supportedModels?.includes(targetModelId) || a.id === targetRecord?.ownerKeyId) ? 1 : 0;
      const bOwns = (b.supportedModels?.includes(targetModelId) || b.id === targetRecord?.ownerKeyId) ? 1 : 0;
      if (aOwns !== bOwns) return bOwns - aOwns;

      const errDiff = (a.errorCount || 0) - (b.errorCount || 0);
      if (errDiff !== 0) return errDiff;

      const aLast = a.lastUsedAt ? Date.parse(a.lastUsedAt) || 0 : 0;
      const bLast = b.lastUsedAt ? Date.parse(b.lastUsedAt) || 0 : 0;
      if (aLast !== bLast) return aLast - bLast;

      return (a.requestCount || 0) - (b.requestCount || 0);
    });
    return keys;
  };

  const pickChatModelForPool = (keyPool: StoredProviderKey[]): { id: string; record: StoredModel } | undefined => {
    const poolIds = new Set(keyPool.map(k => k.id));
    const routableEntries: Array<{ id: string; record: StoredModel }> = [];

    for (const m of masterModels.values()) {
      if (findKeysForModel(m.id, m, keyPool).length > 0) {
        routableEntries.push({ id: m.id, record: m });
      }
    }

    if (routableEntries.length === 0) {
      for (const k of keyPool) {
        if (!poolIds.has(k.id) || !Array.isArray(k.supportedModels)) continue;
        for (const rawId of k.supportedModels) {
          const id = String(rawId).trim();
          if (!id) continue;
          routableEntries.push({
            id,
            record: masterModels.get(id) || {
              id,
              name: formatModelDisplayName(id),
              provider: k.provider,
              ownerKeyId: k.id,
              ownerKeyHint: k.keyHint,
              discoveredAt: new Date().toISOString()
            }
          });
        }
      }
    }

    for (const preferredId of PREFERRED_CHAT_IDS) {
      const match = routableEntries.find(entry => entry.id.toLowerCase() === preferredId);
      if (match) return match;
    }
    return routableEntries.find(entry => !NON_CHAT_MODEL_RE.test(entry.id)) || routableEntries[0];
  };

  let candidateKeys = findKeysForModel(effectiveModel, modelRecord);

  // Automatic Fallback Model Routing if requested model isn't matched by any active key
  if (candidateKeys.length === 0 && availableKeys.length > 0) {
    const picked = pickChatModelForPool(availableKeys);
    if (picked) {
      usedFallbackModel = true;
      effectiveModel = picked.id;
      modelRecord = picked.record;
      candidateKeys = findKeysForModel(effectiveModel, modelRecord);
    } else {
      candidateKeys = [...availableKeys];
    }
  }

  let success = false;
  let failoverCount = 0;
  let lastErrorMsg = '';
  let lastErrorStatus = 502;
  let providerUsed = '';
  const promptTokens = Math.max(12, Math.round(JSON.stringify(messages).length / 4));
  let completionTokens = 0;

  const triedKeyIds = new Set<string>();

  const executeUpstreamAttempt = async (providerKey: StoredProviderKey, modelToUse: string): Promise<boolean> => {
    triedKeyIds.add(providerKey.id);
    const baseUrl = resolveProviderBaseUrl(providerKey.provider, providerKey.customBaseUrl);
    const isAnthropic = providerKey.provider === 'anthropic';
    const chatPath = isAnthropic ? '/messages' : (PROVIDER_CONFIGS[providerKey.provider]?.chatPath || '/chat/completions');
    const endpoint = `${baseUrl}${chatPath}`;

    try {
      providerKey.requestCount = (providerKey.requestCount || 0) + 1;
      providerKey.lastUsedAt = new Date().toISOString();
      providerKey.updatedAt = new Date().toISOString();
      dirtyProviderKeys.add(providerKey);

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
          model: modelToUse,
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
          model: modelToUse,
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
        body: JSON.stringify(upstreamPayload),
        signal: AbortSignal.timeout(45000)
      });

      if (upstreamResponse.status === 429) {
        failoverCount++;
        lastErrorStatus = 429;
        lastErrorMsg = await upstreamResponse.text().catch(() => 'Rate limit exceeded');
        const cooldownMs = parseRetryAfterMs(upstreamResponse.headers.get('retry-after'));
        providerKey.status = 'rate_limited';
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;
        providerKey.lastError = `Rate limit 429 hit at ${new Date().toLocaleTimeString()} (rotating to backup key)`;
        providerKey.cooldownUntil = Date.now() + cooldownMs;
        return false;
      }

      if (!upstreamResponse.ok) {
        const errorBody = await upstreamResponse.text().catch(() => '');
        failoverCount++;
        lastErrorStatus = upstreamResponse.status;
        lastErrorMsg = errorBody || upstreamResponse.statusText;
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;

        if (isQuotaExhaustedError(upstreamResponse.status, errorBody)) {
          providerKey.status = 'exhausted';
          providerKey.lastError = `Quota exhausted (${upstreamResponse.status}): ${errorBody.slice(0, 140)}`;
        } else {
          providerKey.lastError = `HTTP ${upstreamResponse.status}: ${errorBody.slice(0, 150)}`;
        }
        return false;
      }

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('x-gateway-provider', providerKey.provider);
        res.setHeader('x-gateway-model', modelToUse);
        res.setHeader('x-gateway-fallback', usedFallbackModel ? 'true' : 'false');
        res.setHeader('x-gateway-failover-count', String(failoverCount));
        res.setHeader('x-gateway-key-hint', providerKey.keyHint);

        if (upstreamResponse.body) {
          const reader = upstreamResponse.body.getReader();
          const decoder = new TextDecoder();
          let streamedChars = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            streamedChars += chunk.length;
            res.write(chunk);
          }
          res.end();
          completionTokens = Math.max(15, Math.round(streamedChars / 16));
          providerUsed = providerKey.provider;
          providerKey.status = 'active';
          providerKey.cooldownUntil = undefined;
          effectiveModel = modelToUse;
          return true;
        }
      }

      let data: any = await upstreamResponse.json();
      providerUsed = providerKey.provider;
      providerKey.status = 'active';
      providerKey.cooldownUntil = undefined;
      effectiveModel = modelToUse;

      if (isAnthropic && data.content) {
        const text = Array.isArray(data.content)
          ? data.content.map((c: any) => c.text || '').join('')
          : '';
        data = {
          id: data.id || 'chatcmpl-' + Math.random().toString(36).substring(2, 10),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: modelToUse,
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
        completionTokens = data.usage.completion_tokens || completionTokens;
      } else {
        const content = data.choices?.[0]?.message?.content || '';
        completionTokens = Math.max(15, Math.round(content.length / 4));
      }

      data.gateway_meta = {
        provider_used: providerKey.provider,
        requested_model: model,
        routed_model: modelToUse,
        fallback_routed: usedFallbackModel,
        failover_count: failoverCount,
        key_hint: providerKey.keyHint,
        latency_ms: Date.now() - startTime,
        cost_usd: (promptTokens * 0.000002) + (completionTokens * 0.000006)
      };

      res.setHeader('x-gateway-provider', providerKey.provider);
      res.setHeader('x-gateway-model', modelToUse);
      res.setHeader('x-gateway-fallback', usedFallbackModel ? 'true' : 'false');
      res.setHeader('x-gateway-failover-count', String(failoverCount));
      res.setHeader('x-gateway-key-hint', providerKey.keyHint);
      res.json(data);
      return true;
    } catch (err: any) {
      failoverCount++;
      providerKey.errorCount = (providerKey.errorCount || 0) + 1;
      providerKey.lastError = err?.message || 'Network or timeout error';
      lastErrorMsg = err?.message || 'Network error';
      return false;
    }
  };

  // Stage 1: Try all active keys supporting the primary/requested model (auto-rotating on 429/error)
  for (const providerKey of candidateKeys) {
    if (await executeUpstreamAttempt(providerKey, effectiveModel)) {
      success = true;
      break;
    }
  }

  // Stage 2: Cross-Pool Limit-Shift Failover if all primary keys failed and other active keys remain
  if (!success) {
    const remainingPoolKeys = availableKeys.filter(k => !triedKeyIds.has(k.id));
    if (remainingPoolKeys.length > 0) {
      const backupPick = pickChatModelForPool(remainingPoolKeys);
      const backupModel = backupPick?.id || effectiveModel;
      const backupKeys = backupPick
        ? findKeysForModel(backupModel, backupPick.record, remainingPoolKeys)
        : remainingPoolKeys;

      usedFallbackModel = true;
      for (const backupKey of backupKeys) {
        const modelForKey = backupKey.supportedModels?.length
          ? (backupKey.supportedModels.includes(backupModel)
              ? backupModel
              : backupKey.supportedModels.find(id => !NON_CHAT_MODEL_RE.test(id)) || backupKey.supportedModels[0])
          : backupModel;
        if (await executeUpstreamAttempt(backupKey, modelForKey)) {
          success = true;
          break;
        }
      }
    }
  }

  // Persist rotated/rate-limited/exhausted provider key telemetry to Firestore + /tmp cache
  if (dirtyProviderKeys.size > 0) {
    saveGatewayCache();
    Promise.all(
      Array.from(dirtyProviderKeys).map(pk => upsertDocumentInFirestore('provider_keys', pk.id, pk))
    ).catch(() => {});
  }

  if (!success) {
    const statusToSend = candidateKeys.length === 0 ? 404 : (lastErrorStatus >= 400 ? lastErrorStatus : 502);
    const errorMessage = candidateKeys.length === 0
      ? `No active Admin Pool provider keys are configured yet to handle "${model}". Add a valid provider API key in the Admin Panel (/admin).`
      : `Upstream request for "${effectiveModel}" failed after rotating across ${failoverCount} key attempt(s): ${lastErrorMsg.slice(0, 220)}`;

    res.status(statusToSend).json({
      error: {
        message: errorMessage,
        type: candidateKeys.length === 0 ? 'model_not_found' : 'gateway_upstream_error',
        code: candidateKeys.length === 0 ? 'model_not_found' : 'upstream_failed',
        requested_model: model,
        routed_model: effectiveModel,
        failover_count: failoverCount
      }
    });
    return;
  }

  const totalTokens = promptTokens + completionTokens;
  const cost = (promptTokens * 0.000002) + (completionTokens * 0.000006);

  apiKeyRecord.totalRequests = (apiKeyRecord.totalRequests || 0) + 1;
  apiKeyRecord.totalTokens = (apiKeyRecord.totalTokens || 0) + totalTokens;
  apiKeyRecord.lastUsedAt = new Date().toISOString();

  const logEntry: StoredRequestLog = {
    id: 'log_' + Math.random().toString(36).substring(2, 10),
    userId: apiKeyRecord.userId,
    apiKeyId: apiKeyRecord.id,
    model: String(model),
    routedModel: effectiveModel,
    provider: providerUsed,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: cost,
    latencyMs: Date.now() - startTime,
    status: 200,
    timestamp: new Date().toISOString(),
    failoverAttempts: failoverCount,
    fallbackRouted: usedFallbackModel
  };

  masterLogs.unshift(logEntry);
  if (masterLogs.length > 500) masterLogs.length = 500;

  const userAccount = masterUsers.get(apiKeyRecord.userId);
  if (userAccount) {
    ensureDailyCreditsReset(userAccount);
    userAccount.freeCreditsSpent = (userAccount.freeCreditsSpent || 0) + totalTokens;
    userAccount.updatedAt = new Date().toISOString();
  }

  saveGatewayCache();

  // Background Firestore persistence for usage, key stats, and telemetry log
  Promise.all([
    upsertDocumentInFirestore('api_keys', apiKeyRecord.id, apiKeyRecord),
    upsertDocumentInFirestore('request_logs', logEntry.id, logEntry)
  ]).catch(() => {});
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
// User Gateway API Keys CRUD (/api/keys) — Persisted to Memory, Cache, & Firestore
// ==========================================
gatewayApp.get('/api/keys', async (req: Request, res: Response) => {
  await ensureGatewayHydrated(extractFirebaseToken(req));
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const allKeys = Array.from(masterApiKeys.values());
  const keys = userId ? allKeys.filter(k => k.userId === userId) : allKeys;
  res.json({ keys });
});

gatewayApp.post('/api/keys', async (req: Request, res: Response) => {
  try {
    const { userId, name, key: providedKey, id: providedId } = req.body || {};
    const fbToken = extractFirebaseToken(req);

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Key name is required.' });
      return;
    }

    const fullKey = (typeof providedKey === 'string' && providedKey.startsWith('sk-gateway-') && providedKey.length >= 16)
      ? providedKey.trim()
      : `sk-gateway-${crypto.randomBytes(16).toString('hex')}`;

    const newKey: StoredApiKey = {
      id: (typeof providedId === 'string' && providedId.trim()) ? providedId.trim() : `key_${crypto.randomBytes(5).toString('hex')}`,
      userId: (typeof userId === 'string' && userId.trim()) ? userId.trim() : 'usr_developer',
      name: name.trim().slice(0, 128),
      key: fullKey,
      keyPrefix: `${fullKey.slice(0, 11)}...${fullKey.slice(-4)}`,
      status: 'active',
      totalRequests: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString()
    };

    masterApiKeys.set(newKey.key, newKey);
    saveGatewayCache();

    const persistedToDb = await upsertDocumentInFirestore('api_keys', newKey.id, newKey, fbToken);

    res.status(200).json({
      success: true,
      persistedToDb,
      key: newKey
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate gateway API key' });
  }
});

gatewayApp.delete('/api/keys/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const fbToken = extractFirebaseToken(req);

  let removed = false;
  for (const [token, record] of masterApiKeys.entries()) {
    if (record.id === id) {
      masterApiKeys.delete(token);
      removed = true;
    }
  }
  saveGatewayCache();

  await deleteDocumentFromFirestore('api_keys', id, fbToken);

  res.json({ success: true, removed });
});

// ==========================================
// Admin APIs: Key Pool & Live Model Discovery
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
    const fbToken = extractFirebaseToken(req);
    await ensureGatewayHydrated(fbToken);

    const { keysText, provider, customBaseUrl } = req.body || {};
    if (!keysText || typeof keysText !== 'string') {
      res.status(400).json({ error: 'keysText is required as a string.' });
      return;
    }

    const { keys: lines, maskedFound } = sanitizeAndExtractBulkKeys(keysText);

    if (lines.length === 0) {
      res.status(400).json({
        error: maskedFound
          ? 'Masked key detected, please paste the full raw API key'
          : 'No valid keys detected in input.'
      });
      return;
    }

    const normalizedCustomUrl = normalizeBaseUrl(customBaseUrl);
    const isAutoProvider = !provider || provider === 'auto';
    const addedKeys: StoredProviderKey[] = [];
    const discoveredModelsSummary: Record<string, string[]> = {};
    const discoveryErrors: Record<string, string> = {};

    for (const rawKey of lines) {
      const targetProvider: SupportedProvider =
        !isAutoProvider
          ? (provider as SupportedProvider)
          : detectProviderByKey(rawKey, normalizedCustomUrl);

      const hint = (rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : rawKey).slice(0, 32);
      const existingRecord = masterProviderKeys.find(k => k.key === rawKey);
      const keyId = existingRecord ? existingRecord.id : ('pk_' + Math.random().toString(36).substring(2, 11));

      const keyRecord: StoredProviderKey = existingRecord || {
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

      if (existingRecord) {
        keyRecord.provider = targetProvider;
        keyRecord.customBaseUrl = normalizedCustomUrl || keyRecord.customBaseUrl;
        keyRecord.status = 'active';
        keyRecord.cooldownUntil = undefined;
        keyRecord.updatedAt = new Date().toISOString();
      }

      try {
        const discovered = await discoverModelsWithAutoProbe(
          targetProvider,
          rawKey,
          keyRecord.customBaseUrl,
          keyId,
          hint,
          isAutoProvider,
          true
        );
        keyRecord.provider = discovered.provider;
        keyRecord.supportedModels = discovered.models;
        keyRecord.lastError = undefined;
        keyRecord.errorCount = 0;
        discoveredModelsSummary[hint] = discovered.models;
      } catch (err: any) {
        const errMsg = String(err?.message || 'Failed to query upstream /models endpoint').slice(0, 500);
        console.warn(`[FreeAIModel] Model fetch for ${hint} failed:`, errMsg);
        keyRecord.lastError = errMsg;
        keyRecord.errorCount = (keyRecord.errorCount || 0) + 1;
        discoveryErrors[hint] = errMsg;
      }

      if (!existingRecord) {
        masterProviderKeys.push(keyRecord);
      }
      addedKeys.push(keyRecord);
    }

    rebuildMasterModelsFromPool();
    saveGatewayCache();

    // Persist added provider keys and discovered models directly to Firestore
    const syncedModelsList = Array.from(masterModels.values());
    await Promise.all([
      ...addedKeys.map(pk => upsertDocumentInFirestore('provider_keys', pk.id, pk, fbToken)),
      syncModelsInFirestore(syncedModelsList, fbToken)
    ]).catch(() => {});

    res.status(200).json({
      success: true,
      message: `Added ${addedKeys.length} key(s) to Master Key Pool.`,
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
      discoveryErrors,
      models: syncedModelsList,
      totalKeysInPool: masterProviderKeys.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Internal server error during key ingestion' });
  }
};

gatewayApp.post('/api/admin/bulk-add-keys', checkOptionalAdminHeader, handleBulkAddKeys);
gatewayApp.post('/api/models/add-keys', checkOptionalAdminHeader, handleBulkAddKeys);

gatewayApp.get('/api/admin/keys', checkOptionalAdminHeader, async (req: Request, res: Response) => {
  await ensureGatewayHydrated(extractFirebaseToken(req));
  res.json({ keys: masterProviderKeys });
});

gatewayApp.post('/api/admin/keys/reset-cooldowns', checkOptionalAdminHeader, async (req: Request, res: Response) => {
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken);

  const restored: StoredProviderKey[] = [];
  for (const pk of masterProviderKeys) {
    if (pk.status === 'rate_limited' || pk.status === 'exhausted') {
      pk.status = 'active';
      pk.cooldownUntil = undefined;
      pk.lastError = undefined;
      pk.updatedAt = new Date().toISOString();
      restored.push(pk);
    }
  }

  rebuildMasterModelsFromPool();
  saveGatewayCache();

  await Promise.all(
    restored.map(pk => upsertDocumentInFirestore('provider_keys', pk.id, pk, fbToken))
  ).catch(() => {});

  res.json({
    success: true,
    restoredCount: restored.length,
    keys: masterProviderKeys,
    models: Array.from(masterModels.values())
  });
});

gatewayApp.patch('/api/admin/keys/:id/status', checkOptionalAdminHeader, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken);

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

  const modelsList = Array.from(masterModels.values());
  await Promise.all([
    upsertDocumentInFirestore('provider_keys', target.id, target, fbToken),
    syncModelsInFirestore(modelsList, fbToken)
  ]).catch(() => {});

  res.json({ success: true, key: target, models: modelsList });
});

gatewayApp.delete('/api/admin/keys/:id', checkOptionalAdminHeader, async (req: Request, res: Response) => {
  const { id } = req.params;
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken);

  const idx = masterProviderKeys.findIndex(k => k.id === id);
  if (idx >= 0) {
    masterProviderKeys.splice(idx, 1);
  }
  rebuildMasterModelsFromPool();
  saveGatewayCache();

  const modelsList = Array.from(masterModels.values());
  await Promise.all([
    deleteDocumentFromFirestore('provider_keys', id, fbToken),
    syncModelsInFirestore(modelsList, fbToken)
  ]).catch(() => {});

  res.json({ success: true, models: modelsList, totalKeysInPool: masterProviderKeys.length });
});

gatewayApp.post('/api/models/refresh', async (req: Request, res: Response) => {
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken);

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
      results[pKey.keyHint] = { status: 'failed', count: 0, error: err?.message || 'Upstream fetch failed' };
    }
  }

  rebuildMasterModelsFromPool();
  saveGatewayCache();

  const modelsList = Array.from(masterModels.values());
  await Promise.all([
    ...masterProviderKeys.map(pk => upsertDocumentInFirestore('provider_keys', pk.id, pk, fbToken)),
    syncModelsInFirestore(modelsList, fbToken)
  ]).catch(() => {});

  res.json({
    success: true,
    totalDiscovered,
    totalCatalogModels: masterModels.size,
    models: modelsList,
    results
  });
});

gatewayApp.post('/api/admin/test-key', checkOptionalAdminHeader, async (req: Request, res: Response) => {
  const { provider, key, customBaseUrl } = req.body || {};
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'Key is required' });
    return;
  }
  const cleanKey = cleanRawApiKeyToken(key);
  const invalidReason = isMaskedOrInvalidHeaderKey(cleanKey);
  if (invalidReason) {
    res.status(400).json({ success: false, error: invalidReason });
    return;
  }
  const isAuto = !provider || provider === 'auto';
  const targetProvider = !isAuto ? (provider as SupportedProvider) : detectProviderByKey(cleanKey, customBaseUrl);
  const start = Date.now();

  try {
    const discovered = await discoverModelsWithAutoProbe(
      targetProvider,
      cleanKey,
      customBaseUrl,
      undefined,
      undefined,
      isAuto,
      false
    );
    res.json({
      success: true,
      provider: discovered.provider,
      latencyMs: Date.now() - start,
      modelsFound: discovered.models.length,
      sampleModels: discovered.models.slice(0, 5)
    });
  } catch (err: any) {
    res.json({
      success: false,
      provider: targetProvider,
      latencyMs: Date.now() - start,
      error: err?.message || 'Failed to reach upstream provider'
    });
  }
});

gatewayApp.post('/api/gateway/sync', (req: Request, res: Response) => {
  const { apiKeys, providerKeys, models, replaceProviderKeys } = req.body || {};

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

  // Only hydrate live-discovered models from Firestore (must carry ownerKeyId from a real admin key)
  if (Array.isArray(models) && masterProviderKeys.length === 0) {
    masterModels.clear();
    if (!replaceProviderKeys) {
      for (const m of models) {
        if (m && m.id && m.ownerKeyId) {
          masterModels.set(m.id, {
            id: m.id,
            name: m.name || formatModelDisplayName(m.id),
            provider: m.provider || 'custom',
            ownerKeyId: m.ownerKeyId,
            ownerKeyHint: m.ownerKeyHint,
            discoveredAt: m.discoveredAt || new Date().toISOString(),
            contextWindow: m.contextWindow,
            description: m.description
          });
        }
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

gatewayApp.get('/api/stats', async (req: Request, res: Response) => {
  await ensureGatewayHydrated(extractFirebaseToken(req));
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
    firestoreBridge: getFirestoreBridgeStatus(),
    logs: masterLogs.slice(0, 50)
  });
});

// ==========================================
// Strict JSON 404 & Global Error Middleware (Prevents HTML/plain-text responses on /api/* & /v1/*)
// ==========================================
gatewayApp.use(['/api', '/v1'], (req: Request, res: Response) => {
  res.status(404).json({ error: `Gateway endpoint not found: ${req.method} ${req.originalUrl}` });
});

gatewayApp.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('[FreeAIModel Gateway Error]', err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({
    error: err?.message || 'Internal gateway server error'
  });
});
