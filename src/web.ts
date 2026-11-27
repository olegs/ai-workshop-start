// The web client: a page with a repository field and a Scan button, and a JSON API it calls.
// GitHub repositories only: a web page must not read the server's own directories.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { firstSentence } from './commands.ts';
import { CACHE_FILE, createCache, DAY, LIMIT } from './core/cache.ts';
import { AtlasError } from './core/errors.ts';
import {
  openGitHub,
  openGitHubOrganization,
  openOrganizationRepository,
  parseGitHubOrganizationUrl,
  parseGitHubUrl,
  type Fetch,
  type Organization,
} from './core/github.ts';
import { skillLink } from './core/model.ts';
import { scanOrganization } from './core/organization.ts';
import { scan, type ScanResult, type Source } from './core/scan.ts';

export type WebOptions = {
  fetch: Fetch;
  token?: string;
  /** The clock, in milliseconds; tests pass their own. */
  now?: () => number;
  /** At most this many scans kept, each repository of an organization one; 20 000 by default. */
  cacheLimit?: number;
  /**
   * The directory that keeps what was scanned across runs, in `cache.json`: `npm start` passes `~/.skill-atlas`.
   * None: in memory only, as the tests and the mock server do.
   */
  cacheDir?: string;
};

/** What `/api/scan` answers on success. */
export type ScanAnswer = {
  repository: { id: string; url: string; commit: string };
  skills: { id: string; name: string; description: string; summary: string; path: string; link: string; copies: string[] }[];
  warnings: string[];
};

/**
 * What `/api/scan` streams for an organization, one JSON object a line: the organization first, then
 * each repository as soon as it is scanned, a ScanAnswer or an error; `{ error }` alone if it had to stop.
 */
export type OrganizationLine =
  | { organization: { id: string; url: string }; repositories: { id: string; url: string }[] }
  | ScanAnswer
  | { repository: { id: string; url: string; commit: string }; error: string }
  | { error: string };

const PAGE = readFileSync(new URL('./web/index.html', import.meta.url), 'utf8');
/** The skill clusters, computed in the page: a script it loads from the server. */
const CLUSTER_SCRIPT = readFileSync(new URL('./web/cluster.js', import.meta.url), 'utf8');

/** Plotly, which draws the map of the clusters: served from its package, not fetched from elsewhere; read and
 * compressed the first time the page asks for it, as the page asks only when the skills are clustered. */
let plotly: { plain: Buffer; gzip: Buffer } | undefined;
function plotlyScript() {
  if (!plotly) {
    const plain = readFileSync(fileURLToPath(import.meta.resolve('plotly.js-dist-min')));
    plotly = { plain, gzip: gzipSync(plain) };
  }
  return plotly;
}

/** `owner/repo` is shorthand for `https://github.com/owner/repo`, and `owner` for `https://github.com/owner`. */
export function toGitHubUrl(input: string): string {
  const text = input.trim();
  return /^[A-Za-z0-9][\w-]*(?:\/[\w.-]+)?$/.test(text) ? `https://github.com/${text}` : text;
}

function toAnswer(result: ScanResult): ScanAnswer {
  return {
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
}

export function createWebServer(options: WebOptions): Server {
  // What GitHub answered, kept for a day: scanning the same repository or organization again fetches nothing.
  // Only results, not GitHub's raw answers: a large repository's tree is let go once it is scanned.
  // GitHub names are case-insensitive: so are the keys.
  // With a cache directory, kept there too: a restart forgets nothing. So only plain data is kept: an
  // organization's list, and each repository opened again from it.
  const cache = createCache({
    ttl: DAY,
    limit: options.cacheLimit ?? LIMIT,
    now: options.now,
    file: options.cacheDir === undefined ? undefined : join(options.cacheDir, CACHE_FILE),
  });
  const scanRepository = (id: string, open: () => Promise<Source>) =>
    cache.get(`repository:${id.toLowerCase()}`, async () => scan(await open()));
  const openOrganization = async (name: string, input: string): Promise<Organization> => {
    const listed = await cache.get(`organization:${name.toLowerCase()}`, async () => {
      const { id, url, repositories } = await openGitHubOrganization(input, options);
      return { id, url, repositories };
    });
    return { ...listed, open: (repository) => openOrganizationRepository(repository, options) };
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const send = (status: number, type: string, body: string) => {
      response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    const json = (status: number, body: unknown) => send(status, 'application/json', JSON.stringify(body));

    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    if (url.pathname === '/') return send(200, 'text/html', PAGE);
    if (url.pathname === '/cluster.js') return send(200, 'text/javascript', CLUSTER_SCRIPT);
    if (url.pathname === '/plotly.min.js') {
      // The same for a day: 4.8 MB, 1.5 MB compressed, fetched again only when the package changes.
      const script = plotlyScript();
      const gzip = /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''));
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        Vary: 'Accept-Encoding',
        ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
      });
      return response.end(gzip ? script.gzip : script.plain);
    }
    if (url.pathname !== '/api/scan') return json(404, { error: 'Not found' });

    const repo = url.searchParams.get('repo')?.trim() ?? '';
    if (!repo) return json(400, { error: 'Enter a GitHub repository or organization, such as JetBrains/kotlin or JetBrains' });
    const input = toGitHubUrl(repo);
    const unexpected = (error: unknown) => `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    const organizationName = parseGitHubOrganizationUrl(input);
    if (organizationName) {
      let organization;
      try {
        organization = await openOrganization(organizationName, input);
      } catch (error) {
        return error instanceof AtlasError ? json(502, { error: error.message }) : json(500, { error: unexpected(error) });
      }
      // One line at a time, each repository as soon as it is scanned.
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const line = (body: OrganizationLine) => response.write(`${JSON.stringify(body)}\n`);
      let closed = false;
      response.on('close', () => (closed = true));
      line({
        organization: { id: organization.id, url: organization.url },
        repositories: organization.repositories.map(({ id, url }) => ({ id, url })),
      });
      try {
        for await (const { repository, result, error } of scanOrganization(organization, (repository) =>
          scanRepository(repository.id, () => organization.open(repository)),
        )) {
          if (closed) break; // the page went away or started another scan
          line(result ? toAnswer(result) : { repository: { id: repository.id, url: repository.url, commit: '' }, error });
        }
      } catch (error) {
        line({ error: error instanceof AtlasError ? error.message : unexpected(error) });
      }
      return response.end();
    }
    const name = parseGitHubUrl(input);
    if (!name) return json(400, { error: `Not a GitHub repository: ${repo}` });
    try {
      json(200, toAnswer(await scanRepository(`${name.owner}/${name.repo}`, () => openGitHub(input, options))));
    } catch (error) {
      if (error instanceof AtlasError) json(502, { error: error.message });
      else json(500, { error: unexpected(error) });
    }
  });
  // A scan that came just before the server stops is written before it is gone.
  server.on('close', () => cache.close());
  return server;
}
