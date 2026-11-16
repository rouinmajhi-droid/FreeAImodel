export type DetectedProviderId =
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'anthropic'
  | 'cerebras'
  | 'openai'
  | 'deepseek'
  | 'inception'
  | 'mistral'
  | 'custom';

export interface ParsedKeyEntry {
  raw: string;
  provider: DetectedProviderId;
  providerLabel: string;
  hint: string;
}

export interface KeyExtractionResult {
  keys: string[];
  maskedFound: boolean;
  entries: ParsedKeyEntry[];
}

export const PROVIDER_LABELS: Record<DetectedProviderId, string> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  cerebras: 'Cerebras',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  inception: 'Inception Labs',
  mistral: 'Mistral',
  custom: 'Auto / Custom OpenAI-Compatible'
};

export function detectProviderHint(rawKey: string, customBaseUrl?: string): DetectedProviderId {
  if (customBaseUrl && customBaseUrl.trim()) {
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

  const trimmed = rawKey.trim();
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

export function formatDetectedLabel(provider: DetectedProviderId, rawKey: string): string {
  const trimmed = rawKey.trim();
  if (
    trimmed.startsWith('sk-') &&
    !trimmed.startsWith('sk-or-') &&
    !trimmed.startsWith('sk-ant-') &&
    !trimmed.startsWith('sk-proj-') &&
    !trimmed.startsWith('sk-admin-') &&
    !trimmed.startsWith('sk-svcacct-')
  ) {
    return `${PROVIDER_LABELS[provider]} (Auto-Probe sk-)`;
  }
  return PROVIDER_LABELS[provider];
}

/**
 * Cleanly extracts valid printable ASCII API keys from messy clipboard pastes
 * (supports invisible zero-width spaces, quotes, Bearer prefixes, ENV_VAR=key lines, and multi-key pastes).
 */
export function extractAndCleanKeys(rawText: string, customBaseUrl?: string): KeyExtractionResult {
  const normalized = String(rawText || '')
    // Remove invisible Unicode formatting / zero-width characters
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '')
    // Normalize non-breaking / exotic spaces to standard space
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    // Normalize smart quotes to standard quotes
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  const lines = normalized.split(/[\r\n]+/);
  const seen = new Set<string>();
  const keys: string[] = [];
  const entries: ParsedKeyEntry[] = [];
  let maskedFound = false;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Strip leading markdown bullets or numbered list prefixes
    line = line.replace(/^([-*•]|\d+[.)])\s+/, '').trim();
    // Strip optional "export " prefix
    line = line.replace(/^export\s+/i, '').trim();

    // Handle ENV_VAR=value lines (e.g. GEMINI_API_KEY="AIza...")
    const envMatch = line.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/);
    if (envMatch) {
      line = envMatch[1].trim();
    }

    // Handle optional "Bearer " or "Authorization:" prefixes
    line = line.replace(/^(authorization\s*:\s*)?bearer\s+/i, '').trim();

    // Split on commas, semicolons, or whitespace if multiple tokens exist
    const tokens = line.split(/[\s,;]+/);
    for (let token of tokens) {
      // Strip surrounding quotes, backticks, or brackets
      token = token.replace(/^["'`(\[{<]+|["'`)\]}>]+$/g, '').trim();
      if (!token) continue;

      // Skip common noise words if pasted from curl / env instructions
      if (/^(bearer|api_key|apikey|key|token|authorization|header|curl|-h|--header)$/i.test(token)) {
        continue;
      }

      if (token.includes('…') || token.includes('...') || /\*{4,}|•{2,}/.test(token)) {
        maskedFound = true;
        continue;
      }

      // Keep strictly valid printable ASCII characters so HTTP headers never break
      const cleanAscii = token.replace(/[^\x21-\x7E]/g, '');
      if (cleanAscii.length < 8) continue;

      if (!seen.has(cleanAscii)) {
        seen.add(cleanAscii);
        keys.push(cleanAscii);
        const provider = detectProviderHint(cleanAscii, customBaseUrl);
        const hint =
          cleanAscii.length > 8
            ? `${cleanAscii.slice(0, 4)}...${cleanAscii.slice(-4)}`
            : cleanAscii;
        entries.push({
          raw: cleanAscii,
          provider,
          providerLabel: formatDetectedLabel(provider, cleanAscii),
          hint
        });
      }
    }
  }

  return { keys, maskedFound, entries };
}
