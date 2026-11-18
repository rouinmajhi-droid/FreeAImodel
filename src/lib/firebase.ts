import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';
import { getAuth, GoogleAuthProvider, GithubAuthProvider, OAuthProvider } from 'firebase/auth';
import { firebaseConfig } from '../../shared/firebaseConfig';

export { firebaseConfig };

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const rtdb = getDatabase(app, firebaseConfig.databaseURL);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const githubProvider = new GithubAuthProvider();
export const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({ prompt: 'select_account' });

export const DESIGNATED_ADMIN_EMAIL = 'Rouinmajhi@gmail.com';

export function isUserAdmin(email?: string | null, _role?: string): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === DESIGNATED_ADMIN_EMAIL.toLowerCase();
}

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

export async function testRtdbConnection(): Promise<boolean> {
  try {
    const snap = await get(ref(rtdb, '.info/connected'));
    return Boolean(snap.val());
  } catch (err) {
    console.warn('Firebase RTDB connection check error:', err);
    return false;
  }
}
