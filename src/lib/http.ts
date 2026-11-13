/**
 * Safe JSON response parser to prevent `Unexpected token ... is not valid JSON`
 * when upstream proxies or serverless platforms emit plain-text or HTML errors.
 */
export async function parseJsonSafe<T = any>(res: Response): Promise<T> {
  const rawText = await res.text();
  let parsed: any = null;

  if (rawText && rawText.trim().length > 0) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const preview = rawText.trim().replace(/\s+/g, ' ').slice(0, 180);
      throw new Error(
        `Server returned non-JSON response (HTTP ${res.status}): ${preview || res.statusText || 'Empty body'}`
      );
    }
  } else {
    parsed = {};
  }

  if (!res.ok) {
    const errMsg =
      parsed?.error?.message ||
      (typeof parsed?.error === 'string' ? parsed.error : '') ||
      parsed?.message ||
      `Request failed with HTTP ${res.status} (${res.statusText})`;
    throw new Error(errMsg);
  }

  return parsed as T;
}
