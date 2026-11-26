/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/** GitHub refuses every request, not just one: a rate limit, a rejected token. Scanning more cannot help. */
export class GitHubAccessError extends AtlasError {}
