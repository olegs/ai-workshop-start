#!/usr/bin/env node
// The web view on http://localhost:3000 (PORT overrides it); GITHUB_TOKEN as for the CLI.
// What it scans is kept in ~/.skill-atlas across runs.
import { CACHE_DIR } from './core/cache.ts';
import { createWebServer } from './web.ts';

const port = Number(process.env.PORT || 3000);
const server = createWebServer({ fetch, token: process.env.GITHUB_TOKEN || undefined, cacheDir: CACHE_DIR });
server.listen(port, () => console.log(`Skill Atlas on http://localhost:${port}`));
// Ctrl-C or a stop: the last scans are saved as the server closes.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
