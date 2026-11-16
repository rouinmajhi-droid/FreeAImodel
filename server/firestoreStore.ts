import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface FirebaseConfigFile {
  projectId: string;
  firestoreDatabaseId: string;
  databaseURL?: string;
  apiKey?: string;
}

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedConfig: FirebaseConfigFile | null = null;
let cachedServiceAccount: ServiceAccountCreds | null | undefined = undefined;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let metadataCheckedAt = 0;
let metadataAvailable = true;

function loadFirebaseConfig(): FirebaseConfigFile | null {
  if (cachedConfig) return cachedConfig;

  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(__dirname, '../firebase-applet-config.json')
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (parsed?.projectId && parsed?.firestoreDatabaseId) {
          cachedConfig = {
            projectId: parsed.projectId,
            firestoreDatabaseId: parsed.firestoreDatabaseId,
            databaseURL: parsed.databaseURL || `https://${parsed.projectId}-default-rtdb.firebaseio.com`,
            apiKey: parsed.apiKey
          };
          return cachedConfig;
        }
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
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
    console.warn('[FirestoreStore] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err);
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

async function getServiceAccountToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }

  const sa = getServiceAccount();
  if (sa) {
    try {
      const iat = Math.floor(now / 1000);
      const exp = iat + 3600;
      const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';

      const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claim = base64UrlEncode(
        JSON.stringify({
          iss: sa.client_email,
          scope: 'https://www.googleapis.com/auth/datastore',
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
      console.warn('[FirestoreStore] Service account OAuth token exchange failed:', err);
    }
  }

  // Fallback: check GCP metadata server when running in Cloud Run / GCE (fast timeout)
  if (!metadataAvailable && now - metadataCheckedAt < 300_000) {
    return null;
  }
  metadataCheckedAt = now;
  try {
    const metaRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(600)
      }
    );
    if (metaRes.ok) {
      const json: any = await metaRes.json();
      if (json?.access_token) {
        metadataAvailable = true;
        cachedAccessToken = {
          token: json.access_token,
          expiresAt: now + (Number(json.expires_in) || 3500) * 1000
        };
        return cachedAccessToken.token;
      }
    }
    metadataAvailable = false;
  } catch {
    metadataAvailable = false;
  }

  return null;
}

async function resolveAuthToken(explicitIdToken?: string): Promise<string | null> {
  const serverToken = await getServiceAccountToken();
  if (serverToken) return serverToken;
  if (explicitIdToken && explicitIdToken.trim().length > 20) {
    return explicitIdToken.trim();
  }
  return null;
}

export function hasServerAdminCredentials(): boolean {
  return Boolean(getServiceAccount());
}

export function toFirestoreDocId(rawId: string): string {
  const sanitized = String(rawId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return sanitized || 'doc_' + Math.random().toString(36).substring(2, 10);
}

function getDocumentsRootUrl(): string | null {
  const cfg = loadFirebaseConfig();
  if (!cfg) return null;
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(cfg.firestoreDatabaseId)}/documents`;
}

function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { doubleValue: 0 };
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.filter((v) => v !== undefined).map(toFirestoreValue)
      }
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(fv: any): any {
  if (!fv || typeof fv !== 'object') return undefined;
  if ('nullValue' in fv) return null;
  if ('stringValue' in fv) return fv.stringValue;
  if ('booleanValue' in fv) return Boolean(fv.booleanValue);
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue' in fv) return Number(fv.doubleValue);
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('arrayValue' in fv) {
    const values = fv.arrayValue?.values;
    return Array.isArray(values) ? values.map(fromFirestoreValue) : [];
  }
  if ('mapValue' in fv) {
    const fields = fv.mapValue?.fields || {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function fromFirestoreDocument<T = Record<string, any>>(docObj: any): T | null {
  if (!docObj || !docObj.fields) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(docObj.fields)) {
    out[k] = fromFirestoreValue(v);
  }
  if (!out.id && typeof docObj.name === 'string') {
    out.id = docObj.name.split('/').pop();
  }
  return out as T;
}

function toFirestoreFields(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

export async function listCollectionFromFirestore<T = Record<string, any>>(
  collectionName: string,
  explicitIdToken?: string,
  pageSize = 300
): Promise<T[] | null> {
  const root = getDocumentsRootUrl();
  const token = await resolveAuthToken(explicitIdToken);
  if (!root || !token) return null;

  try {
    const res = await fetch(`${root}/${encodeURIComponent(collectionName)}?pageSize=${pageSize}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const docs = Array.isArray(json?.documents) ? json.documents : [];
    return docs.map((d: any) => fromFirestoreDocument<T>(d)).filter(Boolean) as T[];
  } catch {
    return null;
  }
}

export async function upsertDocumentInFirestore(
  collectionName: string,
  rawDocId: string,
  data: Record<string, any>,
  explicitIdToken?: string
): Promise<boolean> {
  const root = getDocumentsRootUrl();
  const token = await resolveAuthToken(explicitIdToken);
  if (!root || !token) return false;

  const docId = toFirestoreDocId(rawDocId);
  try {
    const res = await fetch(`${root}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: toFirestoreFields(data)
      }),
      signal: AbortSignal.timeout(6000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteDocumentFromFirestore(
  collectionName: string,
  rawDocId: string,
  explicitIdToken?: string
): Promise<boolean> {
  const root = getDocumentsRootUrl();
  const token = await resolveAuthToken(explicitIdToken);
  if (!root || !token) return false;

  const docId = toFirestoreDocId(rawDocId);
  try {
    const res = await fetch(`${root}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(6000)
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export async function findApiKeyBySecretInFirestore<T = Record<string, any>>(
  secretKey: string,
  explicitIdToken?: string
): Promise<T | null> {
  const root = getDocumentsRootUrl();
  const token = await resolveAuthToken(explicitIdToken);
  if (!root || !token) return null;

  try {
    const res = await fetch(`${root}:runQuery`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'api_keys' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'key' },
              op: 'EQUAL',
              value: { stringValue: secretKey }
            }
          },
          limit: 1
        }
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const rows: any = await res.json();
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (row?.document) {
        return fromFirestoreDocument<T>(row.document);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function syncModelsInFirestore(
  models: Array<Record<string, any>>,
  explicitIdToken?: string
): Promise<boolean> {
  const token = await resolveAuthToken(explicitIdToken);
  if (!token) return false;

  const existing = await listCollectionFromFirestore<{ id: string }>('models', token, 500);
  const activeIds = new Set(models.map((m) => toFirestoreDocId(m.id)));

  if (existing) {
    await Promise.all(
      existing
        .filter((m) => m.id && !activeIds.has(toFirestoreDocId(m.id)))
        .map((m) => deleteDocumentFromFirestore('models', m.id, token))
    );
  }

  // Upsert in small parallel batches to avoid connection spikes
  const chunkSize = 15;
  for (let i = 0; i < models.length; i += chunkSize) {
    const batch = models.slice(i, i + chunkSize);
    await Promise.all(
      batch.map((m) =>
        upsertDocumentInFirestore(
          'models',
          m.id,
          {
            id: m.id,
            name: String(m.name || m.id).slice(0, 128),
            provider: String(m.provider || 'custom').slice(0, 64),
            ownerKeyId: m.ownerKeyId ? String(m.ownerKeyId).slice(0, 128) : undefined,
            ownerKeyHint: m.ownerKeyHint ? String(m.ownerKeyHint).slice(0, 64) : undefined,
            contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
            activeKeysCount: typeof m.activeKeysCount === 'number' ? m.activeKeysCount : undefined,
            isActive: true,
            discoveredAt: m.discoveredAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          token
        )
      )
    );
  }
  return true;
}

export function getFirestoreBridgeStatus() {
  const cfg = loadFirebaseConfig();
  return {
    configured: Boolean(cfg),
    projectId: cfg?.projectId || null,
    databaseId: cfg?.firestoreDatabaseId || null,
    databaseURL: cfg?.databaseURL || null,
    serverAdminCredentialsAvailable: Boolean(getServiceAccount())
  };
}
