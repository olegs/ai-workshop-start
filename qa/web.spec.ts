// The QA tests of spec/qa.md: what a person does on the page and sees, each page then compared with its
// screenshot in qa/screenshots. Over the mock data: JetBrains, its repositories koog, kotlin and MPS, 10 skills.
import { expect, test, type Page } from '@playwright/test';

const skills = (page: Page) => page.locator('#results .skill .name:visible');
const repositories = (page: Page) => page.locator('#repositories .repository:visible > :first-child a:first-child');

/** Opens the page, its repository field ready. */
async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('#repo')).toBeVisible();
}

/** Types `repo` into the repository field, presses Scan, and waits for the scan to end. */
async function scan(page: Page, repo: string) {
  await page.locator('#repo').click();
  await page.keyboard.type(repo);
  await page.locator('#scan').click();
  await expect(page.locator('#scan')).toBeEnabled();
  await expect(page.locator('#loading')).toBeHidden();
}

/** Types `text` into the filter field. */
async function filter(page: Page, text: string) {
  await page.locator('#filter').click();
  await page.keyboard.type(text);
}

/** The whole page, as its screenshot `name`. */
const matchesScreenshot = (page: Page, name: string) => expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });

test.describe('loading', () => {
  test('with no repository selected: the field empty, the hint, no skills, no filter', async ({ page }) => {
    await open(page);
    await expect(page.locator('#repo')).toHaveValue('');
    await expect(page.locator('#status')).toHaveText('Enter a repository or an organization and press Scan.');
    await expect(skills(page)).toHaveCount(0);
    await expect(page.locator('#filter-box')).toBeHidden();
    await matchesScreenshot(page, 'loading-no-repository');
  });
});

test.describe('scanning a repository by its name', () => {
  test.beforeEach(async ({ page }) => open(page));

  test('a partial name, the owner alone, scans the organization', async ({ page }) => {
    await scan(page, 'JetBrains');
    await expect(page.locator('#status')).toHaveText('JetBrains · 3 repositories · 10 skills');
    await expect(repositories(page)).toHaveText(['JetBrains/koog', 'JetBrains/kotlin', 'JetBrains/MPS']);
    await expect(skills(page)).toHaveCount(10);
    await matchesScreenshot(page, 'partial-name-owner');
  });

  test('a partial repository name is not completed to a repository', async ({ page }) => {
    await scan(page, 'JetBrains/kot');
    await expect(page.locator('#status')).toHaveClass('error');
    await expect(page.locator('#status')).toContainText('not recorded: https://api.github.com/repos/JetBrains/kot');
    await expect(skills(page)).toHaveCount(0);
    await matchesScreenshot(page, 'partial-name-repository');
  });

  test('an existing repository: its skills, sorted, and the address to share', async ({ page }) => {
    await scan(page, 'JetBrains/kotlin');
    await expect(page.locator('#status')).toHaveText('JetBrains/kotlin · 5 skills');
    await expect(skills(page)).toHaveText([
      'build-tools-bump-gradle-api', 'compiler-test-data', 'gradle-plugin-tests', 'release-notes', 'stdlib-api-review',
    ]);
    expect(new URL(page.url()).search).toBe('?repo=JetBrains%2Fkotlin');
    await matchesScreenshot(page, 'existing-repository');
  });

  test('a repository that does not exist: the error, no skills, no filter', async ({ page }) => {
    await scan(page, 'JetBrains/elsewhere');
    await expect(page.locator('#status')).toHaveClass('error');
    await expect(page.locator('#status')).toContainText('not recorded: https://api.github.com/repos/JetBrains/elsewhere');
    await expect(skills(page)).toHaveCount(0);
    await expect(page.locator('#filter-box')).toBeHidden();
    await matchesScreenshot(page, 'non-existing-repository');
  });
});

test.describe('filtering the skills of the organization JetBrains', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await scan(page, 'JetBrains');
  });

  test('an empty filter, typed then cleared, shows every skill', async ({ page }) => {
    await filter(page, 'koog');
    await page.locator('#filter').fill('');
    await expect(skills(page)).toHaveCount(10);
    await expect(page.locator('#filter-note')).toBeHidden();
    await expect(repositories(page)).toHaveText(['JetBrains/koog', 'JetBrains/kotlin', 'JetBrains/MPS']);
    await matchesScreenshot(page, 'filter-empty');
  });

  test('an existing name shows only its skill and its repository', async ({ page }) => {
    await filter(page, 'mps-build');
    await expect(skills(page)).toHaveText(['mps-build']);
    await expect(page.locator('#filter-note')).toHaveText('1 of 10 skills match');
    await expect(repositories(page)).toHaveText(['JetBrains/MPS']);
    await matchesScreenshot(page, 'filter-existing-name');
  });

  test('a name that does not exist shows no skills and no repository', async ({ page }) => {
    await filter(page, 'no-such-skill');
    await expect(skills(page)).toHaveCount(0);
    await expect(page.locator('#filter-note')).toHaveText('No skills match “no-such-skill”.');
    await expect(repositories(page)).toHaveCount(0);
    await matchesScreenshot(page, 'filter-non-existing-name');
  });
});

test.describe('clustering the skills of the organization JetBrains', () => {
  const groups = (page: Page) => page.locator('#cluster-groups .cluster:visible h2');
  const points = (page: Page) => page.locator('#cluster-map .scatterlayer .point');

  test.beforeEach(async ({ page }) => {
    await open(page);
    await scan(page, 'JetBrains');
    await page.locator('#cluster').click();
    await expect(page.locator('#cluster-map .main-svg').first()).toBeVisible();
  });

  test('Cluster groups similar skills: the map, a section for each group, the rest last', async ({ page }) => {
    await expect(page.locator('#cluster')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cluster-note')).toContainText('2 groups of similar skills, 4 skills in none');
    await expect(groups(page)).toHaveText(['koog · agent · 3 skills', 'gradle · build · plugin · 3 skills', 'Other skills · 4 skills']);
    await expect(points(page)).toHaveCount(10);
    await expect(page.locator('#repositories')).toBeHidden();
    await matchesScreenshot(page, 'cluster-groups');
  });

  test('the filter narrows the groups and the map', async ({ page }) => {
    await filter(page, 'koog');
    await expect(groups(page)).toHaveText(['koog · agent · 3 skills']);
    await expect(points(page)).toHaveCount(3);
    await expect(page.locator('#filter-note')).toHaveText('3 of 10 skills match');
    await matchesScreenshot(page, 'cluster-filter');
  });

  test('a point on the map: hovered, its skill; clicked, its card lit up; Cluster again, the list', async ({ page }) => {
    // Plotly's drag layer lies over its points: the mouse goes where the point is, as a person's does.
    await page.locator('#cluster-map').scrollIntoViewIfNeeded();
    const box = (await page.locator('#cluster-map .scatterlayer .trace').nth(1).locator('.point').last().boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await expect(page.locator('#cluster-map .hovertext')).toContainText('mps-build');
    await expect(page.locator('#cluster-map .hovertext')).toContainText('JetBrains/MPS');
    await page.mouse.click(x, y);
    await expect(page.locator('#cluster-groups .skill.picked .name')).toHaveText('mps-build');
    await expect(page.locator('#cluster-groups .skill.picked .name')).toBeFocused();
    await page.mouse.move(0, 0);
    await expect(page.locator('#cluster-map .hovertext')).toHaveCount(0);
    await matchesScreenshot(page, 'cluster-picked');
    await page.locator('#cluster').click();
    await expect(page.locator('#clusters')).toBeHidden();
    await expect(repositories(page)).toHaveText(['JetBrains/koog', 'JetBrains/kotlin', 'JetBrains/MPS']);
    await expect(skills(page)).toHaveCount(10);
  });
});
