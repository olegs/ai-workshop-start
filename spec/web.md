# Web view
`npm start` serves it on **port 3000** (`PORT` overrides); `GITHUB_TOKEN` as for the CLI.
## Page
- Top: a **repository field** and a **Scan** button; it takes an organization too
- Bottom: the results — `owner/repo · N skills` and the scanned commit, both linked, then each skill:
  name linked to the *pinned commit*, the description's *first sentence*, its path, `also in` copies
- Each skill **once**: its copies (spec/analysis.md, "Copies") only as `also in`
- Scanning again *replaces* the results; placeholders while it runs
- `/?repo=<owner/repo>` scans at once; a scan puts the repository in the address: a link to share
- Example repositories to try, one click each
- An organization: `owner · N repositories · M skills` linked, then a section for each repository *as it is
  scanned* — `owner/repo · N skills` and its commit, linked, its skills as above, or why it could not be scanned;
  a repository with **no skills** is not shown, its warnings are; none with skills → a note saying so;
  `k of N scanned` and the placeholders below until the last; warnings name their repository; a rate limit stops it,
  its message in the warnings
- Light and dark, after the system; narrow screens stack the button under the field
- Warnings under the results; an error replaces them
## API
`GET /api/scan?repo=<owner/repo | GitHub URL>` → JSON `{ repository, skills, warnings }`
- `owner/repo` is shorthand for `https://github.com/owner/repo`; `owner` for `https://github.com/owner`
- An organization → *200*, `application/x-ndjson`, one JSON object a line, each *as soon as it is ready*:
  `{ organization, repositories }`, then `{ repository, skills, warnings }` or `{ repository, error }` for each,
  one with no skills too;
  `{ error }` last if the scan had to stop. Unreachable organization → *502*, JSON, before any line
- **GitHub only**: a local directory is rejected, *400* — the page must not read the server's disk
- Empty input → *400*; unreachable repository → the CLI's clear message, *502*
- Nothing is stored
