# QA
UI tests of the web view (spec/web.md), as a person sees it: **Cucumber** scenarios in `qa/features/*.feature`, over the
**mock data** (spec/demo.md), each page compared with its **screenshot**, the test data in `qa/screenshots/<name>.png`
- `npm run qa`: every scenario; `npm test` runs them too, skipped without Chromium
- Chromium through Playwright, **1280×720**, light, motion reduced; the whole page, animations stopped, no caret
- Needs Chromium for Playwright (`npx playwright install --with-deps chromium`), or `CHROMIUM_PATH`, another Chromium
- Steps in `qa/steps`; the mock server, the browser and the comparison in `qa/support`
## Screenshots
- A page that differs from its screenshot fails its scenario: more than **0.1 %** of its pixels, each by more than a
  colour threshold of **0.05** (antialiasing aside); a size that differs, or no screenshot, fails too
- What was taken goes to `test-results/qa/<name>.actual.png`, the differing pixels to `<name>.diff.png`
- `QA_UPDATE_SCREENSHOTS=1 npm run qa` keeps what was taken as the new screenshots, for a change to the page meant to
  show; fonts and rendering differ from one machine to another, so the screenshots are taken where they are compared
## Scenarios
- **Loading** with no repository selected: the field empty, the hint, no skills, no filter
- **Partial name**: the owner alone, `JetBrains`, scans the organization, its 3 repositories and 10 skills; part of a
  repository's name, `JetBrains/kot`, is not completed: the repository is not found
- **Existing repository**, `JetBrains/kotlin`: its 5 skills, sorted, and the address to share
- **Non-existing repository**, `JetBrains/elsewhere`: the error, no skills, no filter
- **Filter**, after scanning `JetBrains`: **empty**, typed then cleared, every skill and no note; an **existing name**,
  `mps-build`: that skill alone, `1 of 10 skills match`, only its repository; a **non-existing name**: no skills,
  `No skills match “…”`, no repository
