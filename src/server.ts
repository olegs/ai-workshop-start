#!/usr/bin/env node
// The web view on http://localhost:3000 (PORT overrides it); GITHUB_TOKEN as for the CLI.
import { createWebServer } from './web.ts';

const port = Number(process.env.PORT || 3000);
const server = createWebServer({ fetch, token: process.env.GITHUB_TOKEN || undefined });
server.listen(port, () => console.log(`Skill Atlas on http://localhost:${port}`));
