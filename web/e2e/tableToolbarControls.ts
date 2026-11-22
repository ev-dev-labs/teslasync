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

export async function openTableColumnLayout(controls: Locator): Promise<Locator> {
  await controls.getByRole('button', { name: 'Reorder or hide columns', exact: true }).click();
  const layout = controls.page().getByRole('dialog', { name: 'Reorder or hide columns', exact: true });
  await expect(layout).toBeVisible();
  return layout;
}

export async function expectTableDensityControls(layout: Locator): Promise<void> {
  const compact = layout.getByRole('radio', { name: 'Compact', exact: true });
  const comfortable = layout.getByRole('radio', { name: 'Comfortable', exact: true });
  await compact.click();
  await expect(compact).toBeChecked();
  await comfortable.click();
  await expect(comfortable).toBeChecked();
}
