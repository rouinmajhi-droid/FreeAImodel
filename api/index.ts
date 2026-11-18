import type { IncomingMessage, ServerResponse } from 'http';
import { gatewayApp } from '../server/gateway.js';

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-api-key, x-user-email, x-user-uid, x-firebase-token, x-dashboard-client'
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    res.once('finish', finish);
    res.once('close', finish);

    try {
      (gatewayApp as any)(req, res, (err: any) => {
        if (err && !res.headersSent) {
          res.statusCode = err?.status || 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                message: err?.message || 'Gateway serverless execution error',
                type: 'server_error',
                code: 'serverless_error'
              }
            })
          );
        }
        finish();
      });
    } catch (err: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: {
              message: err?.message || 'Gateway serverless execution error',
              type: 'server_error',
              code: 'serverless_error'
            }
          })
        );
      }
      finish();
    }
  });
}
