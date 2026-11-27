Test the web view as a person sees it: the Cucumber scenarios in `qa/`, each page compared with its screenshot. What they cover and why: [spec/qa.md](../spec/qa.md).

Setup, once in a fresh checkout:
* `npm ci`
* Chromium for Playwright: `npx playwright install --with-deps chromium`. Where its download is blocked, use another Chromium and point `CHROMIUM_PATH` at it, e.g. in an empty directory outside the repository, `npm init -y && npm i @sparticuz/chromium`, then there `node -e "import('@sparticuz/chromium').then(async m => console.log(await m.default.executablePath()))"` unpacks it and prints its path, `/tmp/chromium`.

Run:
* `npm run qa` runs every scenario in `qa/features/*.feature` over the mock data (spec/demo.md); no network.
* `npm test` runs them too, as `tests/qa.test.ts`; without Chromium it is skipped, so a skip is not a pass: run `npm run qa` yourself.
* Add `CHROMIUM_PATH=<path>` before either when not using Playwright's own Chromium.

A failing scenario:
* A step's text or count is wrong: the page changed what it shows. Fix the page, or the scenario if the spec changed.
* `pixels differ`: open `test-results/qa/<name>.actual.png` and `<name>.diff.png` (the differing pixels in red) and compare them with `qa/screenshots/<name>.png`.
  * An unintended difference is a bug: fix the page, never the screenshot.
  * An intended one, a change to the page meant to show: `QA_UPDATE_SCREENSHOTS=1 npm run qa`, then look at every changed screenshot before committing it.
* The screenshots depend on the machine's fonts and rendering: when every screenshot differs and nothing in the page changed, they were taken elsewhere; retake them with `QA_UPDATE_SCREENSHOTS=1` only after checking each looks right.

Changing the scenarios:
* A new case in spec/web.md gets a scenario: in the feature file of its area, a `Then the page matches the screenshot "<name>"` step last, `<name>` unique, in kebab-case.
* Reuse the steps in `qa/steps/steps.ts`; add a step there only when none says it. Assert the text a person reads, then the screenshot.
* Take its screenshot with `QA_UPDATE_SCREENSHOTS=1 npm run qa`, look at it, and commit it with the scenario; `tests/qa.test.ts` checks each screenshot named has its file, and no other file is in `qa/screenshots`.
* Update spec/qa.md, its Scenarios, with the code.

Done when `npm run qa` passes with every scenario, and `npm test` passes.
