import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import { gatewayApp } from './server/gateway.ts';

function nexusGatePlugin(): Plugin {
  return {
    name: 'nexusgate-api-gateway',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url) {
          const isApiAliasModels = (req.url === '/models' || req.url.startsWith('/models?')) &&
            (!(String(req.headers.accept || '').toLowerCase().includes('text/html')) ||
              Boolean(req.headers.authorization) ||
              Boolean(req.headers['x-api-key']) ||
              req.url.includes('key='));
          if (req.url.startsWith('/v1') || req.url.startsWith('/api') || isApiAliasModels) {
            return gatewayApp(req as any, res as any, next);
          }
        }
        next();
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), nexusGatePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      cors: false,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
