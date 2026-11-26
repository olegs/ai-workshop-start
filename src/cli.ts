#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr. Nothing is stored.
import { run } from './commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganizationUrl, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';

const token = process.env.GITHUB_TOKEN || undefined;
// A short rate limit is waited out: said on stderr, so the scan does not look stuck.
const notice = (text: string) => console.error(`warning: ${text}`);

process.exitCode = await run(process.argv.slice(2), {
  open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token, notice }) : openDirectory(input)),
  organization: (input) => (parseGitHubOrganizationUrl(input) ? openGitHubOrganization(input, { fetch, token, notice }) : undefined),
  print: (text) => console.log(text),
  error: (text) => console.error(text),
});
