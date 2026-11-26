# Web view
`npm start` serves it on **port 3000** (`PORT` overrides); `GITHUB_TOKEN` as for the CLI.
## Page
- Top: a **repository field** and a **Scan** button; it takes an organization too
- Bottom: the results — `owner/repo · N skills` and the scanned commit, both linked, then each skill:
  name linked to the *pinned commit*, the description's *first sentence*, its path, `also in` copies
- Each skill **once**: its copies (spec/analysis.md, "Copies") only as `also in`
- Scanning again *replaces* the results; placeholders while it runs
- A **filter field** above the results, once there are skills: shows only the skills whose *name*, *description*
  or *repository name* has every word typed, case aside; as you type, in the page, nothing fetched again
  - `k of N skills match`, or `No skills match "…"`; an organization's repository with no match is hidden,
    one that could not be scanned stays while its name matches
  - It filters the repositories still coming in too; a new scan empties it
- `/?repo=<owner/repo>` scans at once; a scan puts the repository in the address: a link to share
- Example repositories to try, one click each
- An organization: `owner · N repositories · M skills` linked, then a section for each repository *as it is
  scanned* — `owner/repo · N skills` and its commit, linked, its skills as above, or why it could not be scanned;
  a repository with **no skills** is not shown, its warnings are; none with skills → a note saying so;
  `k of N scanned` and the placeholders below until the last; warnings name their repository; a rate limit stops it,
  its message in the warnings
- Light and dark, after the system; narrow screens stack the button under the field
- The look: a **neon sunset** by the sea, original art, no game's or brand's logo, font or artwork
  - Top: a sunset sky, a striped sun and a skyline of towers and palms, drawn in the page, hidden from screen readers;
    the title in bold slanted capitals with a neon glow; the Scan button a pink-to-orange gradient
  - Keyboard focus on the sky: a white ring with a dark halo, seen against every colour of the sunset
  - Light: the sunset, warm sand below; dark: the night after it; neon pink links, teal accents
  - Each skill a card with a sunset stripe on its left; a repository's name in slanted capitals, underlined in sunset
  - Nothing fetched for it: no web fonts, no images, the system's fonts only
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
## Cache
What the server fetched from GitHub is kept **24 hours**, in memory: the same scan again fetches nothing
- A repository's result, an organization's list of repositories; each repository of an organization as if
  scanned alone: `owner/repo` after `owner` is not fetched again
- Any way of naming it, case aside: `owner/repo`, its URL, `OWNER/Repo`
- Asked for twice at once → fetched once
- Only what was scanned: an unreachable repository, a repository that could not be scanned, a rate limit
  are asked for again the next time
- After 24 hours GitHub is asked again; a restart forgets it all; the oldest go first past 20 000 entries,
  each repository of an organization one: well above the largest organization, scanned again, fetches nothing
- Nothing on disk
