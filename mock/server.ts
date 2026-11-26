#!/usr/bin/env node
// The web view over the mock data in mock/github.ts, for demos: `npm run mock`, on http://localhost:3000
// (PORT overrides it). Each GitHub answer comes after MOCK_DELAY ms, 150 by default, so the placeholders show.
import { createWebServer } from '../src/web.ts';
import { mockGitHub } from './github.ts';

const port = Number(process.env.PORT || 3000);
const server = createWebServer({ fetch: mockGitHub(Number(process.env.MOCK_DELAY ?? 150)) });
server.listen(port, () => console.log(`Skill Atlas over the mock data on http://localhost:${port}`));
