import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { gatewayApp } from './server/gateway.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(gatewayApp);

const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(path.resolve(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NexusGate Gateway Server listening on port ${PORT}`);
});
