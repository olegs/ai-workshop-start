# Web view
`npm start` serves it on **port 3000** (`PORT` overrides); `GITHUB_TOKEN` as for the CLI.
## Page
- Top: a **repository field** and a **Scan** button
- Bottom: the results — `owner/repo · N skills` and the scanned commit, both linked, then each skill:
  name linked to the *pinned commit*, the description's *first sentence*, its path, `also in` copies
- Each skill **once**: its copies (spec/analysis.md, "Copies") only as `also in`
- Scanning again *replaces* the results; placeholders while it runs
- `/?repo=<owner/repo>` scans at once; a scan puts the repository in the address: a link to share
- Example repositories to try, one click each
- Light and dark, after the system; narrow screens stack the button under the field
- Warnings under the results; an error replaces them
## API
`GET /api/scan?repo=<owner/repo | GitHub URL>` → JSON `{ repository, skills, warnings }`
- `owner/repo` is shorthand for `https://github.com/owner/repo`
- **GitHub only**: a local directory is rejected, *400* — the page must not read the server's disk
- Empty input → *400*; unreachable repository → the CLI's clear message, *502*
- Nothing is stored
