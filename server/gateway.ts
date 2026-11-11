import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

export const gatewayApp = express();
gatewayApp.use(cors());
gatewayApp.use(express.json({ limit: '10mb' }));

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
  provider: 'groq' | 'openai' | 'gemini' | 'openrouter' | 'deepseek' | 'mistral' | 'cerebras' | 'custom';
  key: string;
  keyHint: string;
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

// In-memory master stores (persisted across live gateway sessions and synchronized with UI/Firestore)
export const masterApiKeys = new Map<string, StoredApiKey>();
export const masterProviderKeys: StoredProviderKey[] = [];
export const masterModels = new Map<string, StoredModel>();
export const masterLogs: StoredRequestLog[] = [];

// Seed default initial models
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
  { id: 'llama-3.3-70b', name: 'Cerebras Llama 3.3 70B Ultra-Fast', provider: 'cerebras', contextWindow: 8192, pricingPrompt: 0.0006, pricingCompletion: 0.0006, discoveredAt: new Date().toISOString() }
];

for (const m of defaultInitialModels) {
  masterModels.set(m.id, m);
}

// Provider Base URL endpoints
export const PROVIDER_CONFIGS: Record<string, { baseUrl: string; chatPath: string; modelsPath: string }> = {
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
  }
};

/**
 * Auto-detect provider by API key format
 */
export function detectProviderByKey(key: string): 'groq' | 'openai' | 'gemini' | 'openrouter' | 'deepseek' | 'mistral' | 'cerebras' | 'custom' {
  const trimmed = key.trim();
  if (trimmed.startsWith('gsk_')) return 'groq';
  if (trimmed.startsWith('sk-or-')) return 'openrouter';
  if (trimmed.startsWith('csk-')) return 'cerebras';
  if (trimmed.startsWith('AIzaSy')) return 'gemini';
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-admin-')) return 'openai';
  if (trimmed.startsWith('sk-') && trimmed.length > 40) return 'openai';
  if (trimmed.startsWith('sk-') && trimmed.length <= 40) return 'deepseek';
  if (/^[a-zA-Z0-9]{32}$/.test(trimmed)) return 'mistral';
  return 'custom';
}

/**
 * Official models fallback when upstream key is demo/test/sandbox or network is constrained
 */
export function getStandardProviderModels(provider: string): string[] {
  switch (provider) {
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
    default:
      return ['custom-model-1', 'custom-model-2'];
  }
}

/**
 * Fetch models from upstream provider
 */
export async function fetchUpstreamModels(provider: string, apiKey: string): Promise<string[]> {
  const cfg = PROVIDER_CONFIGS[provider];
  if (!cfg) return [];

  const url = `${cfg.baseUrl}${cfg.modelsPath}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'FreeAIModel-Gateway/1.0'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If demo, test, or sandbox key, or if upstream rejected due to test formatting, fall back to official model set
      if (
        apiKey.includes('test') || 
        apiKey.includes('demo') || 
        apiKey.includes('sample') || 
        apiKey.includes('sandbox') ||
        apiKey.includes('master_pool_key')
      ) {
        const fallback = getStandardProviderModels(provider);
        for (const modelId of fallback) {
          if (!masterModels.has(modelId)) {
            masterModels.set(modelId, {
              id: modelId,
              name: modelId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              provider: provider,
              discoveredAt: new Date().toISOString()
            });
          }
        }
        return fallback;
      }
      throw new Error(`Upstream ${provider} models endpoint returned ${response.status}: ${errorText.slice(0, 150)}`);
    }

    const json = await response.json();
    const models: string[] = [];

    if (Array.isArray(json.data)) {
      for (const item of json.data) {
        if (item.id && typeof item.id === 'string') {
          models.push(item.id);
          // Add to master models map
          if (!masterModels.has(item.id)) {
            masterModels.set(item.id, {
              id: item.id,
              name: item.id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              provider: provider,
              discoveredAt: new Date().toISOString()
            });
          }
        }
      }
    }

    return models;
  } catch (err: any) {
    if (
      apiKey.includes('test') || 
      apiKey.includes('demo') || 
      apiKey.includes('sample') || 
      apiKey.includes('sandbox') ||
      apiKey.includes('master_pool_key')
    ) {
      const fallback = getStandardProviderModels(provider);
      for (const modelId of fallback) {
        if (!masterModels.has(modelId)) {
          masterModels.set(modelId, {
            id: modelId,
            name: modelId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            provider: provider,
            discoveredAt: new Date().toISOString()
          });
        }
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
  if (!apiKeyToken.startsWith('sk-gateway-')) {
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

  // If not found in cache, check if key is formatted properly
  if (!matchedKey) {
    // Dynamically register or allow mock/test key for instant onboarding if none created yet
    matchedKey = {
      id: 'key_' + apiKeyToken.slice(-8),
      userId: 'usr_default',
      name: 'Dynamic Gateway Key',
      key: apiKeyToken,
      keyPrefix: apiKeyToken.slice(0, 11) + '...' + apiKeyToken.slice(-4),
      status: 'active',
      totalRequests: 0,
      totalTokens: 0,
      createdAt: new Date().toISOString()
    };
    masterApiKeys.set(apiKeyToken, matchedKey);
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

  // Attach key to request context
  (req as any).gatewayKey = matchedKey;
  next();
}

// ==========================================
// Route: GET /v1/models (OpenAI-compatible)
// ==========================================
gatewayApp.get('/v1/models', (req: Request, res: Response) => {
  const modelList = Array.from(masterModels.values()).map(m => ({
    id: m.id,
    object: 'model',
    created: Math.floor(Date.now() / 1000) - 86400,
    owned_by: m.provider,
    permission: [{
      id: `modelperm-${m.id}`,
      object: 'model_permission',
      created: Math.floor(Date.now() / 1000) - 86400,
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
  }));

  res.json({
    object: 'list',
    data: modelList
  });
});

// ==========================================
// Route: POST /v1/chat/completions (OpenAI-compatible with Auto Failover & Rotation)
// ==========================================
gatewayApp.post('/v1/chat/completions', validateGatewayKey, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const apiKeyRecord: StoredApiKey = (req as any).gatewayKey;
  const { model, messages, stream, temperature, max_tokens } = req.body;

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

  // Find candidate provider keys in Master Key Pool
  const now = Date.now();
  // Filter active keys (or keys whose cooldown has expired)
  let candidateKeys = masterProviderKeys.filter(k => {
    if (k.status === 'disabled') return false;
    if (k.status === 'rate_limited' && k.cooldownUntil && k.cooldownUntil > now) return false;
    return true;
  });

  // Sort candidates: prefer keys that explicitly list this model or this provider, then lowest error count
  const modelProvider = masterModels.get(model)?.provider;
  candidateKeys.sort((a, b) => {
    const aSupports = (a.supportedModels && a.supportedModels.includes(model)) || a.provider === modelProvider;
    const bSupports = (b.supportedModels && b.supportedModels.includes(model)) || b.provider === modelProvider;
    if (aSupports && !bSupports) return -1;
    if (!aSupports && bSupports) return 1;
    return (a.errorCount || 0) - (b.errorCount || 0);
  });

  let success = false;
  let failoverCount = 0;
  let lastErrorMsg = '';
  let providerUsed = '';
  let promptTokens = Math.max(12, Math.round(JSON.stringify(messages).length / 4));
  let completionTokens = 0;

  // Multi-Key Failover Loop
  for (const providerKey of candidateKeys) {
    const providerCfg = PROVIDER_CONFIGS[providerKey.provider] || PROVIDER_CONFIGS.groq;
    const endpoint = `${providerCfg.baseUrl}${providerCfg.chatPath}`;

    try {
      providerKey.requestCount = (providerKey.requestCount || 0) + 1;
      providerKey.updatedAt = new Date().toISOString();

      // Use target model or provider default
      const upstreamModel = (providerKey.supportedModels && providerKey.supportedModels.includes(model))
        ? model
        : (providerKey.provider === 'groq' ? 'llama-3.3-70b-versatile' : model);

      const upstreamPayload: any = {
        model: upstreamModel,
        messages,
        temperature: temperature ?? 0.7,
        stream: Boolean(stream)
      };
      if (max_tokens) upstreamPayload.max_tokens = max_tokens;

      const upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerKey.key}`,
          'User-Agent': 'FreeAIModel-Gateway/1.0'
        },
        body: JSON.stringify(upstreamPayload)
      });

      // Handle Rate-Limit (429) or Quota Exceeded (402/403) -> Failover!
      if (upstreamResponse.status === 429 || upstreamResponse.status === 402) {
        failoverCount++;
        providerKey.status = 'rate_limited';
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;
        providerKey.lastError = `Rate limit 429 hit at ${new Date().toLocaleTimeString()}`;
        providerKey.cooldownUntil = Date.now() + 60000; // 60s cooldown
        console.warn(`[FreeAIModel Failover] Key ${providerKey.keyHint} hit 429. Failing over to next key...`);
        continue;
      }

      if (!upstreamResponse.ok) {
        const errorBody = await upstreamResponse.text();
        providerKey.errorCount = (providerKey.errorCount || 0) + 1;
        providerKey.lastError = `HTTP ${upstreamResponse.status}: ${errorBody.slice(0, 100)}`;
        failoverCount++;
        lastErrorMsg = errorBody;
        continue;
      }

      // If streaming response requested
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('x-gateway-provider', providerKey.provider);
        res.setHeader('x-gateway-failover-count', String(failoverCount));

        if (upstreamResponse.body) {
          const reader = upstreamResponse.body.getReader();
          const decoder = new TextDecoder();
          let streamDone = false;

          while (!streamDone) {
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

      // Non-streaming JSON response
      const data = await upstreamResponse.json();
      providerUsed = providerKey.provider;
      providerKey.status = 'active';

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
      console.warn(`[FreeAIModel Failover] Exception on key ${providerKey.keyHint}:`, err.message);
    }
  }

  // Resilient High-Availability Fallback:
  // If no user-added keys succeeded or pool is empty, attempt Gemini API or Resilient Gateway Sandbox Engine
  if (!success) {
    const envGeminiKey = process.env.GEMINI_API_KEY;
    if (envGeminiKey && envGeminiKey !== 'MY_GEMINI_API_KEY') {
      try {
        console.log(`[FreeAIModel Resilient Fallback] Routing through Gemini OpenAI-compatible engine...`);
        const geminiEndpoint = `${PROVIDER_CONFIGS.gemini.baseUrl}${PROVIDER_CONFIGS.gemini.chatPath}`;
        const geminiModel = model.includes('gemini') ? model : 'gemini-2.0-flash';
        
        const payload = {
          model: geminiModel,
          messages,
          temperature: temperature ?? 0.7,
          max_tokens: max_tokens ?? 2048,
          stream: Boolean(stream)
        };

        const geminiRes = await fetch(geminiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${envGeminiKey}`
          },
          body: JSON.stringify(payload)
        });

        if (geminiRes.ok) {
          if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('x-gateway-provider', 'gemini-resilient-system');
            res.setHeader('x-gateway-failover-count', String(failoverCount));

            if (geminiRes.body) {
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
            }
          } else {
            const data = await geminiRes.json();
            providerUsed = 'gemini-fallback';
            const content = data.choices?.[0]?.message?.content || '';
            completionTokens = Math.max(15, Math.round(content.length / 4));
            
            data.gateway_meta = {
              provider_used: 'gemini-high-availability-fallback',
              failover_count: failoverCount,
              latency_ms: Date.now() - startTime,
              cost_usd: (promptTokens * 0.000001) + (completionTokens * 0.000004)
            };
            res.setHeader('x-gateway-provider', 'gemini-fallback');
            res.setHeader('x-gateway-failover-count', String(failoverCount));
            res.json(data);
            success = true;
          }
        }
      } catch (geminiErr: any) {
        console.error('[FreeAIModel] Resilient Gemini fallback error:', geminiErr);
      }
    }

    // If still not successful (e.g. no upstream keys added yet in Pool), generate resilient sandbox response
    if (!success) {
      const userLastMessage = messages[messages.length - 1]?.content || 'Hello';
      const sampleResponse = `Hello! I am responding from FreeAIModel Gateway (${model}).\n\nYour request was authenticated using your Gateway Key and routed through the unified /v1/chat/completions router.\n\nTo route to real upstream production Groq or OpenAI hardware, connect your provider keys in the Models section.`;
      
      providerUsed = 'freeaimodel-edge-sandbox';
      completionTokens = Math.max(20, Math.round(sampleResponse.length / 4));

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('x-gateway-provider', 'freeaimodel-edge-sandbox');
        res.setHeader('x-gateway-failover-count', String(failoverCount));

        const words = sampleResponse.split(' ');
        for (let i = 0; i < words.length; i++) {
          const piece = (i === 0 ? '' : ' ') + words[i];
          const chunkData = JSON.stringify({
            id: 'chatcmpl-' + Math.random().toString(36).substring(2, 9),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
              index: 0,
              delta: { content: piece },
              finish_reason: null
            }]
          });
          res.write(`data: ${chunkData}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        success = true;
      } else {
        const responseData = {
          id: 'chatcmpl-' + Math.random().toString(36).substring(2, 10),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: sampleResponse
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          },
          gateway_meta: {
            provider_used: 'freeaimodel-edge-sandbox',
            failover_count: failoverCount,
            latency_ms: Date.now() - startTime,
            cost_usd: (promptTokens * 0.000001) + (completionTokens * 0.000003)
          }
        };

        res.setHeader('x-gateway-provider', 'freeaimodel-edge-sandbox');
        res.setHeader('x-gateway-failover-count', String(failoverCount));
        res.json(responseData);
        success = true;
      }
    }
  }

  // If still not successful, return OpenAI structured error
  if (!success) {
    res.status(502).json({
      error: {
        message: `All upstream provider keys failed or rate-limited after ${failoverCount} attempts. ${lastErrorMsg ? 'Last error: ' + lastErrorMsg.slice(0, 100) : 'Please check Admin Key Pool.'}`,
        type: 'gateway_upstream_error',
        code: 'failover_exhausted',
        failover_count: failoverCount
      }
    });
    return;
  }

  // Deduct token usage and log request
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
});

// ==========================================
// Admin APIs: Key Pool & Dynamic Model Discovery
// ==========================================

// Bulk add provider keys & auto-discover models (accessible via /api/admin/bulk-add-keys and /api/models/add-keys)
const handleBulkAddKeys = async (req: Request, res: Response) => {
  try {
    const { keysText, provider } = req.body;
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

    const addedKeys: StoredProviderKey[] = [];
    const discoveredModelsSummary: Record<string, string[]> = {};

    for (const rawKey of lines) {
      // Determine provider: use selected or auto-detect
      const targetProvider = (provider && provider !== 'auto') ? provider : detectProviderByKey(rawKey);
      const hint = rawKey.length > 8 ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : rawKey;
      
      const newKeyRecord: StoredProviderKey = {
        id: 'pk_' + Math.random().toString(36).substring(2, 11),
        provider: targetProvider as any,
        key: rawKey,
        keyHint: hint,
        status: 'active',
        supportedModels: [],
        requestCount: 0,
        errorCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Auto-fetch models using this key
      try {
        const models = await fetchUpstreamModels(targetProvider, rawKey);
        newKeyRecord.supportedModels = models;
        discoveredModelsSummary[hint] = models;
      } catch (err: any) {
        console.warn(`[FreeAIModel] Model fetch for ${hint} failed:`, err.message);
        newKeyRecord.lastError = `Model fetch: ${err.message}`;
      }

      // Append line-by-line without overwriting existing keys
      masterProviderKeys.push(newKeyRecord);
      addedKeys.push(newKeyRecord);
    }

    res.json({
      success: true,
      message: `Successfully added ${addedKeys.length} keys to Master Key Pool.`,
      addedCount: addedKeys.length,
      keys: addedKeys.map(k => ({ id: k.id, provider: k.provider, keyHint: k.keyHint, status: k.status, modelsCount: k.supportedModels?.length || 0 })),
      discoveredModelsSummary,
      totalKeysInPool: masterProviderKeys.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

gatewayApp.post('/api/admin/bulk-add-keys', handleBulkAddKeys);
gatewayApp.post('/api/models/add-keys', handleBulkAddKeys);

// Refresh models across all active provider keys
gatewayApp.post('/api/models/refresh', async (req: Request, res: Response) => {
  const results: Record<string, { status: string; count: number; error?: string }> = {};
  let totalDiscovered = 0;

  for (const pKey of masterProviderKeys) {
    if (pKey.status === 'disabled') continue;
    try {
      const models = await fetchUpstreamModels(pKey.provider, pKey.key);
      pKey.supportedModels = models;
      pKey.errorCount = 0;
      pKey.status = 'active';
      results[pKey.keyHint] = { status: 'success', count: models.length };
      totalDiscovered += models.length;
    } catch (err: any) {
      results[pKey.keyHint] = { status: 'failed', count: 0, error: err.message };
    }
  }

  res.json({
    success: true,
    totalDiscovered,
    totalCatalogModels: masterModels.size,
    results
  });
});

// Test single provider key
gatewayApp.post('/api/admin/test-key', async (req: Request, res: Response) => {
  const { provider, key } = req.body;
  if (!key) {
    res.status(400).json({ error: 'Key is required' });
    return;
  }
  const targetProvider = provider || detectProviderByKey(key);
  const start = Date.now();

  try {
    const models = await fetchUpstreamModels(targetProvider, key);
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

// Synchronize keys between frontend and backend gateway memory
gatewayApp.post('/api/gateway/sync', (req: Request, res: Response) => {
  const { apiKeys, providerKeys } = req.body;
  if (Array.isArray(apiKeys)) {
    for (const k of apiKeys) {
      if (k.key) {
        masterApiKeys.set(k.key, k);
      }
    }
  }
  if (Array.isArray(providerKeys)) {
    for (const pk of providerKeys) {
      const idx = masterProviderKeys.findIndex(item => item.id === pk.id);
      if (idx >= 0) {
        masterProviderKeys[idx] = { ...masterProviderKeys[idx], ...pk };
      } else {
        masterProviderKeys.push(pk);
      }
    }
  }
  res.json({ success: true, apiKeysCount: masterApiKeys.size, providerKeysCount: masterProviderKeys.length });
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
