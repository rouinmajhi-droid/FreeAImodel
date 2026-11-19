import fs from 'fs';
import os from 'os';
import path from 'path';

export interface PersistentGatewaySnapshot {
  apiKeys: Record<string, any>[];
  providerKeys: Record<string, any>[];
  models: Record<string, any>[];
  logs: Record<string, any>[];
  users: Record<string, any>[];
  updatedAt: string;
}

const PRIMARY_STORE_PATH = path.resolve(process.cwd(), '.gateway-data', 'gateway-store.json');
const FALLBACK_STORE_PATH = path.join(os.tmpdir(), 'freeaimodel-gateway-store.json');

let resolvedStorePath: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function getStoreCandidates(): string[] {
  if (resolvedStorePath) return [resolvedStorePath];
  return [PRIMARY_STORE_PATH, FALLBACK_STORE_PATH];
}

export function loadPersistentGatewaySnapshot(): PersistentGatewaySnapshot | null {
  for (const candidate of getStoreCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, 'utf-8');
      if (!raw.trim()) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        resolvedStorePath = candidate;
        return {
          apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
          providerKeys: Array.isArray(parsed.providerKeys) ? parsed.providerKeys : [],
          models: Array.isArray(parsed.models) ? parsed.models : [],
          logs: Array.isArray(parsed.logs) ? parsed.logs : [],
          users: Array.isArray(parsed.users) ? parsed.users : [],
          updatedAt: String(parsed.updatedAt || new Date().toISOString())
        };
      }
    } catch {
      // Ignore unreadable candidate and try next
    }
  }
  return null;
}

export function savePersistentGatewaySnapshot(snapshot: Omit<PersistentGatewaySnapshot, 'updatedAt'>): Promise<boolean> {
  const payload: PersistentGatewaySnapshot = {
    apiKeys: snapshot.apiKeys,
    providerKeys: snapshot.providerKeys,
    models: snapshot.models,
    logs: snapshot.logs.slice(0, 250),
    users: snapshot.users,
    updatedAt: new Date().toISOString()
  };

  const json = JSON.stringify(payload);

  const task = writeQueue.then(async () => {
    for (const candidate of getStoreCandidates()) {
      try {
        const dir = path.dirname(candidate);
        await fs.promises.mkdir(dir, { recursive: true });
        const tmpFile = `${candidate}.tmp.${process.pid}.${Date.now()}`;
        await fs.promises.writeFile(tmpFile, json, 'utf-8');
        await fs.promises.rename(tmpFile, candidate);
        resolvedStorePath = candidate;
        return true;
      } catch {
        // Fallback to /tmp if project directory is read-only (e.g. serverless)
      }
    }
    return false;
  });

  writeQueue = task.then(
    () => undefined,
    () => undefined
  );

  return task;
}

export function getActiveStorePath(): string {
  return resolvedStorePath || PRIMARY_STORE_PATH;
}
