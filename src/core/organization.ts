import { AtlasError, GitHubAccessError } from './errors.ts';
import type { Organization, RepositoryRef } from './github.ts';
import { scan, type ScanResult } from './scan.ts';

/** One repository of an organization: its skills, or why it could not be scanned. */
export type RepositoryScan = { repository: RepositoryRef } & ({ result: ScanResult; error?: undefined } | { result?: undefined; error: string });

/**
 * Each repository of the organization, one after another, as soon as it is scanned. A repository that
 * cannot be scanned is reported and the scan goes on; when GitHub refuses everything (a rate limit,
 * a rejected token), the scan stops: the error is thrown.
 */
export async function* scanOrganization(
  organization: Organization,
  /** Scans one repository; the web server passes one that remembers what it scanned. */
  scanRepository: (repository: RepositoryRef) => Promise<ScanResult> = async (repository) => scan(await organization.open(repository)),
): AsyncGenerator<RepositoryScan> {
  for (const repository of organization.repositories) {
    try {
      yield { repository, result: await scanRepository(repository) };
    } catch (error) {
      if (!(error instanceof AtlasError) || error instanceof GitHubAccessError) throw error;
      yield { repository, error: error.message };
    }
  }
}
