import crypto from 'crypto';

const DEFAULT_RTDB_URL = 'https://aisdd-6f89e-default-rtdb.firebaseio.com';
const PROJECT_ID = 'aisdd-6f89e';
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyBORpX4X_HTiNn_gEruKo6NBX5saZni4d8';
const verifiedIdTokenCache = new Map<string, { uid: string; email?: string; expiresAt: number }>();

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedServiceAccount: ServiceAccountCreds | null | undefined = undefined;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export function getRtdbBaseUrl(): string {
  const raw = process.env.FIREBASE_DATABASE_URL || DEFAULT_RTDB_URL;
  return raw.replace(/\/+$/, '');
}

function getServiceAccount(): ServiceAccountCreds | null {
  if (cachedServiceAccount !== undefined) return cachedServiceAccount;

  const rawEnv =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    '';

  if (!rawEnv.trim()) {
    cachedServiceAccount = null;
    return null;
  }

  try {
    const jsonText = rawEnv.trim().startsWith('{')
      ? rawEnv.trim()
      : Buffer.from(rawEnv.trim(), 'base64').toString('utf-8');
    const parsed = JSON.parse(jsonText);
    if (parsed?.client_email && parsed?.private_key) {
      cachedServiceAccount = {
        client_email: parsed.client_email,
        private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
        token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token'
      };
      return cachedServiceAccount;
    }
  } catch (err) {
    console.warn('[RTDB] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err);
  }

  cachedServiceAccount = null;
  return null;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getServiceAccountOAuthToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }

  const sa = getServiceAccount();
  if (!sa) return null;

  try {
    const iat = Math.floor(now / 1000);
    const exp = iat + 3600;
    const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';

    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64UrlEncode(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
        aud: tokenUri,
        iat,
        exp
      })
    );

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const signature = base64UrlEncode(signer.sign(sa.private_key));
    const assertion = `${header}.${claim}.${signature}`;

    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString(),
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const json: any = await res.json();
      if (json?.access_token) {
        cachedAccessToken = {
          token: json.access_token,
          expiresAt: now + (Number(json.expires_in) || 3500) * 1000
        };
        return cachedAccessToken.token;
      }
    }
  } catch (err) {
    console.warn('[RTDB] Service account OAuth token exchange failed:', err);
  }

  return null;
}

async function buildAuthorizedRtdbUrl(pathSegment: string, queryParams: Record<string, string> = {}, explicitIdToken?: string): Promise<string> {
  const cleanPath = pathSegment.replace(/^\/+/, '').replace(/\/+$/, '');
  const base = `${getRtdbBaseUrl()}/${cleanPath}.json`;
  const params = new URLSearchParams(queryParams);

  const dbSecret = (process.env.FIREBASE_DATABASE_SECRET || '').trim();
  if (dbSecret) {
    params.set('auth', dbSecret);
  } else {
    const saToken = await getServiceAccountOAuthToken();
    if (saToken) {
      params.set('access_token', saToken);
    } else if (explicitIdToken && explicitIdToken.trim().length > 20) {
      params.set('auth', explicitIdToken.trim());
    }
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function hasServerAdminCredentials(): boolean {
  return Boolean(process.env.FIREBASE_DATABASE_SECRET?.trim() || getServiceAccount());
}

/**
 * Sanitizes an ID for safe Firebase Realtime Database child paths.
 * RTDB forbids '.', '#', '$', '[', ']', and '/' in key names.
 */
export function toRtdbKey(rawId: string): string {
  const sanitized = String(rawId || '')
    .replace(/[.#$\[\]/]/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return sanitized || 'id_' + Math.random().toString(36).substring(2, 10);
}

export function sanitizeForRtdb<T = any>(value: T): T {
  if (value === null || value === undefined) return undefined as any;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForRtdb(v)).filter((v) => v !== undefined) as any;
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined && v !== null) {
        const cleaned = sanitizeForRtdb(v);
        if (cleaned !== undefined) {
          out[k] = cleaned;
        }
      }
    }
    return out as any;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return 0 as any;
  }
  return value;
}

export async function listCollectionFromRtdb<T = Record<string, any>>(
  nodeName: string,
  explicitIdToken?: string
): Promise<T[] | null> {
  try {
    const url = await buildAuthorizedRtdbUrl(nodeName, {}, explicitIdToken);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[RTDB] GET /${nodeName}.json failed (${res.status}):`, errText.slice(0, 200));
      return null;
    }

    const data: any = await res.json();
    if (!data || typeof data !== 'object') return [];

    if (Array.isArray(data)) {
      return data.filter(Boolean) as T[];
    }

    return Object.entries(data)
      .filter(([, val]) => val && typeof val === 'object')
      .map(([key, val]: [string, any]) => ({
        ...val,
        id: val.id || key
      })) as T[];
  } catch (err) {
    console.warn(`[RTDB] Exception GET /${nodeName}.json:`, err);
    return null;
  }
}

export async function upsertItemInRtdb(
  nodeName: string,
  rawId: string,
  data: Record<string, any>,
  explicitIdToken?: string
): Promise<boolean> {
  const key = toRtdbKey(rawId);
  try {
    const url = await buildAuthorizedRtdbUrl(`${nodeName}/${key}`, {}, explicitIdToken);
    const cleanData = sanitizeForRtdb(data);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanData),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[RTDB] Failed PUT /${nodeName}/${key}.json (${res.status}):`, errBody.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.warn(`[RTDB] Exception PUT /${nodeName}/${key}.json:`, err);
    return false;
  }
}

export async function patchItemInRtdb(
  nodeName: string,
  rawId: string,
  partialData: Record<string, any>,
  explicitIdToken?: string
): Promise<boolean> {
  const key = toRtdbKey(rawId);
  try {
    const url = await buildAuthorizedRtdbUrl(`${nodeName}/${key}`, {}, explicitIdToken);
    const cleanData = sanitizeForRtdb(partialData);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanData),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[RTDB] Failed PATCH /${nodeName}/${key}.json (${res.status}):`, errBody.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.warn(`[RTDB] Exception PATCH /${nodeName}/${key}.json:`, err);
    return false;
  }
}

export async function patchCollectionInRtdb(
  nodeName: string,
  itemsByRawId: Record<string, Record<string, any>>,
  explicitIdToken?: string
): Promise<boolean> {
  const payload: Record<string, any> = {};
  for (const [rawId, val] of Object.entries(itemsByRawId)) {
    payload[toRtdbKey(rawId)] = sanitizeForRtdb(val);
  }
  if (Object.keys(payload).length === 0) return true;

  try {
    const url = await buildAuthorizedRtdbUrl(nodeName, {}, explicitIdToken);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[RTDB] Failed PATCH /${nodeName}.json (${res.status}):`, errBody.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.warn(`[RTDB] Exception PATCH /${nodeName}.json:`, err);
    return false;
  }
}

export async function deleteItemFromRtdb(
  nodeName: string,
  rawId: string,
  explicitIdToken?: string
): Promise<boolean> {
  const key = toRtdbKey(rawId);
  try {
    const url = await buildAuthorizedRtdbUrl(`${nodeName}/${key}`, {}, explicitIdToken);
    const res = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(6000)
    });
    return res.ok || res.status === 404;
  } catch (err) {
    console.warn(`[RTDB] Exception DELETE /${nodeName}/${key}.json:`, err);
    return false;
  }
}

export async function findApiKeyBySecretInRtdb<T = Record<string, any>>(
  secretKey: string,
  explicitIdToken?: string
): Promise<T | null> {
  // Attempt indexed query first
  try {
    const url = await buildAuthorizedRtdbUrl(
      'api_keys',
      {
        orderBy: JSON.stringify('key'),
        equalTo: JSON.stringify(secretKey)
      },
      explicitIdToken
    );
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data && typeof data === 'object') {
        const firstVal = Object.values(data).find((v: any) => v && v.key === secretKey);
        if (firstVal) return firstVal as T;
      }
      return null;
    }
  } catch {
    // Fall back to collection scan if index isn't defined in RTDB rules
  }

  // Full scan fallback (safe even without .indexOn rules)
  const all = await listCollectionFromRtdb<T & { key?: string }>('api_keys', explicitIdToken);
  if (!all) return null;
  return all.find((item) => item?.key === secretKey) || null;
}

export async function syncModelsInRtdb(
  models: Array<Record<string, any>>,
  explicitIdToken?: string
): Promise<boolean> {
  const modelMap: Record<string, any> = {};
  const nowIso = new Date().toISOString();

  for (const m of models) {
    if (!m?.id) continue;
    const safeKey = toRtdbKey(m.id);
    modelMap[safeKey] = sanitizeForRtdb({
      id: String(m.id).slice(0, 128),
      name: String(m.name || m.id).slice(0, 128),
      provider: String(m.provider || 'custom').slice(0, 64),
      ownerKeyId: m.ownerKeyId ? String(m.ownerKeyId).slice(0, 128) : undefined,
      ownerKeyHint: m.ownerKeyHint ? String(m.ownerKeyHint).slice(0, 64) : undefined,
      contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
      activeKeysCount: typeof m.activeKeysCount === 'number' ? m.activeKeysCount : undefined,
      isActive: true,
      discoveredAt: String(m.discoveredAt || nowIso).slice(0, 64),
      updatedAt: nowIso
    });
  }

  try {
    const url = await buildAuthorizedRtdbUrl('models', {}, explicitIdToken);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.keys(modelMap).length > 0 ? modelMap : null),
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[RTDB] Failed PUT /models.json (${res.status}):`, errBody.slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.warn('[RTDB] Exception PUT /models.json:', err);
    return false;
  }
}

export function getRtdbBridgeStatus() {
  return {
    configured: true,
    engine: 'firebase-rtdb',
    projectId: PROJECT_ID,
    databaseURL: getRtdbBaseUrl(),
    serverAdminCredentialsAvailable: hasServerAdminCredentials()
  };
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email?: string } | null> {
  const token = String(idToken || '').trim();
  if (!token || token.split('.').length !== 3) return null;

  const cached = verifiedIdTokenCache.get(token);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { uid: cached.uid, email: cached.email };
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const user = Array.isArray(data?.users) ? data.users[0] : null;
    if (!user?.localId) return null;

    const info = { uid: String(user.localId), email: user.email ? String(user.email) : undefined };
    verifiedIdTokenCache.set(token, { ...info, expiresAt: now + 5 * 60_000 });
    if (verifiedIdTokenCache.size > 500) {
      const oldestKey = verifiedIdTokenCache.keys().next().value;
      if (oldestKey) verifiedIdTokenCache.delete(oldestKey);
    }
    return info;
  } catch {
    return null;
  }
}
