// The expected screenshots, the test data: qa/screenshots/<name>.png. A screenshot that differs is written to
// test-results/qa/<name>.actual.png, with the differing pixels in <name>.diff.png.
// QA_UPDATE_SCREENSHOTS=1 writes the screenshots taken as the expected ones instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const EXPECTED = fileURLToPath(new URL('../screenshots/', import.meta.url));
export const RESULTS = fileURLToPath(new URL('../../test-results/qa/', import.meta.url));
/** How far a pixel's colour may drift, 0 to 1, and how many pixels may differ: antialiasing, not a change. */
const THRESHOLD = 0.05;
const MAX_DIFFERENT = 0.001;

export const updating = () => process.env.QA_UPDATE_SCREENSHOTS === '1';

/** Compares `actual`, a PNG, with the expected screenshot `name`; throws, saying where to look, if they differ. */
export function compareScreenshot(name: string, actual: Buffer): void {
  const expectedPath = `${EXPECTED}${name}.png`;
  if (updating()) {
    mkdirSync(EXPECTED, { recursive: true });
    writeFileSync(expectedPath, actual);
    return;
  }
  const keep = () => {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(`${RESULTS}${name}.actual.png`, actual);
    return `${RESULTS}${name}.actual.png`;
  };
  if (!existsSync(expectedPath)) {
    throw new Error(`No expected screenshot ${expectedPath}; the one taken: ${keep()}. Run with QA_UPDATE_SCREENSHOTS=1 to keep it.`);
  }
  const expected = PNG.sync.read(readFileSync(expectedPath));
  const taken = PNG.sync.read(actual);
  if (expected.width !== taken.width || expected.height !== taken.height) {
    throw new Error(`Screenshot ${name}: ${taken.width}×${taken.height}, expected ${expected.width}×${expected.height}; the one taken: ${keep()}`);
  }
  const diff = new PNG({ width: taken.width, height: taken.height });
  const different = pixelmatch(expected.data, taken.data, diff.data, taken.width, taken.height, { threshold: THRESHOLD });
  if (different > taken.width * taken.height * MAX_DIFFERENT) {
    const actualPath = keep();
    writeFileSync(`${RESULTS}${name}.diff.png`, PNG.sync.write(diff));
    throw new Error(`Screenshot ${name}: ${different} pixels differ from ${expectedPath}; the one taken: ${actualPath}, the difference: ${RESULTS}${name}.diff.png`);
  }
}
