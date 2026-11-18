import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  listCollectionFromRtdb,
  upsertItemInRtdb,
  patchItemInRtdb,
  patchCollectionInRtdb,
  deleteItemFromRtdb,
  findApiKeyBySecretInRtdb,
  syncModelsInRtdb,
  hasServerAdminCredentials,
  getRtdbBridgeStatus,
  verifyFirebaseIdToken
} from './rtdbStore.js';

dotenv.config();

export const gatewayApp = express();

// ==========================================
// Explicit CORS & Preflight Headers for all gateway routes (/v1/*, /api/*, /models)
// ==========================================
gatewayApp.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-api-key, x-user-email, x-user-uid, x-firebase-token, x-dashboard-client'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'x-gateway-provider, x-gateway-model, x-gateway-requested-model, x-gateway-fallback, x-gateway-failover-count, x-gateway-key-hint, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After'
  );
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
// In-memory Runtime Cache (100% backed by Firebase Realtime Database)
// ==========================================
export const masterApiKeys = new Map<string, StoredApiKey>();
export const masterProviderKeys: StoredProviderKey[] = [];
export const masterModels = new Map<string, StoredModel>();
export const masterLogs: StoredRequestLog[] = [];
export const masterUsers = new Map<string, StoredUserAccount>();

let lastHydratedAt = 0;
let hydrationInFlight: Promise<void> | null = null;

function extractFirebaseToken(req: Request): string | undefined {
  const token = req.headers['x-firebase-token'];
  return typeof token === 'string' && token.trim().length > 20 ? token.trim() : undefined;
}

/**
 * Hydrate in-memory stores directly from Firebase Realtime Database on cold starts or TTL expiry.
 * Supports normalized fields across admin/external writers and only updates TTL when RTDB responds.
 */
export async function ensureGatewayHydrated(explicitIdToken?: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && lastHydratedAt > 0 && now - lastHydratedAt < 3_000) return;

  if (hydrationInFlight) {
    await hydrationInFlight;
    return;
  }

  hydrationInFlight = (async () => {
    try {
      const [dbProviderKeys, dbModels, dbApiKeys, dbLogs, dbUsers] = await Promise.all([
        listCollectionFromRtdb<any>('provider_keys', explicitIdToken),
        listCollectionFromRtdb<any>('models', explicitIdToken),
        listCollectionFromRtdb<any>('api_keys', explicitIdToken),
        listCollectionFromRtdb<any>('request_logs', explicitIdToken),
        listCollectionFromRtdb<any>('user_profiles', explicitIdToken)
      ]);

      let anyRtdbSuccess = false;

      if (Array.isArray(dbProviderKeys)) {
        anyRtdbSuccess = true;
        const byId = new Map<string, StoredProviderKey>();
        for (const existing of masterProviderKeys) byId.set(existing.id, existing);
        masterProviderKeys.length = 0;

        for (const rawPk of dbProviderKeys) {
          const rawKeySecret = rawPk?.key || rawPk?.apiKey || rawPk?.secret;
          if (!rawPk?.id || !rawKeySecret) continue;

          const local = byId.get(rawPk.id);
          const rawModels = Array.isArray(rawPk.supportedModels)
            ? rawPk.supportedModels.map((m: any) => String(m).trim()).filter(Boolean)
            : rawPk.supportedModels && typeof rawPk.supportedModels === 'object'
            ? Object.keys(rawPk.supportedModels)
            : [];

          const normalizedStatus: StoredProviderKey['status'] =
            rawPk.status === 'disabled' ||
            rawPk.status === 'exhausted' ||
            rawPk.status === 'rate_limited' ||
            rawPk.status === 'active'
              ? rawPk.status
              : rawPk.isActive === false || rawPk.active === false
              ? 'disabled'
              : 'active';

          const normalizedProvider: SupportedProvider = (rawPk.provider ||
            detectProviderByKey(String(rawKeySecret), rawPk.customBaseUrl)) as SupportedProvider;

          masterProviderKeys.push({
            id: String(rawPk.id),
            provider: normalizedProvider,
            key: String(rawKeySecret).trim(),
            keyHint:
              rawPk.keyHint ||
              (String(rawKeySecret).length > 8
                ? `${String(rawKeySecret).slice(0, 4)}...${String(rawKeySecret).slice(-4)}`
                : String(rawKeySecret)),
            customBaseUrl: normalizeBaseUrl(rawPk.customBaseUrl || rawPk.baseUrl),
            status: normalizedStatus,
            supportedModels: rawModels.length ? rawModels : local?.supportedModels || [],
            requestCount: Number(rawPk.requestCount) || 0,
            errorCount: Number(rawPk.errorCount) || 0,
            lastError: rawPk.lastError,
            cooldownUntil: typeof rawPk.cooldownUntil === 'number' ? rawPk.cooldownUntil : undefined,
            lastUsedAt: rawPk.lastUsedAt,
            createdAt: rawPk.createdAt || new Date().toISOString(),
            updatedAt: rawPk.updatedAt || new Date().toISOString()
          });
        }
      }

      if (Array.isArray(dbModels)) {
        anyRtdbSuccess = true;
        masterModels.clear();
        for (const rawM of dbModels) {
          const modelId = String(rawM?.id || rawM?.modelId || '').trim();
          if (!modelId) continue;
          if (rawM?.isActive === false || rawM?.active === false) continue;

          const inferredProvider =
            rawM?.provider ||
            masterProviderKeys.find((pk) => pk.id === rawM?.ownerKeyId || pk.supportedModels?.includes(modelId))?.provider ||
            'custom';

          masterModels.set(modelId, {
            id: modelId,
            name: String(rawM?.name || formatModelDisplayName(modelId)),
            provider: String(inferredProvider),
            ownerKeyId: rawM?.ownerKeyId ? String(rawM.ownerKeyId) : undefined,
            ownerKeyHint: rawM?.ownerKeyHint ? String(rawM.ownerKeyHint) : undefined,
            contextWindow: typeof rawM?.contextWindow === 'number' ? rawM.contextWindow : undefined,
            pricingPrompt: typeof rawM?.pricingPrompt === 'number' ? rawM.pricingPrompt : undefined,
            pricingCompletion: typeof rawM?.pricingCompletion === 'number' ? rawM.pricingCompletion : undefined,
            activeKeysCount: typeof rawM?.activeKeysCount === 'number' ? rawM.activeKeysCount : undefined,
            isActive: true,
            discoveredAt: rawM?.discoveredAt || new Date().toISOString(),
            updatedAt: rawM?.updatedAt,
            description: rawM?.description
          });
        }
      }

      if (masterProviderKeys.length > 0 && masterModels.size === 0) {
        rebuildMasterModelsFromPool();
      } else if (masterProviderKeys.length > 0) {
        // Ensure any active provider_keys models missing from /models are still routable & listable
        for (const pk of masterProviderKeys) {
          if (pk.status === 'disabled' || !Array.isArray(pk.supportedModels)) continue;
          for (const rawId of pk.supportedModels) {
            const id = String(rawId || '').trim();
            if (!id || masterModels.has(id)) continue;
            masterModels.set(id, {
              id,
              name: formatModelDisplayName(id),
              provider: pk.provider,
              ownerKeyId: pk.id,
              ownerKeyHint: pk.keyHint,
              isActive: true,
              discoveredAt: pk.updatedAt || pk.createdAt || new Date().toISOString()
            });
          }
        }
      }

      if (Array.isArray(dbApiKeys)) {
        anyRtdbSuccess = true;
        masterApiKeys.clear();
        for (const rawAk of dbApiKeys) {
          const keySecret = String(rawAk?.key || rawAk?.apiKey || '').trim();
          if (!keySecret) continue;
          masterApiKeys.set(keySecret, {
            id: String(rawAk.id || `key_${crypto.createHash('sha256').update(keySecret).digest('hex').slice(0, 10)}`),
            userId: String(rawAk.userId || 'usr_developer'),
            name: String(rawAk.name || 'API Key'),
            key: keySecret,
            keyPrefix: String(
              rawAk.keyPrefix ||
                (keySecret.length > 15 ? `${keySecret.slice(0, 11)}...${keySecret.slice(-4)}` : keySecret)
            ),
            status: rawAk.status === 'revoked' || rawAk.active === false ? 'revoked' : 'active',
            totalRequests: Number(rawAk.totalRequests) || 0,
            totalTokens: Number(rawAk.totalTokens) || 0,
            createdAt: rawAk.createdAt || new Date().toISOString(),
            lastUsedAt: rawAk.lastUsedAt
          });
        }
      }

      if (Array.isArray(dbLogs) && dbLogs.length > 0) {
        anyRtdbSuccess = true;
        const sorted = [...dbLogs].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        masterLogs.length = 0;
        masterLogs.push(...sorted.slice(0, 200));
      }

      if (Array.isArray(dbUsers)) {
        anyRtdbSuccess = true;
        for (const u of dbUsers) {
          if (u?.uid) {
            masterUsers.set(u.uid, u);
          }
        }
      }

      if (anyRtdbSuccess) {
        lastHydratedAt = Date.now();
      }
    } catch (err) {
      console.warn('[FreeAIModel] RTDB hydration error:', err);
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
    signal: AbortSignal.timeout(8000)
  });

  // Fallback for Google Gemini native REST /v1beta/models?key=... if OpenAI-compat endpoint rejects
  let usedUrl = primaryUrl;
  if (!response.ok && provider === 'gemini' && !customBaseUrl) {
    const nativeGeminiUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
    const fallbackRes = await fetch(nativeGeminiUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'FreeAIModel-Gateway/1.0' },
      signal: AbortSignal.timeout(8000)
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

async function resolveRegisteredGatewayKey(
  apiKeyToken: string,
  explicitIdToken?: string
): Promise<StoredApiKey | null> {
  const localMatch = masterApiKeys.get(apiKeyToken);
  if (localMatch) return localMatch;

  await ensureGatewayHydrated(explicitIdToken, true);
  const afterHydration = masterApiKeys.get(apiKeyToken);
  if (afterHydration) return afterHydration;

  const dbMatch = await findApiKeyBySecretInRtdb<StoredApiKey>(apiKeyToken, explicitIdToken);
  if (dbMatch && dbMatch.key) {
    masterApiKeys.set(dbMatch.key, dbMatch);
    return dbMatch;
  }

  return null;
}

// ==========================================
// Per-Key / Per-IP Sliding-Window Rate Limiter (60 RPM API key / 30 RPM dashboard)
// ==========================================
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_RPM_PER_API_KEY = Number(process.env.GATEWAY_RPM_LIMIT || 60);
const MAX_RPM_DASHBOARD_SESSION = Number(process.env.DASHBOARD_RPM_LIMIT || 30);
const rateLimitBuckets = new Map<string, number[]>();

function checkAndRecordRateLimit(
  bucketKey: string,
  limit: number
): { allowed: boolean; remaining: number; resetEpochSec: number; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitBuckets.get(bucketKey) || []).filter((ts) => ts > windowStart);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    rateLimitBuckets.set(bucketKey, timestamps);
    return {
      allowed: false,
      remaining: 0,
      resetEpochSec: Math.ceil((oldest + RATE_LIMIT_WINDOW_MS) / 1000),
      retryAfterSec
    };
  }

  timestamps.push(now);
  rateLimitBuckets.set(bucketKey, timestamps);

  if (rateLimitBuckets.size > 2000) {
    const firstKey = rateLimitBuckets.keys().next().value;
    if (firstKey) rateLimitBuckets.delete(firstKey);
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - timestamps.length),
    resetEpochSec: Math.ceil((now + RATE_LIMIT_WINDOW_MS) / 1000),
    retryAfterSec: 0
  };
}

function isTrustedDashboardOrigin(req: Request): boolean {
  const originOrReferer = String(req.headers['origin'] || req.headers['referer'] || '').toLowerCase();
  if (!originOrReferer) return false;
  return (
    originOrReferer.includes('freemodel.cc.cd') ||
    originOrReferer.includes('freeaimodel.cc.cd') ||
    originOrReferer.includes('localhost') ||
    originOrReferer.includes('127.0.0.1') ||
    originOrReferer.includes('.run.app') ||
    originOrReferer.includes('.vercel.app')
  );
}

// ==========================================
// Middleware: Unified Custom API Key & Web Dashboard Auth + Rate Limiting (POST /v1/chat/completions)
// ==========================================
export async function validateGatewayKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const fbToken = extractFirebaseToken(req);
  const apiKeyToken = extractGatewayTokenFromRequest(req);

  let matchedKey: StoredApiKey | null = null;
  let isVirtualDashboardSession = false;

  if (apiKeyToken) {
    // Support Firebase ID token JWT passed directly as Bearer token from dashboard clients
    if (apiKeyToken.split('.').length === 3 && apiKeyToken.length > 80) {
      const fbUser = await verifyFirebaseIdToken(apiKeyToken);
      if (fbUser) {
        await ensureGatewayHydrated(apiKeyToken, masterApiKeys.size === 0);
        matchedKey =
          Array.from(masterApiKeys.values()).find((k) => k.userId === fbUser.uid && k.status === 'active') || {
            id: `dashboard_${fbUser.uid}`,
            userId: fbUser.uid,
            name: 'Web Dashboard Session',
            key: `dashboard_${fbUser.uid}`,
            keyPrefix: 'dashboard-session',
            status: 'active',
            totalRequests: 0,
            totalTokens: 0,
            createdAt: new Date().toISOString()
          };
        isVirtualDashboardSession = matchedKey.id.startsWith('dashboard_');
        (req as any).resolvedFirebaseToken = apiKeyToken;
      }
    }

    // Standard API Key validation against RTDB `api_keys` (accepts sk-gateway-... or any registered RTDB key)
    if (!matchedKey) {
      matchedKey = await resolveRegisteredGatewayKey(apiKeyToken, fbToken);
      if (!matchedKey) {
        res.status(401).json({
          error: {
            message:
              'Invalid or unregistered API key. Generate an active key in your Dashboard or verify Authorization: Bearer <key>.',
            type: 'invalid_request_error',
            code: 'invalid_api_key'
          }
        });
        return;
      }
    }
  } else if (fbToken) {
    // Web Dashboard request authenticated via Firebase ID token header (`x-firebase-token`)
    const fbUser = await verifyFirebaseIdToken(fbToken);
    if (!fbUser) {
      res.status(401).json({
        error: {
          message: 'Expired or invalid dashboard session token. Please refresh and sign in again.',
          type: 'invalid_request_error',
          code: 'invalid_session_token'
        }
      });
      return;
    }
    await ensureGatewayHydrated(fbToken, masterApiKeys.size === 0);
    matchedKey =
      Array.from(masterApiKeys.values()).find((k) => k.userId === fbUser.uid && k.status === 'active') || {
        id: `dashboard_${fbUser.uid}`,
        userId: fbUser.uid,
        name: 'Web Dashboard Session',
        key: `dashboard_${fbUser.uid}`,
        keyPrefix: 'dashboard-session',
        status: 'active',
        totalRequests: 0,
        totalTokens: 0,
        createdAt: new Date().toISOString()
      };
    isVirtualDashboardSession = matchedKey.id.startsWith('dashboard_');
    (req as any).resolvedFirebaseToken = fbToken;
  } else if (isTrustedDashboardOrigin(req) && (req.headers['x-dashboard-client'] || req.headers['x-user-uid'])) {
    // Fallback for signed-in web dashboard user on portal origin when an API key isn't manually entered
    const rawUid = String(req.headers['x-user-uid'] || '').trim();
    if (rawUid) {
      await ensureGatewayHydrated(undefined, masterUsers.size === 0);
      const userExists = masterUsers.has(rawUid) || Array.from(masterApiKeys.values()).some((k) => k.userId === rawUid);
      if (userExists) {
        matchedKey =
          Array.from(masterApiKeys.values()).find((k) => k.userId === rawUid && k.status === 'active') || {
            id: `dashboard_${rawUid}`,
            userId: rawUid,
            name: 'Web Dashboard Session',
            key: `dashboard_${rawUid}`,
            keyPrefix: 'dashboard-session',
            status: 'active',
            totalRequests: 0,
            totalTokens: 0,
            createdAt: new Date().toISOString()
          };
        isVirtualDashboardSession = matchedKey.id.startsWith('dashboard_');
      }
    }
  }

  if (!matchedKey) {
    res.status(401).json({
      error: {
        message: 'Missing Authorization key. Expected "Authorization: Bearer sk-gateway-..." or authenticated Web Dashboard session.',
        type: 'invalid_request_error',
        code: 'missing_api_key'
      }
    });
    return;
  }

  if (matchedKey.status !== 'active') {
    res.status(403).json({
      error: {
        message: 'Your API key has been revoked or suspended.',
        type: 'permission_denied',
        code: 'key_revoked'
      }
    });
    return;
  }

  // Sliding-window rate limiting
  const rpmLimit = isVirtualDashboardSession ? MAX_RPM_DASHBOARD_SESSION : MAX_RPM_PER_API_KEY;
  const rl = checkAndRecordRateLimit(matchedKey.id, rpmLimit);
  res.setHeader('X-RateLimit-Limit', String(rpmLimit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  res.setHeader('X-RateLimit-Reset', String(rl.resetEpochSec));

  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfterSec));
    res.status(429).json({
      error: {
        message: `Rate limit exceeded (${rpmLimit} requests/minute). Retry after ${rl.retryAfterSec}s.`,
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded'
      }
    });
    return;
  }

  // Daily free credit quota check for registered user profile
  const userAccount = masterUsers.get(matchedKey.userId);
  if (userAccount) {
    ensureDailyCreditsReset(userAccount);
    if ((userAccount.freeCreditsSpent || 0) >= (userAccount.freeCreditsAllocated || DAILY_FREE_CREDITS)) {
      res.status(429).json({
        error: {
          message: 'Daily free credit limit reached. Credits reset automatically at 00:00 UTC.',
          type: 'insufficient_quota',
          code: 'daily_quota_exceeded'
        }
      });
      return;
    }
  }

  (req as any).gatewayKey = matchedKey;
  (req as any).isVirtualDashboardSession = isVirtualDashboardSession;
  next();
}

// ==========================================
// Middleware: Flexible Auth for Model Listing (GET /v1/models & GET /models)
// - If an API key IS supplied, verifies it strictly against registered database keys.
// - If NO API key is supplied, allows public OpenAI-compatible model catalog discovery.
// ==========================================
export async function optionalFlexibleGatewayAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const fbToken = extractFirebaseToken(req);
  const apiKeyToken = extractGatewayTokenFromRequest(req);
  if (!apiKeyToken) {
    next();
    return;
  }

  const matchedKey = await resolveRegisteredGatewayKey(apiKeyToken, fbToken);
  if (!matchedKey) {
    res.status(401).json({
      error: {
        message: 'Invalid or unregistered API key.',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
    return;
  }

  if (matchedKey.status !== 'active') {
    res.status(403).json({
      error: {
        message: 'Your API key has been revoked or suspended.',
        type: 'permission_denied',
        code: 'key_revoked'
      }
    });
    return;
  }

  (req as any).gatewayKey = matchedKey;
  next();
}

function buildSingleOpenAiModel(m: StoredModel, createdTs = Math.floor(Date.now() / 1000)) {
  return {
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
  };
}

function buildOpenAiModelsList() {
  const createdTs = Math.floor(Date.now() / 1000);
  const items = Array.from(masterModels.values())
    .filter((m) => m && m.id && m.isActive !== false)
    .map((m) => buildSingleOpenAiModel(m, createdTs));
  return {
    object: 'list',
    data: items
  };
}

async function ensureLiveModelsDiscoveredFromPool(explicitIdToken?: string): Promise<void> {
  const activePool = masterProviderKeys.filter(k => k.status !== 'disabled');
  if (activePool.length === 0) return;

  if (masterModels.size === 0) {
    rebuildMasterModelsFromPool();
  }

  // Discover live upstream models for any active key that has an empty supportedModels list
  const keysNeedingDiscovery = activePool.filter(
    k => (!Array.isArray(k.supportedModels) || k.supportedModels.length === 0) && !isMaskedOrInvalidHeaderKey(k.key)
  );
  if (keysNeedingDiscovery.length === 0) return;

  const CONCURRENCY = 6;
  const updatedKeys: Record<string, StoredProviderKey> = {};
  for (let i = 0; i < keysNeedingDiscovery.length; i += CONCURRENCY) {
    await Promise.all(
      keysNeedingDiscovery.slice(i, i + CONCURRENCY).map(async (pKey) => {
        try {
          const discovered = await fetchUpstreamModels(pKey.provider, pKey.key, pKey.customBaseUrl, pKey.id, pKey.keyHint);
          pKey.supportedModels = discovered;
          pKey.updatedAt = new Date().toISOString();
          updatedKeys[pKey.id] = pKey;
        } catch {
          // Leave existing key record untouched on transient network error
        }
      })
    );
  }
  rebuildMasterModelsFromPool();
  if (Object.keys(updatedKeys).length > 0) {
    await Promise.all([
      patchCollectionInRtdb('provider_keys', updatedKeys, explicitIdToken),
      syncModelsInRtdb(Array.from(masterModels.values()), explicitIdToken)
    ]).catch(() => {});
  }
}

// ==========================================
// Public / Frontend Dashboard Model Catalog Endpoint (100% live models only)
// ==========================================
gatewayApp.get('/api/models', async (req: Request, res: Response) => {
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken, masterProviderKeys.length === 0 || masterModels.size === 0);
  await ensureLiveModelsDiscoveredFromPool(fbToken);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(buildOpenAiModelsList());
});

// ==========================================
// Route: GET /v1/models, GET /v1/models/:modelId & GET /models
// ==========================================
gatewayApp.get('/v1/models', optionalFlexibleGatewayAuth, async (req: Request, res: Response) => {
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken, masterProviderKeys.length === 0 || masterModels.size === 0);
  await ensureLiveModelsDiscoveredFromPool(fbToken);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(buildOpenAiModelsList());
});

gatewayApp.get('/v1/models/:modelId', optionalFlexibleGatewayAuth, async (req: Request, res: Response) => {
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken, masterProviderKeys.length === 0 || masterModels.size === 0);
  await ensureLiveModelsDiscoveredFromPool(fbToken);

  const requestedId = String(req.params.modelId || '').trim();
  const match =
    masterModels.get(requestedId) ||
    Array.from(masterModels.values()).find((m) => m.id.toLowerCase() === requestedId.toLowerCase()) ||
    Array.from(masterModels.values()).find((m) => !NON_CHAT_MODEL_RE.test(m.id));

  if (!match) {
    res.status(404).json({
      error: {
        message: `No active models found for '${requestedId}'.`,
        type: 'invalid_request_error',
        code: 'model_not_found'
      }
    });
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(buildSingleOpenAiModel({ ...match, id: requestedId }));
});

gatewayApp.get('/models', optionalFlexibleGatewayAuth, async (req: Request, res: Response, next: NextFunction) => {
  const hasExplicitKey = Boolean(extractGatewayTokenFromRequest(req));
  const acceptHeader = String(req.headers['accept'] || '').toLowerCase();
  const isBrowserHtmlNav = acceptHeader.includes('text/html') && !acceptHeader.includes('application/json') && !hasExplicitKey;

  if (isBrowserHtmlNav) {
    next();
    return;
  }

  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken, masterProviderKeys.length === 0 || masterModels.size === 0);
  await ensureLiveModelsDiscoveredFromPool(fbToken);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(buildOpenAiModelsList());
});

// ==========================================
// Route: POST /v1/chat/completions (OpenAI-compatible Universal Router + Limit-Shift Failover)
// ==========================================
const NON_CHAT_MODEL_RE =
  /realtime|tts|whisper|transcribe|image|dall-e|sora|embedding|moderation|gpt-audio|gpt-live|diarize|babbage|davinci|chat-latest/i;
const REASONING_OR_GPT5_RE = /^((gpt-5)|o[134])(-|$)/i;
const DEFAULT_PROVIDER_CHAT_MODEL: Record<string, string> = {
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-small-latest',
  cerebras: 'llama-3.3-70b',
  inception: 'mercury',
  anthropic: 'claude-3-5-sonnet-latest',
  custom: 'gpt-4o-mini'
};
const PREFERRED_CHAT_IDS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4.1',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openrouter/free',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'deepseek-chat',
  'mercury',
  'gpt-5-mini',
  'gpt-5'
];

let roundRobinCursor = 0;

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
  return /insufficient_quota|exceeded your current quota|billing_not_active|credit balance|out of credits|payment required|quota.*exceeded/i.test(
    bodyText
  );
}

function isModelSpecificError(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status === 400 && /model|not found|does not exist|unsupported|not a chat model|max_tokens|temperature/i.test(bodyText)) {
    return true;
  }
  return false;
}

function estimatePromptTokensFromMessages(messages: any[]): number {
  try {
    return Math.max(8, Math.ceil(JSON.stringify(messages).length / 4));
  } catch {
    return 16;
  }
}

function convertAnthropicSseLineToOpenAi(
  line: string,
  completionId: string,
  modelId: string
): { sseChunk?: string; deltaChars?: number; inputTokens?: number; outputTokens?: number } {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return {};
  const payloadStr = trimmed.slice(5).trim();
  if (!payloadStr || payloadStr === '[DONE]') return {};

  try {
    const evt = JSON.parse(payloadStr);
    if (evt?.type === 'message_start' && evt?.message?.usage?.input_tokens) {
      return { inputTokens: Number(evt.message.usage.input_tokens) || undefined };
    }
    if (evt?.type === 'content_block_delta' && evt?.delta?.text) {
      const textChunk = String(evt.delta.text);
      const openAiFrame = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, delta: { content: textChunk }, finish_reason: null }]
      };
      return {
        sseChunk: `data: ${JSON.stringify(openAiFrame)}\n\n`,
        deltaChars: textChunk.length
      };
    }
    if (evt?.type === 'message_delta') {
      const outputTokens = evt?.usage?.output_tokens ? Number(evt.usage.output_tokens) : undefined;
      const openAiFrame = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: evt?.delta?.stop_reason === 'end_turn' ? 'stop' : 'stop' }]
      };
      return { sseChunk: `data: ${JSON.stringify(openAiFrame)}\n\n`, outputTokens };
    }
  } catch {
    // Ignore non-JSON ping frames
  }
  return {};
}

const handleChatCompletions = async (req: Request, res: Response) => {
  const startTime = Date.now();
  const apiKeyRecord: StoredApiKey = (req as any).gatewayKey;
  const isVirtualDashboardSession = Boolean((req as any).isVirtualDashboardSession);
  const fbToken = (req as any).resolvedFirebaseToken || extractFirebaseToken(req);

  const {
    model,
    messages,
    stream,
    temperature,
    max_tokens,
    max_completion_tokens,
    top_p,
    stop,
    presence_penalty,
    frequency_penalty,
    tools,
    tool_choice,
    response_format
  } = req.body || {};

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

  await ensureGatewayHydrated(fbToken, masterProviderKeys.length === 0 || masterModels.size === 0);
  if (masterModels.size === 0 && masterProviderKeys.length > 0) {
    await ensureLiveModelsDiscoveredFromPool(fbToken);
  }

  const now = Date.now();
  const dirtyProviderKeys = new Set<StoredProviderKey>();

  // Recover expired 429 cooldowns and build healthy active key pool
  const availableKeys = masterProviderKeys.filter((k) => {
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

  const requestedModelRaw = typeof model === 'string' && model.trim() ? model.trim() : 'auto';

  const findKeysForModel = (targetModelId: string, targetRecord?: StoredModel, keyPool = availableKeys) => {
    const targetProvider = targetRecord?.provider;
    const keys = keyPool.filter((k) => {
      const ownsModel =
        (Array.isArray(k.supportedModels) && k.supportedModels.includes(targetModelId)) ||
        (targetRecord?.ownerKeyId && k.id === targetRecord.ownerKeyId);
      const sameProvider = Boolean(targetProvider && k.provider === targetProvider);
      return ownsModel || sameProvider;
    });

    // Load-balanced sorting: model owner -> fewest errors -> round-robin + least recently used
    const cursor = roundRobinCursor++ % Math.max(1, keys.length);
    keys.sort((a, b) => {
      const aOwns = a.supportedModels?.includes(targetModelId) || a.id === targetRecord?.ownerKeyId ? 1 : 0;
      const bOwns = b.supportedModels?.includes(targetModelId) || b.id === targetRecord?.ownerKeyId ? 1 : 0;
      if (aOwns !== bOwns) return bOwns - aOwns;

      const errDiff = (a.errorCount || 0) - (b.errorCount || 0);
      if (errDiff !== 0) return errDiff;

      const aLast = a.lastUsedAt ? Date.parse(a.lastUsedAt) || 0 : 0;
      const bLast = b.lastUsedAt ? Date.parse(b.lastUsedAt) || 0 : 0;
      if (aLast !== bLast) return aLast - bLast;

      return (a.requestCount || 0) - (b.requestCount || 0);
    });

    // Apply round-robin rotation across tied lowest-error keys so traffic distributes evenly
    if (keys.length > 1 && cursor > 0 && (keys[0].errorCount || 0) === (keys[cursor].errorCount || 0)) {
      const rotated = [...keys.slice(cursor), ...keys.slice(0, cursor)];
      return rotated;
    }
    return keys;
  };

  const buildRoutableCatalogEntries = (keyPool: StoredProviderKey[]): Array<{ id: string; record: StoredModel }> => {
    const entries: Array<{ id: string; record: StoredModel }> = [];
    const seen = new Set<string>();

    for (const m of masterModels.values()) {
      if (findKeysForModel(m.id, m, keyPool).length > 0) {
        entries.push({ id: m.id, record: m });
        seen.add(m.id);
      }
    }

    for (const k of keyPool) {
      if (!Array.isArray(k.supportedModels)) continue;
      for (const rawId of k.supportedModels) {
        const id = String(rawId).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        entries.push({
          id,
          record:
            masterModels.get(id) || {
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
    return entries;
  };

  const pickChatModelForPool = (
    keyPool: StoredProviderKey[],
    excludedModels = new Set<string>()
  ): { id: string; record: StoredModel } | undefined => {
    const routableEntries = buildRoutableCatalogEntries(keyPool).filter((e) => !excludedModels.has(e.id));
    if (routableEntries.length === 0) return undefined;

    for (const preferredId of PREFERRED_CHAT_IDS) {
      const match = routableEntries.find((entry) => entry.id.toLowerCase() === preferredId);
      if (match) return match;
    }
    return routableEntries.find((entry) => !NON_CHAT_MODEL_RE.test(entry.id)) || routableEntries[0];
  };

  // Resolve requested model (handle 'auto'/'default', exact match, case-insensitive, or fallback)
  let effectiveModel = requestedModelRaw;
  let usedFallbackModel = false;
  let modelRecord: StoredModel | undefined;

  if (requestedModelRaw.toLowerCase() !== 'auto' && requestedModelRaw.toLowerCase() !== 'default') {
    modelRecord = masterModels.get(effectiveModel);
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

    // If requested model wasn't in warm cache (e.g. just added in Admin Panel), force live RTDB refresh immediately
    if (!modelRecord) {
      await ensureGatewayHydrated(fbToken, true);
      availableKeys.length = 0;
      for (const k of masterProviderKeys) {
        if (k.status === 'disabled' || k.status === 'exhausted') continue;
        if (k.status === 'rate_limited') {
          if (k.cooldownUntil && k.cooldownUntil > now) continue;
          k.status = 'active';
          k.cooldownUntil = undefined;
          k.updatedAt = new Date().toISOString();
          dirtyProviderKeys.add(k);
        }
        if (!isMaskedOrInvalidHeaderKey(k.key)) availableKeys.push(k);
      }
      modelRecord = masterModels.get(effectiveModel);
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
    }
  }

  let candidateKeys =
    requestedModelRaw.toLowerCase() === 'auto' || requestedModelRaw.toLowerCase() === 'default'
      ? []
      : findKeysForModel(effectiveModel, modelRecord);

  // If requested model isn't matched or caller passed 'auto', pick best chat-capable active model
  if (candidateKeys.length === 0 && availableKeys.length > 0) {
    const picked = pickChatModelForPool(availableKeys);
    if (picked) {
      if (requestedModelRaw.toLowerCase() !== 'auto' && requestedModelRaw.toLowerCase() !== 'default') {
        usedFallbackModel = true;
      }
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
  let promptTokens = estimatePromptTokensFromMessages(messages);
  let completionTokens = 0;
  let totalTokensOverride: number | undefined;
  let pendingResponseAction: (() => void) | null = null;

  const triedPairs = new Set<string>();
  const triedModels = new Set<string>();

  const buildUpstreamPayload = (providerKey: StoredProviderKey, modelToUse: string, omitOptionalParams = false) => {
    const isAnthropic = providerKey.provider === 'anthropic';
    if (isAnthropic) {
      const sysMsgs = messages
        .filter((m: any) => m.role === 'system')
        .map((m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const nonSysMsgs = messages
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }));
      const payload: any = {
        model: modelToUse,
        messages: nonSysMsgs.length > 0 ? nonSysMsgs : [{ role: 'user', content: sysMsgs || 'Hello' }],
        max_tokens: max_completion_tokens ?? max_tokens ?? 2048,
        stream: Boolean(stream)
      };
      if (!omitOptionalParams && temperature !== undefined) payload.temperature = temperature;
      if (sysMsgs && nonSysMsgs.length > 0) payload.system = sysMsgs;
      return payload;
    }

    const isReasoningOrGpt5 = providerKey.provider === 'openai' && REASONING_OR_GPT5_RE.test(modelToUse);
    const payload: any = {
      model: modelToUse,
      messages,
      stream: Boolean(stream)
    };

    if (!omitOptionalParams) {
      if (isReasoningOrGpt5) {
        const cap = max_completion_tokens ?? max_tokens;
        if (cap !== undefined && cap !== null) payload.max_completion_tokens = cap;
      } else {
        if (temperature !== undefined && temperature !== null) payload.temperature = temperature;
        if (max_tokens !== undefined && max_tokens !== null) payload.max_tokens = max_tokens;
        if (max_completion_tokens !== undefined && max_completion_tokens !== null) payload.max_completion_tokens = max_completion_tokens;
        if (top_p !== undefined && top_p !== null) payload.top_p = top_p;
      }
      if (stop !== undefined && stop !== null) payload.stop = stop;
      if (presence_penalty !== undefined && presence_penalty !== null && !isReasoningOrGpt5) {
        payload.presence_penalty = presence_penalty;
      }
      if (frequency_penalty !== undefined && frequency_penalty !== null && !isReasoningOrGpt5) {
        payload.frequency_penalty = frequency_penalty;
      }
      if (tools !== undefined && tools !== null) payload.tools = tools;
      if (tool_choice !== undefined && tool_choice !== null) payload.tool_choice = tool_choice;
      if (response_format !== undefined && response_format !== null) payload.response_format = response_format;
      if (stream && (providerKey.provider === 'openai' || providerKey.provider === 'groq')) {
        payload.stream_options = { include_usage: true };
      }
    }

    return payload;
  };

  const executeUpstreamAttempt = async (providerKey: StoredProviderKey, modelToUse: string): Promise<boolean> => {
    const pairId = `${providerKey.id}::${modelToUse}`;
    if (triedPairs.has(pairId)) return false;
    triedPairs.add(pairId);
    triedModels.add(modelToUse);

    const baseUrl = resolveProviderBaseUrl(providerKey.provider, providerKey.customBaseUrl);
    const isAnthropic = providerKey.provider === 'anthropic';
    const chatPath = isAnthropic ? '/messages' : PROVIDER_CONFIGS[providerKey.provider]?.chatPath || '/chat/completions';
    const endpoint = `${baseUrl}${chatPath}`;

    try {
      providerKey.requestCount = (providerKey.requestCount || 0) + 1;
      providerKey.lastUsedAt = new Date().toISOString();
      providerKey.updatedAt = new Date().toISOString();
      dirtyProviderKeys.add(providerKey);

      const headers: Record<string, string> = isAnthropic
        ? {
            'Content-Type': 'application/json',
            'x-api-key': providerKey.key,
            'anthropic-version': '2023-06-01',
            'User-Agent': 'FreeAIModel-Gateway/1.0'
          }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${providerKey.key}`,
            'User-Agent': 'FreeAIModel-Gateway/1.0',
            ...(providerKey.provider === 'openrouter'
              ? { 'HTTP-Referer': 'https://freeaimodel.cc.cd', 'X-Title': 'FreeAIModel Gateway' }
              : {})
          };

      let upstreamPayload = buildUpstreamPayload(providerKey, modelToUse, false);
      let upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamPayload),
        signal: AbortSignal.timeout(45000)
      });

      // Retry once cleanly with stripped optional params if upstream returned 400 specifically for unsupported parameter
      if (upstreamResponse.status === 400) {
        const previewErr = await upstreamResponse.text().catch(() => '');
        if (/unsupported parameter|unsupported value|stream_options|max_tokens|temperature|top_p/i.test(previewErr)) {
          upstreamPayload = buildUpstreamPayload(providerKey, modelToUse, true);
          upstreamResponse = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(upstreamPayload),
            signal: AbortSignal.timeout(45000)
          });
        } else {
          // Restore error handling cleanly with already-read previewErr
          failoverCount++;
          lastErrorStatus = 400;
          lastErrorMsg = previewErr || 'Bad request';
          providerKey.errorCount = (providerKey.errorCount || 0) + 1;
          providerKey.lastError = `HTTP 400 (${modelToUse}): ${previewErr.slice(0, 150)}`;
          return false;
        }
      }

      if (upstreamResponse.status === 429) {
        failoverCount++;
        lastErrorStatus = 429;
        const errBody = await upstreamResponse.text().catch(() => 'Rate limit exceeded');
        lastErrorMsg = errBody;
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;

        if (isQuotaExhaustedError(429, errBody)) {
          providerKey.status = 'exhausted';
          providerKey.lastError = `Quota exhausted (429): ${errBody.slice(0, 140)}`;
        } else {
          const cooldownMs = parseRetryAfterMs(upstreamResponse.headers.get('retry-after'));
          providerKey.status = 'rate_limited';
          providerKey.cooldownUntil = Date.now() + cooldownMs;
          providerKey.lastError = `Rate limit 429 hit at ${new Date().toLocaleTimeString()} (auto-rotated)`;
        }
        return false;
      }

      if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
        failoverCount++;
        lastErrorStatus = upstreamResponse.status;
        const errBody = await upstreamResponse.text().catch(() => 'Unauthorized key');
        lastErrorMsg = errBody;
        providerKey.status = 'disabled';
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;
        providerKey.lastError = `Auth error (${upstreamResponse.status}): ${errBody.slice(0, 140)}`;
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
        } else if (isModelSpecificError(upstreamResponse.status, errorBody)) {
          // Model unavailable on this key — keep key active so it can handle fallback models
          providerKey.lastError = `Model ${modelToUse} rejected (${upstreamResponse.status}): ${errorBody.slice(0, 120)}`;
        } else {
          providerKey.lastError = `HTTP ${upstreamResponse.status}: ${errorBody.slice(0, 150)}`;
        }
        return false;
      }

      if (stream && upstreamResponse.body) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('x-gateway-provider', providerKey.provider);
        res.setHeader('x-gateway-model', modelToUse);
        res.setHeader('x-gateway-requested-model', requestedModelRaw);
        res.setHeader('x-gateway-fallback', usedFallbackModel ? 'true' : 'false');
        res.setHeader('x-gateway-failover-count', String(failoverCount));
        res.setHeader('x-gateway-key-hint', providerKey.keyHint);
        res.flushHeaders?.();

        const reader = upstreamResponse.body.getReader();
        const decoder = new TextDecoder();
        const streamId = 'chatcmpl-' + Math.random().toString(36).substring(2, 10);
        let sseBuffer = '';
        let streamedChars = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });

          if (isAnthropic) {
            sseBuffer += chunk;
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';
            for (const line of lines) {
              const converted = convertAnthropicSseLineToOpenAi(line, streamId, modelToUse);
              if (converted.inputTokens) promptTokens = converted.inputTokens;
              if (converted.outputTokens) completionTokens = converted.outputTokens;
              if (converted.deltaChars) streamedChars += converted.deltaChars;
              if (converted.sseChunk) res.write(converted.sseChunk);
            }
          } else {
            res.write(chunk);
            streamedChars += chunk.length;
            // Sniff usage frame if provider emits stream_options usage
            for (const line of chunk.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue;
              try {
                const parsed = JSON.parse(trimmed.slice(5).trim());
                if (parsed?.usage) {
                  if (typeof parsed.usage.prompt_tokens === 'number') promptTokens = parsed.usage.prompt_tokens;
                  if (typeof parsed.usage.completion_tokens === 'number') {
                    completionTokens = parsed.usage.completion_tokens;
                  }
                  if (typeof parsed.usage.total_tokens === 'number') totalTokensOverride = parsed.usage.total_tokens;
                }
              } catch {
                // Ignore partial SSE JSON lines split across chunks
              }
            }
          }
        }

        const remaining = decoder.decode();
        if (remaining) {
          if (isAnthropic) {
            for (const line of (sseBuffer + remaining).split('\n')) {
              const converted = convertAnthropicSseLineToOpenAi(line, streamId, modelToUse);
              if (converted.sseChunk) res.write(converted.sseChunk);
            }
            res.write('data: [DONE]\n\n');
          } else {
            res.write(remaining);
            streamedChars += remaining.length;
          }
        } else if (isAnthropic) {
          res.write('data: [DONE]\n\n');
        }

        if (completionTokens === 0) {
          completionTokens = Math.max(8, Math.round(streamedChars / (isAnthropic ? 4 : 16)));
        }
        providerUsed = providerKey.provider;
        providerKey.status = 'active';
        providerKey.cooldownUntil = undefined;
        providerKey.lastError = undefined;
        effectiveModel = modelToUse;
        pendingResponseAction = () => {
          if (!res.writableEnded) res.end();
        };
        return true;
      }

      let data: any = await upstreamResponse.json();
      providerUsed = providerKey.provider;
      providerKey.status = 'active';
      providerKey.cooldownUntil = undefined;
      providerKey.lastError = undefined;
      effectiveModel = modelToUse;

      if (isAnthropic && data.content) {
        const text = Array.isArray(data.content) ? data.content.map((c: any) => c.text || '').join('') : '';
        const pTok = Number(data.usage?.input_tokens) || promptTokens;
        const cTok = Number(data.usage?.output_tokens) || Math.max(10, Math.round(text.length / 4));
        data = {
          id: data.id || 'chatcmpl-' + Math.random().toString(36).substring(2, 10),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: modelToUse,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason || 'stop'
            }
          ],
          usage: {
            prompt_tokens: pTok,
            completion_tokens: cTok,
            total_tokens: pTok + cTok
          }
        };
      }

      if (data.usage) {
        if (typeof data.usage.prompt_tokens === 'number') promptTokens = data.usage.prompt_tokens;
        if (typeof data.usage.completion_tokens === 'number') completionTokens = data.usage.completion_tokens;
        if (typeof data.usage.total_tokens === 'number') totalTokensOverride = data.usage.total_tokens;
      } else {
        const content = data.choices?.[0]?.message?.content || '';
        completionTokens = Math.max(8, Math.round(content.length / 4));
      }

      const finalTotalTok = totalTokensOverride ?? promptTokens + completionTokens;
      data.gateway_meta = {
        provider_used: providerKey.provider,
        requested_model: requestedModelRaw,
        routed_model: modelToUse,
        fallback_routed: usedFallbackModel,
        failover_count: failoverCount,
        key_hint: providerKey.keyHint,
        latency_ms: Date.now() - startTime,
        cost_usd: promptTokens * 0.000002 + completionTokens * 0.000006,
        total_tokens: finalTotalTok
      };

      pendingResponseAction = () => {
        res.setHeader('x-gateway-provider', providerKey.provider);
        res.setHeader('x-gateway-model', modelToUse);
        res.setHeader('x-gateway-requested-model', requestedModelRaw);
        res.setHeader('x-gateway-fallback', usedFallbackModel ? 'true' : 'false');
        res.setHeader('x-gateway-failover-count', String(failoverCount));
        res.setHeader('x-gateway-key-hint', providerKey.keyHint);
        res.json(data);
      };
      return true;
    } catch (err: any) {
      failoverCount++;
      providerKey.errorCount = (providerKey.errorCount || 0) + 1;
      providerKey.lastError = String(err?.message || 'Network or timeout error').slice(0, 500);
      lastErrorMsg = providerKey.lastError;
      return false;
    }
  };

  // Stage 1: Try all load-balanced active keys matching the requested model / provider
  for (const providerKey of candidateKeys) {
    if (await executeUpstreamAttempt(providerKey, effectiveModel)) {
      success = true;
      break;
    }
  }

  // Stage 2: Smart Multi-Tier Fallback — automatically route to ANY healthy active provider/model (Groq, OpenRouter, Gemini, etc.)
  if (!success && availableKeys.length > 0) {
    const primaryProvidersTried = new Set(candidateKeys.map((k) => k.provider));
    const healthyPool = masterProviderKeys.filter(
      (k) => k.status === 'active' && !isMaskedOrInvalidHeaderKey(k.key)
    );

    // Tier 2A: Prioritize healthy keys from alternate working providers (e.g. Groq, OpenRouter, Gemini, DeepSeek)
    const otherProviderKeys = healthyPool
      .filter((k) => !primaryProvidersTried.has(k.provider))
      .sort((a, b) => (a.errorCount || 0) - (b.errorCount || 0));
    // Tier 2B: Remaining active keys (alternate chat-capable models on same provider)
    const sameProviderRemainingKeys = healthyPool
      .filter((k) => primaryProvidersTried.has(k.provider))
      .sort((a, b) => (a.errorCount || 0) - (b.errorCount || 0));

    const orderedFallbackKeys = [...otherProviderKeys, ...sameProviderRemainingKeys];
    const MAX_FALLBACK_ATTEMPTS = Math.max(20, orderedFallbackKeys.length * 2);
    let fallbackAttempts = 0;

    for (const backupKey of orderedFallbackKeys) {
      if (fallbackAttempts >= MAX_FALLBACK_ATTEMPTS) break;
      if (backupKey.status !== 'active') continue;

      // Auto-discover supported models on-the-fly if a manually inserted active key had empty supportedModels
      if (!Array.isArray(backupKey.supportedModels) || backupKey.supportedModels.length === 0) {
        try {
          const discovered = await fetchUpstreamModels(
            backupKey.provider,
            backupKey.key,
            backupKey.customBaseUrl,
            backupKey.id,
            backupKey.keyHint,
            true
          );
          if (discovered.length > 0) {
            backupKey.supportedModels = discovered;
            backupKey.updatedAt = new Date().toISOString();
            dirtyProviderKeys.add(backupKey);
          }
        } catch {
          // Fall back to provider's known default chat model below
        }
      }

      const pickedForKey = pickChatModelForPool([backupKey], triedModels);
      const fallbackModel =
        pickedForKey?.id ||
        backupKey.supportedModels?.find((id) => !NON_CHAT_MODEL_RE.test(id) && !triedModels.has(id)) ||
        backupKey.supportedModels?.find((id) => !NON_CHAT_MODEL_RE.test(id)) ||
        DEFAULT_PROVIDER_CHAT_MODEL[backupKey.provider] ||
        'gpt-4o-mini';

      if (triedPairs.has(`${backupKey.id}::${fallbackModel}`)) continue;

      usedFallbackModel = true;
      fallbackAttempts++;
      if (await executeUpstreamAttempt(backupKey, fallbackModel)) {
        success = true;
        break;
      }
    }
  }

  const totalTokens = totalTokensOverride ?? promptTokens + completionTokens;
  const cost = promptTokens * 0.000002 + completionTokens * 0.000006;

  // Build RTDB persistence promises and await cleanly (with bounded timeout) before closing response
  const dbOps: Array<Promise<any>> = [];

  if (dirtyProviderKeys.size > 0) {
    const dirtyPatch: Record<string, StoredProviderKey> = {};
    for (const pk of dirtyProviderKeys) dirtyPatch[pk.id] = pk;
    dbOps.push(patchCollectionInRtdb('provider_keys', dirtyPatch, fbToken).catch(() => false));
  }

  if (success) {
    apiKeyRecord.totalRequests = (apiKeyRecord.totalRequests || 0) + 1;
    apiKeyRecord.totalTokens = (apiKeyRecord.totalTokens || 0) + totalTokens;
    apiKeyRecord.lastUsedAt = new Date().toISOString();

    const logEntry: StoredRequestLog = {
      id: 'log_' + crypto.randomBytes(5).toString('hex'),
      userId: apiKeyRecord.userId,
      apiKeyId: apiKeyRecord.id,
      model: requestedModelRaw,
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
      dbOps.push(
        patchItemInRtdb(
          'user_profiles',
          userAccount.uid,
          {
            freeCreditsSpent: userAccount.freeCreditsSpent,
            lastResetDate: userAccount.lastResetDate,
            updatedAt: userAccount.updatedAt
          },
          fbToken
        ).catch(() => false)
      );
    }

    if (!isVirtualDashboardSession) {
      dbOps.push(
        patchItemInRtdb(
          'api_keys',
          apiKeyRecord.id,
          {
            totalRequests: apiKeyRecord.totalRequests,
            totalTokens: apiKeyRecord.totalTokens,
            lastUsedAt: apiKeyRecord.lastUsedAt
          },
          fbToken
        ).catch(() => false)
      );
    }
    dbOps.push(upsertItemInRtdb('request_logs', logEntry.id, logEntry, fbToken).catch(() => false));
  }

  if (dbOps.length > 0) {
    await Promise.race([
      Promise.allSettled(dbOps),
      new Promise<void>((resolve) => setTimeout(resolve, 2500))
    ]);
  }

  if (!success) {
    const statusToSend = candidateKeys.length === 0 && availableKeys.length === 0
      ? 503
      : candidateKeys.length === 0 && failoverCount === 0
      ? 404
      : lastErrorStatus >= 400
      ? lastErrorStatus
      : 502;

    const errorMessage =
      availableKeys.length === 0
        ? `No active Admin Pool provider keys are currently healthy to serve "${requestedModelRaw}". Add or reset provider keys in the Admin Panel (/admin).`
        : `Upstream request for "${effectiveModel}" failed after rotating across ${failoverCount} key/model attempt(s): ${lastErrorMsg.slice(0, 260)}`;

    if (!res.headersSent) {
      res.status(statusToSend).json({
        error: {
          message: errorMessage,
          type: statusToSend === 429 ? 'rate_limit_error' : statusToSend === 404 ? 'model_not_found' : 'gateway_upstream_error',
          code: statusToSend === 429 ? 'upstream_rate_limited' : statusToSend === 404 ? 'model_not_found' : 'upstream_failed',
          requested_model: requestedModelRaw,
          routed_model: effectiveModel,
          failover_count: failoverCount
        }
      });
    } else if (!res.writableEnded) {
      res.end();
    }
    return;
  }

  if (pendingResponseAction) {
    pendingResponseAction();
  }
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
    ensureDailyCreditsReset(account);
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
// User Gateway API Keys CRUD (/api/keys) — Persisted to Firebase RTDB
// ==========================================
gatewayApp.get('/api/keys', async (req: Request, res: Response) => {
  await ensureGatewayHydrated(extractFirebaseToken(req), masterApiKeys.size === 0);
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

    const persistedToDb = await upsertItemInRtdb('api_keys', newKey.id, newKey, fbToken);

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

  await deleteItemFromRtdb('api_keys', id, fbToken);

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

    const processSingleKey = async (rawKey: string) => {
      const targetProvider: SupportedProvider =
        !isAutoProvider
          ? (provider as SupportedProvider)
          : detectProviderByKey(rawKey, normalizedCustomUrl);

      const hint = (rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : rawKey).slice(0, 32);
      const deterministicId = 'pk_' + crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
      const existingRecord = masterProviderKeys.find(k => k.key === rawKey || k.id === deterministicId);
      const keyId = existingRecord ? existingRecord.id : deterministicId;

      const nowIso = new Date().toISOString();
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
        createdAt: nowIso,
        updatedAt: nowIso
      };

      if (existingRecord) {
        keyRecord.provider = targetProvider;
        if (normalizedCustomUrl) keyRecord.customBaseUrl = normalizedCustomUrl;
        keyRecord.status = 'active';
        keyRecord.cooldownUntil = undefined;
        keyRecord.updatedAt = nowIso;
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
        keyRecord.supportedModels = discovered.models.slice(0, 1000);
        keyRecord.lastError = undefined;
        keyRecord.errorCount = 0;
        discoveredModelsSummary[hint] = keyRecord.supportedModels;
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
    };

    // Bounded concurrent processing so 20-25+ keys finish in ~3 seconds without timeout
    const CONCURRENCY = 6;
    for (let i = 0; i < lines.length; i += CONCURRENCY) {
      await Promise.all(lines.slice(i, i + CONCURRENCY).map(processSingleKey));
    }

    rebuildMasterModelsFromPool();
    lastHydratedAt = Date.now();
  
    // Persist added provider keys and discovered models directly to Firebase Realtime Database
    const syncedModelsList = Array.from(masterModels.values());
    let rtdbPersistedCount = 0;
    try {
      const keysPatch: Record<string, StoredProviderKey> = {};
      for (const pk of addedKeys) {
        keysPatch[pk.id] = pk;
      }
      const [keysOk] = await Promise.all([
        patchCollectionInRtdb('provider_keys', keysPatch, fbToken),
        syncModelsInRtdb(syncedModelsList, fbToken)
      ]);
      rtdbPersistedCount = keysOk ? addedKeys.length : 0;
    } catch {
      // Non-fatal fallback; frontend also persists to RTDB
    }

    res.status(200).json({
      success: true,
      message: `Added ${addedKeys.length} key(s) to Master Key Pool.`,
      addedCount: addedKeys.length,
      rtdbPersistedCount,
      keys: addedKeys.map(k => ({
        id: k.id,
        provider: k.provider,
        key: k.key,
        keyHint: k.keyHint,
        customBaseUrl: k.customBaseUrl,
        status: k.status,
        supportedModels: k.supportedModels,
        modelsCount: k.supportedModels?.length || 0,
        requestCount: k.requestCount || 0,
        errorCount: k.errorCount || 0,
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
  await ensureGatewayHydrated(extractFirebaseToken(req), masterProviderKeys.length === 0);
  res.json({ keys: masterProviderKeys });
});

gatewayApp.post('/api/admin/keys/reset-cooldowns', checkOptionalAdminHeader, async (req: Request, res: Response) => {
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken);

  const restoredPatch: Record<string, StoredProviderKey> = {};
  let restoredCount = 0;
  for (const pk of masterProviderKeys) {
    if (pk.status === 'rate_limited' || pk.status === 'exhausted') {
      pk.status = 'active';
      pk.cooldownUntil = undefined;
      pk.lastError = undefined;
      pk.updatedAt = new Date().toISOString();
      restoredPatch[pk.id] = pk;
      restoredCount++;
    }
  }

  rebuildMasterModelsFromPool();

  if (restoredCount > 0) {
    await patchCollectionInRtdb('provider_keys', restoredPatch, fbToken).catch(() => {});
  }

  res.json({
    success: true,
    restoredCount,
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

  const modelsList = Array.from(masterModels.values());
  await Promise.all([
    upsertItemInRtdb('provider_keys', target.id, target, fbToken),
    syncModelsInRtdb(modelsList, fbToken)
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

  const modelsList = Array.from(masterModels.values());
  await Promise.all([
    deleteItemFromRtdb('provider_keys', id, fbToken),
    syncModelsInRtdb(modelsList, fbToken)
  ]).catch(() => {});

  res.json({ success: true, models: modelsList, totalKeysInPool: masterProviderKeys.length });
});

gatewayApp.post('/api/models/refresh', async (req: Request, res: Response) => {
  const fbToken = extractFirebaseToken(req);
  await ensureGatewayHydrated(fbToken, true);

  const results: Record<string, { status: string; count: number; error?: string }> = {};
  let totalDiscovered = 0;
  const updatedPatch: Record<string, StoredProviderKey> = {};

  const CONCURRENCY = 6;
  const activePool = masterProviderKeys.filter(pk => pk.status !== 'disabled');
  for (let i = 0; i < activePool.length; i += CONCURRENCY) {
    await Promise.all(
      activePool.slice(i, i + CONCURRENCY).map(async (pKey) => {
        try {
          const models = await fetchUpstreamModels(pKey.provider, pKey.key, pKey.customBaseUrl, pKey.id, pKey.keyHint);
          pKey.supportedModels = models;
          pKey.errorCount = 0;
          pKey.lastError = undefined;
          pKey.status = 'active';
          pKey.updatedAt = new Date().toISOString();
          updatedPatch[pKey.id] = pKey;
          results[pKey.keyHint] = { status: 'success', count: models.length };
          totalDiscovered += models.length;
        } catch (err: any) {
          results[pKey.keyHint] = { status: 'failed', count: 0, error: err?.message || 'Upstream fetch failed' };
        }
      })
    );
  }

  rebuildMasterModelsFromPool();

  const modelsList = Array.from(masterModels.values());
  await Promise.all([
    patchCollectionInRtdb('provider_keys', updatedPatch, fbToken),
    syncModelsInRtdb(modelsList, fbToken)
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
      const idx = masterProviderKeys.findIndex(item => item.id === pk.id || item.key === pk.key);
      if (idx >= 0) {
        masterProviderKeys[idx] = { ...masterProviderKeys[idx], ...pk };
      } else {
        masterProviderKeys.push(pk);
      }
    }
    rebuildMasterModelsFromPool();
  }

  // Hydrate active models from RTDB sync payload
  if (Array.isArray(models) && masterProviderKeys.length === 0) {
    masterModels.clear();
    if (!replaceProviderKeys) {
      for (const m of models) {
        if (m && m.id && m.isActive !== false) {
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
  const avgLatencyMs = masterLogs.length > 0
    ? Math.round(masterLogs.reduce((acc, log) => acc + (log.latencyMs || 0), 0) / masterLogs.length)
    : 0;

  res.json({
    totalRequests,
    totalTokens,
    totalCost,
    avgLatencyMs,
    activeKeys,
    rateLimitedKeys,
    totalProviderKeys: masterProviderKeys.length,
    totalModels: masterModels.size,
    rtdbBridge: getRtdbBridgeStatus(),
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
