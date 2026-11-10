import { expect, test, type Page } from '@playwright/test';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { createReviewPreference, installPackReview, packNames, selectReviewPack } from './widget-design-packs.mock';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';

test.setTimeout(240_000);

async function appearance(page: Page, width: number) {
  if (width < 1024) {
    await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption('appearance');
  } else {
    await page.getByRole('navigation', { name: 'Settings categories', exact: true })
      .getByRole('button', { name: /Appearance & experience/ }).click();
  }
  return page.locator('[aria-labelledby="settings-widget-design-packs"]');
}

test.afterAll(async () => { await closeMockApiFixtures(); });

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390]) {
    test(`Application design languages at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const saved = createReviewPreference();
      const mocks = await installPackReview(page, theme, width, false,
        [['vehicle-hero', 'Vehicle card'], ['battery-gauge', 'Battery']], false, saved,
        testInfo.project.use.baseURL);
      await page.goto('/settings');
      await waitForHarnessReady(page, mocks);
      let picker = await appearance(page, width);
      const root = page.locator('html');
      await expect(picker.getByRole('button', { name: 'Classic active', exact: true })).toBeDisabled();
      await expect(root).not.toHaveAttribute('data-app-design-pack');
      await picker.getByRole('button', { name: 'Use Quiet Form pack', exact: true }).click();
      await expect(picker.getByRole('button', { name: 'Quiet Form active', exact: true })).toBeDisabled();
      await expect(root).not.toHaveAttribute('data-app-design-pack');
      await picker.getByRole('combobox', { name: 'Apply design to', exact: true }).selectOption('app');
      await expect(root).toHaveAttribute('data-app-design-pack', 'quiet');
      await root.evaluate(element => {
        element.style.setProperty('--font-scale', '1.35');
        element.style.setProperty('--tracking', '0.03em');
      });
      const preferences = await root.evaluate(element => {
        const style = getComputedStyle(element);
        return Object.fromEntries(['--theme-accent', '--surface-1', '--font-sans', '--font-mono',
          '--font-scale', '--leading', '--tracking', '--semantic-danger', '--semantic-success']
          .map(key => [key, style.getPropertyValue(key)]));
      });
      const languages = new Set<string>();
      for (const packId of Object.keys(packNames) as PackId[]) {
        await selectReviewPack(page, packId);
        if (packId === 'classic') {
          await expect(root).not.toHaveAttribute('data-app-design-pack');
        } else {
          await expect(root).toHaveAttribute('data-app-design-pack', packId);
        }
        const rendered = await picker.evaluate(element => {
          const style = getComputedStyle(element);
          const rootStyle = getComputedStyle(document.documentElement);
          return {
            treatment: [style.borderRadius, style.borderStyle, style.borderWidth, style.boxShadow,
              rootStyle.getPropertyValue('--app-pattern')].join('|'),
            overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
          };
        });
        languages.add(rendered.treatment);
        expect(rendered.overflow, `${packId} settings width`).toBe(false);
        expect(await root.evaluate(element => ({
          scale: element.style.getPropertyValue('--font-scale'),
          tracking: element.style.getPropertyValue('--tracking'),
        }))).toEqual({ scale: '1.35', tracking: '0.03em' });
      }
      expect(languages.size, 'designs have distinct rendered treatments').toBeGreaterThanOrEqual(24);
      await root.evaluate(element => {
        element.style.removeProperty('--font-scale');
        element.style.removeProperty('--tracking');
      });
      delete preferences['--font-scale'];
      delete preferences['--tracking'];
      for (const packId of ['quiet', 'material', 'brutal'] as const) {
        await selectReviewPack(page, packId);
        await expect(root).toHaveAttribute('data-app-design-pack', packId);
        for (const path of ['/', '/drives', '/settings']) {
          await page.goto(path);
          await waitForHarnessReady(page, mocks);
          await expect(root).toHaveAttribute('data-app-design-pack', packId);
          expect(await root.evaluate(element => element.scrollWidth > window.innerWidth + 2),
            `${packId} ${path} overflow`).toBe(false);
          await page.screenshot({
            path: testInfo.outputPath(`${theme}-${width}-${packId}-${path === '/' ? 'dashboard' : path.slice(1)}.png`),
            animations: 'disabled',
          });
        }
        picker = await appearance(page, width);
        await picker.getByRole('button', { name: `Preview ${packNames[packId]}`, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: `Preview ${packNames[packId]}`, exact: true });
        await expect(dialog.getByRole('heading', { name: 'Application preview', exact: true })).toBeVisible();
        await expect(dialog.getByRole('textbox', { name: 'Sample vehicle', exact: true })).toHaveValue('Model Y');
        expect(await dialog.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
        await dialog.screenshot({ path: testInfo.outputPath(`${theme}-${width}-${packId}-dialog.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
      expect(await root.evaluate((element, expected) => {
        const style = getComputedStyle(element);
        return Object.entries(expected).every(([key, value]) => style.getPropertyValue(key) === value);
      }, preferences)).toBe(true);
      await page.emulateMedia({ forcedColors: 'active' });
      expect(await picker.evaluate(element => getComputedStyle(element).borderRadius)).toBe('10px');
      await page.emulateMedia({ forcedColors: 'none' });
      await picker.getByRole('combobox', { name: 'Apply design to', exact: true }).selectOption('widgets');
      await expect(root).not.toHaveAttribute('data-app-design-pack');
      await expect(picker.getByRole('button', { name: 'Neo Brutal active', exact: true })).toBeDisabled();
      await picker.getByRole('combobox', { name: 'Apply design to', exact: true }).selectOption('app');
      await expect(root).toHaveAttribute('data-app-design-pack', 'brutal');
      await page.goto('/watch');
      await expect(root).not.toHaveAttribute('data-app-design-pack');
      expect(failures).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }
}
