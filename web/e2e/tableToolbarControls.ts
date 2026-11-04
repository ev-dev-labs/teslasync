import { expect, type Locator } from '@playwright/test';

export async function openTableToolbarControls(frame: Locator): Promise<Locator> {
  const more = frame.getByRole('button', { name: 'More', exact: true });
  if (!await more.isVisible()) return frame;
  await more.focus();
  await more.press('Enter');
  const dialog = frame.page().getByRole('dialog', { name: 'More', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeTableToolbarControls(controls: Locator): Promise<void> {
  if (await controls.getAttribute('role') !== 'dialog') return;
  await controls.press('Escape');
  await expect(controls).toHaveCount(0);
}
