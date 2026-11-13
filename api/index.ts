import type { IncomingMessage, ServerResponse } from 'http';
import { gatewayApp } from '../server/gateway.js';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    return (gatewayApp as any)(req, res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.message || 'Gateway serverless execution error' }));
    }
  }
}
