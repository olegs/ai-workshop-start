// The web client: a page with a repository field and a Scan button, and a JSON API it calls.
// GitHub repositories only: a web page must not read the server's own directories.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { firstSentence } from './commands.ts';
import { AtlasError } from './core/errors.ts';
import { openGitHub, parseGitHubUrl, type Fetch } from './core/github.ts';
import { skillLink } from './core/model.ts';
import { scan } from './core/scan.ts';

export type WebOptions = {
  fetch: Fetch;
  token?: string;
};

/** What `/api/scan` answers on success. */
export type ScanAnswer = {
  repository: { id: string; url: string; commit: string };
  skills: { id: string; name: string; description: string; summary: string; path: string; link: string; copies: string[] }[];
  warnings: string[];
};

const PAGE = readFileSync(new URL('./web/index.html', import.meta.url), 'utf8');

/** `owner/repo` is shorthand for `https://github.com/owner/repo`. */
export function toGitHubUrl(input: string): string {
  const text = input.trim();
  return /^[A-Za-z0-9][\w-]*\/[\w.-]+$/.test(text) ? `https://github.com/${text}` : text;
}

export function createWebServer(options: WebOptions): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const send = (status: number, type: string, body: string) => {
      response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    const json = (status: number, body: unknown) => send(status, 'application/json', JSON.stringify(body));

    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    if (url.pathname === '/') return send(200, 'text/html', PAGE);
    if (url.pathname !== '/api/scan') return json(404, { error: 'Not found' });

    const repo = url.searchParams.get('repo')?.trim() ?? '';
    if (!repo) return json(400, { error: 'Enter a GitHub repository, such as JetBrains/kotlin' });
    const input = toGitHubUrl(repo);
    if (!parseGitHubUrl(input)) return json(400, { error: `Not a GitHub repository: ${repo}` });
    try {
      const result = await scan(await openGitHub(input, options));
      const answer: ScanAnswer = {
        repository: { id: result.repository.id, url: result.repository.url, commit: result.repository.commit },
        skills: result.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          summary: firstSentence(skill.description),
          path: skill.path,
          link: skillLink(result.repository, skill),
          copies: skill.copies,
        })),
        warnings: result.warnings,
      };
      json(200, answer);
    } catch (error) {
      if (error instanceof AtlasError) json(502, { error: error.message });
      else json(500, { error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` });
    }
  });
}
