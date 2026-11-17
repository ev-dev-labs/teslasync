import { expect, type Page, type TestInfo } from '@playwright/test';
import { routeBuiltApplication, test } from './app-design-test';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installPackReview, selectReviewPack } from './widget-design-packs.mock';
import { alternateConversation, syntheticConversation } from './widget-design-packs.specialized.fixtures';
import { installSpecializedReviewSources } from './widget-design-packs.specialized.mock';

test.afterAll(async () => { await closeMockApiFixtures(); });

async function openChat(page: Page, testInfo: TestInfo, width: number) {
  const origin = testInfo.project.use.baseURL;
  if (typeof origin !== 'string') throw new Error('A running application origin is required');
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const preference = createReviewPreference();
  preference.app_wide = true;
  const mocks = await installPackReview(page, 'dark', width, false, [], false, preference, origin, {
    theme: 'custom', custom_primary: '#9c6ade', custom_accent: '#c0842b',
    font_family: 'custom', font_custom_sans: 'Georgia', font_mono: 'custom', font_custom_mono: 'Consolas',
    font_scale: 1.15, font_leading: 1.75, font_tracking: '0.015em', font_heading_weight: 600,
    unit_of_length: 'mi', unit_of_temp: 'F', unit_of_pressure: 'psi', chart_palette: 'neon',
  });
  await installSpecializedReviewSources(page, mocks, 'dark');
  await page.addInitScript(() => localStorage.setItem('teslasync:low-bandwidth:v1', 'on'));
  await routeBuiltApplication(page, new URL(origin).origin, ['/chatbot'], process.env.DESIGN_PACK_DIST_DIR);
  await page.goto('/chatbot');
  await waitForHarnessReady(page, mocks);
  return mocks;
}

test('Helix history retains mouse, double-click and keyboard access after scrolling', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const mocks = await openChat(page, testInfo, 1440);
  const main = page.locator('main');
  const history = main.getByRole('button', { name: 'History', exact: true });
  const transcript = main.getByRole('log', { name: 'Conversation', exact: true });
  const first = page.getByRole('button', { name: new RegExp(`^${syntheticConversation}`) });
  const alternate = page.getByRole('button', { name: new RegExp(`^${alternateConversation}`) });

  for (const pack of ['blueprint', 'editorial', 'editorial'] as const) {
    await selectReviewPack(page, pack);
    await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack);
    if (await history.getAttribute('aria-pressed') !== 'true') await history.click();
    const sessions = page.getByRole('complementary', { name: 'History', exact: true });
    await sessions.getByRole('button', { name: 'New chat', exact: true }).click();
    const composer = main.getByRole('textbox', { name: 'Message', exact: true });
    const suggestions = main.locator('[data-app-part~="conversation-welcome"]')
      .getByRole('list', { name: 'Suggested prompts', exact: true }).getByRole('button');
    await expect(suggestions).toHaveCount(4);
    for (const suggestion of await suggestions.all()) {
      await suggestion.click();
      await expect(composer).toHaveValue(await suggestion.innerText());
      await expect(composer).toBeFocused();
    }
    await composer.fill('');
    if (await history.getAttribute('aria-pressed') !== 'true') await history.click();
    await alternate.click();
    await expect(transcript).toContainText('QA alternate question');
    if (await history.getAttribute('aria-pressed') !== 'true') await history.click();
    await first.click();
    await expect(transcript).toContainText('QA recorded question');
  }

  await first.dblclick();
  const rename = page.getByRole('textbox', { name: 'Rename conversation', exact: true });
  await expect(rename).toBeFocused();
  await rename.press('Escape');
  await expect(rename).toBeHidden();
  await alternate.focus();
  await alternate.press('Enter');
  await expect(transcript).toContainText('QA alternate question');
  await assertMockApiComplete(page, mocks);
});

test.describe('Helix touch history', () => {
  test.use({ hasTouch: true });

  test('selects and renames a session from the phone history drawer', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const mocks = await openChat(page, testInfo, 390);
    const history = page.getByRole('button', { name: 'History', exact: true });
    await history.tap();
    await page.getByRole('button', { name: new RegExp(`^${alternateConversation}`) }).tap();
    await expect(page.getByRole('log', { name: 'Conversation', exact: true })).toContainText('QA alternate question');
    await history.tap();
    const drawer = page.getByRole('dialog', { name: 'History', exact: true });
    const row = drawer.getByRole('listitem').filter({ hasText: alternateConversation });
    await row.getByRole('button', { name: 'Rename conversation', exact: true }).tap();
    const rename = drawer.getByRole('textbox', { name: 'Rename conversation', exact: true });
    await expect(rename).toBeFocused();
    await rename.press('Escape');
    await expect(rename).toBeHidden();
    await assertMockApiComplete(page, mocks);
  });
});
