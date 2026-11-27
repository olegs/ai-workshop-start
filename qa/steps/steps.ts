// The steps of the QA scenarios in qa/features: what a person does on the page, and what they see.
import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import { compareScreenshot } from '../support/screenshots.ts';
import type { PageWorld } from '../support/world.ts';

const list = (names: string) => names.split(',').map((name) => name.trim()).filter(Boolean);
/** The texts of the visible elements matching `selector`. */
const visibleTexts = (world: PageWorld, selector: string) =>
  world.page.locator(selector).evaluateAll((nodes) =>
    nodes.filter((node) => (node as HTMLElement).checkVisibility()).map((node) => node.textContent!.trim()));

Given('I open the page', async function (this: PageWorld) {
  await this.page.goto(this.base);
  await this.page.locator('#repo').waitFor();
});

When('I type {string} into the repository field', async function (this: PageWorld, text: string) {
  await this.page.locator('#repo').click();
  await this.page.keyboard.type(text);
});

When('I press Scan', async function (this: PageWorld) {
  await this.page.locator('#scan').click();
  // The scan is over: the button back, no placeholders.
  await this.page.waitForFunction(() =>
    !(document.getElementById('scan') as HTMLButtonElement).disabled && document.getElementById('loading')!.hidden);
});

When('I type {string} into the filter field', async function (this: PageWorld, text: string) {
  await this.page.locator('#filter').click();
  await this.page.keyboard.type(text);
});

When('I clear the filter field', async function (this: PageWorld) {
  await this.page.locator('#filter').click();
  await this.page.keyboard.press('ControlOrMeta+A');
  await this.page.keyboard.press('Backspace');
});

Then('the repository field is empty', async function (this: PageWorld) {
  assert.equal(await this.page.locator('#repo').inputValue(), '');
});

Then('the status reads {string}', async function (this: PageWorld, text: string) {
  assert.equal((await this.page.locator('#status').textContent())?.trim(), text);
});

Then('the status shows the error {string}', async function (this: PageWorld, text: string) {
  const status = this.page.locator('#status');
  assert.equal(await status.getAttribute('class'), 'error');
  assert.match((await status.textContent()) ?? '', new RegExp(text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
});

Then('no skills are shown', async function (this: PageWorld) {
  assert.deepEqual(await visibleTexts(this, '#results .skill .name'), []);
});

Then('{int} skills are shown', async function (this: PageWorld, count: number) {
  assert.equal((await visibleTexts(this, '#results .skill .name')).length, count);
});

Then('the skills shown are {string}', async function (this: PageWorld, names: string) {
  assert.deepEqual(await visibleTexts(this, '#results .skill .name'), list(names));
});

Then('the repositories shown are {string}', async function (this: PageWorld, names: string) {
  const shown = await this.page.locator('#repositories .repository').evaluateAll((sections) =>
    sections.filter((section) => (section as HTMLElement).checkVisibility())
      .map((section) => section.querySelector('a')!.textContent!.trim()));
  assert.deepEqual(shown, list(names));
});

Then('no repositories are shown', async function (this: PageWorld) {
  assert.deepEqual(await visibleTexts(this, '#repositories .repository'), []);
});

Then('the filter field is hidden', async function (this: PageWorld) {
  assert.equal(await this.page.locator('#filter-box').isVisible(), false);
});

Then('the filter note is hidden', async function (this: PageWorld) {
  assert.equal(await this.page.locator('#filter-note').isVisible(), false);
});

Then('the filter note reads {string}', async function (this: PageWorld, text: string) {
  assert.equal((await this.page.locator('#filter-note').textContent())?.trim(), text);
});

Then('the address has {string}', async function (this: PageWorld, search: string) {
  assert.equal(new URL(this.page.url()).search, search);
});

Then('the page matches the screenshot {string}', async function (this: PageWorld, name: string) {
  const screenshot = await this.page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  compareScreenshot(name, screenshot);
});
