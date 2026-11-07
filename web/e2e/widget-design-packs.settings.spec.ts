import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertMockApiComplete, closeMockApiFixtures, waitForHarnessReady } from './mockApi';
import { installPackReview, packNames, preferenceKey } from './widget-design-packs.mock';
import type { PackId } from '../src/features/dashboard/widgets/designPacks/types';

const reviewDirectory = fileURLToPath(new URL('../test-results/widget-design-packs/settings-review/', import.meta.url));

test.beforeAll(async () => { await mkdir(reviewDirectory, { recursive: true }); });
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const theme of ['dark', 'light'] as const) {
  for (const width of [1440, 390]) {
    test(`Settings previews and browser-profile selection at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const mocks = await installPackReview(page, theme, width);
      await page.goto('/settings');
      await waitForHarnessReady(page, mocks);
      if (width < 1024) {
        await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption('appearance');
      } else {
        await page.getByRole('navigation', { name: 'Settings categories', exact: true })
          .getByRole('button', { name: /Appearance & experience/ }).click();
      }
      const selector = page.locator('[aria-labelledby="settings-widget-design-packs"]');
      await expect(selector.getByRole('heading', { name: 'Widget design packs' })).toBeVisible();
      await expect(selector.getByRole('button', { name: 'Classic active', exact: true })).toBeDisabled();
      const geometry = await selector.locator('section').evaluateAll(cards => cards.map(card => {
        const stage = card.firstElementChild!.getBoundingClientRect();
        const buttons = [...card.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        return { overflow: card.scrollWidth > card.clientWidth + 2,
          cardTop: card.getBoundingClientRect().top, stageHeight: stage.height,
          buttons: buttons.map(button => ({ top: button.top, height: button.height })) };
      }));
      expect(geometry).toHaveLength(8);
      for (const card of geometry) {
        expect(card.stageHeight).toBe(192);
        expect(card.overflow).toBe(false);
        expect(card.buttons[0].top).toBe(card.buttons[1].top);
        expect(card.buttons[0].height).toBeGreaterThanOrEqual(44);
        expect(card.buttons[1].height).toBeGreaterThanOrEqual(44);
        for (const peer of geometry.filter(peer => Math.abs(peer.cardTop - card.cardTop) < 1)) {
          expect(Math.abs(peer.buttons[0].top - card.buttons[0].top)).toBeLessThanOrEqual(1);
        }
      }
      for (const name of Object.values(packNames).filter(name => name !== 'Classic')) {
        await expect(selector.getByRole('button', { name: `Use ${name} pack`, exact: true })).toBeEnabled();
      }
      await selector.scrollIntoViewIfNeeded();
      await selector.screenshot({ path: `${reviewDirectory}${theme}-${width}-selector.png`, animations: 'disabled' });
      const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
      const knownReaders = new Set(mocks.requests.map(request => request.path));
      for (const [packId, name] of Object.entries(packNames) as [PackId, string][]) {
        const opener = selector.getByRole('button', { name: `Preview ${name}`, exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog', { name: `Preview ${name}`, exact: true });
        await expect(dialog.locator('[data-widget-pack-preview]')).toHaveAttribute('data-widget-pack', packId);
        await expect(dialog.getByText('Loading preview...', { exact: true })).toHaveCount(0);
        for (const heading of ['Vehicle', 'Battery', 'History', 'Status', 'Commands']) {
          const panel = dialog.locator('[data-widget-pack-preview] > div > [data-surface-variant="standalone"]')
            .filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
          await expect(panel).toBeVisible();
          expect(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 2),
            `${packId}/${heading} horizontal overflow`).toBe(false);
          await panel.screenshot({
            path: `${reviewDirectory}${theme}-${width}-${packId}-${heading.toLowerCase()}.png`,
            animations: 'disabled',
          });
        }
        for (const action of ['Unlock', 'Climate', 'Flash lights']) {
          await expect(dialog.getByRole('button', { name: action, exact: true })).toBeDisabled();
        }
        await expect(dialog.locator('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'static');
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
        expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(before);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
      }
      expect(mocks.requests.filter(request => request.path.endsWith('/command'))).toEqual([]);
      expect(mocks.requests.filter(request => !knownReaders.has(request.path))).toEqual([]);
      await selector.getByRole('button', { name: 'Use Owner pack', exact: true }).click();
      await expect(selector.getByRole('button', { name: 'Owner active', exact: true })).toBeDisabled();
      const after = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
      expect(JSON.parse(after[preferenceKey])).toEqual({ version: 1, packId: 'v4' });
      const { [preferenceKey]: beforePack, ...beforeOther } = before;
      const { [preferenceKey]: afterPack, ...afterOther } = after;
      expect(beforePack).not.toEqual(afterPack);
      expect(afterOther).toEqual(beforeOther);
      await page.reload();
      if (width < 1024) {
        await page.getByRole('combobox', { name: 'Settings categories', exact: true }).selectOption('appearance');
      } else {
        await page.getByRole('navigation', { name: 'Settings categories', exact: true })
          .getByRole('button', { name: /Appearance & experience/ }).click();
      }
      await expect(selector.getByRole('button', { name: 'Owner active', exact: true })).toBeDisabled();
      const accents = page.getByRole('group', { name: 'Accent color', exact: true });
      await expect(accents.getByRole('button')).toHaveCount(21);
      for (const name of ['Blue', 'Red', 'Green', 'Purple', 'Amber', 'Sky', 'Teal', 'Emerald',
        'Forest', 'Lime', 'Yellow', 'Orange', 'Coral', 'Pink', 'Magenta', 'Lavender',
        'Indigo', 'Navy', 'Gold', 'Slate']) {
        const option = accents.getByRole('button', { name, exact: true });
        await option.click();
        await expect(option).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => option.evaluate(button => {
          const hex = getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim();
          const rgb = `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
          return rgb === getComputedStyle(button.querySelector<HTMLElement>('div[style]')!).backgroundColor;
        }), { message: `${name} applies the exact displayed swatch` }).toBe(true);
        expect(await page.evaluate(() => localStorage.getItem('teslasync-custom-primary'))).toBe('#00b4d8');
      }
      await accents.getByRole('button', { name: 'Custom', exact: true }).click();
      await expect.poll(() => page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--theme-primary').trim())).toBe('#00b4d8');
      await selector.screenshot({ path: `${reviewDirectory}${theme}-${width}-aligned-and-selected.png`, animations: 'disabled' });
      expect(failures).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }
}
