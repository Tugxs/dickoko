// Isolated local fixture server. Never imported by the application or deployed as a route.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { fixtureResponse } from './fixtures.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = express();
app.get(/^\/api\//, (req, res) => res.json(fixtureResponse(req.originalUrl)));
app.get('/studio', (_req, res) => res.sendFile(root + 'studio.html'));
app.use(express.static(root));
app.listen(43821, '127.0.0.1', () => console.log('Local preview on http://127.0.0.1:43821/studio?guild=111111111111111111#overview'));
