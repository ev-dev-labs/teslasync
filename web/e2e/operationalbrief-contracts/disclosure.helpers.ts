import { expect, type Locator, type Page } from '@playwright/test';

/** Brief cards publish labels and values; source context is disclosed in the drawer. */
export async function expectBriefDetails(
  page: Page, brief: Locator, texts: readonly (string | RegExp)[], absent: readonly (string | RegExp)[] = [],
) {
  const trigger = brief.getByRole('button', { name: 'Review details', exact: true });
  await trigger.click();
  const drawer = page.getByRole('dialog').filter({ has: page.getByTestId('operational-narrative') });
  await expect(drawer).toBeVisible();
  for (const text of texts) await expect(drawer).toContainText(text);
  for (const text of absent) await expect(drawer).not.toContainText(text);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
}
