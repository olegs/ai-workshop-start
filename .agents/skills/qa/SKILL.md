---
name: qa
description: Run and troubleshoot Playwright UI tests, maintain screenshots, and add tests for specification cases.
---

Test the web view as a person sees it: the Playwright tests in `qa/web.spec.ts`, each page compared with its screenshot. What they cover and why: [spec/qa.md](../../../spec/qa.md).

Setup, once in a fresh checkout:
* `npm ci`
* Chromium for Playwright: `npx playwright install --with-deps chromium`. Where its download is blocked, use another Chromium and point `CHROMIUM_PATH` at it, e.g. in an empty directory outside the repository, `npm init -y && npm i @sparticuz/chromium`, then there `node -e "import('@sparticuz/chromium').then(async m => console.log(await m.default.executablePath()))"` unpacks it and prints its path, `/tmp/chromium`.

Run:
* `npm run qa` runs every test, with `qa/playwright.config.ts`, over the mock data (spec/demo.md); no network. One test: `npm run qa -- -g "<part of its name>"`.
* `npm test` runs them too, as `tests/qa.test.ts`; without Chromium it is skipped, so a skip is not a pass: run `npm run qa` yourself.
* Add `CHROMIUM_PATH=<path>` before either when not using Playwright's own Chromium.

A failing test:
* A text or a count is wrong: the page changed what it shows. Fix the page, or the test if the spec changed.
* `toHaveScreenshot` failed, `pixels … are different`: open `<name>-actual.png` and `<name>-diff.png` (the differing pixels in red) in `test-results/qa/<test>/` and compare them with `qa/screenshots/<name>.png`.
  * An unintended difference is a bug: fix the page, never the screenshot.
  * An intended one, a change to the page meant to show: `npm run qa -- --update-snapshots`, then look at every changed screenshot before committing it.
* The screenshots depend on the machine's fonts and rendering: when every screenshot differs and nothing in the page changed, they were taken elsewhere; retake them with `--update-snapshots` only after checking each looks right.

Changing the tests:
* A new case in spec/web.md gets a test in `qa/web.spec.ts`, in the `test.describe` of its area, named for what a person sees; `await matchesScreenshot(page, '<name>')` last, `<name>` unique, in kebab-case.
* Use the helpers there, `open`, `scan`, `filter`, `skills`, `repositories`; assert the text a person reads with `expect`, then the screenshot.
* Take its screenshot with `npm run qa -- --update-snapshots`, look at it, and commit it with the test; `tests/qa.test.ts` checks each screenshot named has its file, and no other file is in `qa/screenshots`.
* Update spec/qa.md, its Tests, with the code.

Done when `npm run qa` passes with every test, and `npm test` passes.
