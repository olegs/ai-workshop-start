# Web view
`npm start` serves it on **port 3000** (`PORT` overrides); `GITHUB_TOKEN` as for the CLI.
## Page
- Top: a **repository field** and a **Scan** button
- Bottom: the results — `owner/repo · N skills`, then each skill:
  name linked to the *pinned commit*, the description's *first sentence*, its path, `also in` copies
- Warnings under the results; an error replaces them
## API
`GET /api/scan?repo=<owner/repo | GitHub URL>` → JSON `{ repository, skills, warnings }`
- `owner/repo` is shorthand for `https://github.com/owner/repo`
- **GitHub only**: a local directory is rejected, *400* — the page must not read the server's disk
- Empty input → *400*; unreachable repository → the CLI's clear message, *502*
- Nothing is stored
