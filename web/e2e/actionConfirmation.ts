import { expect, type Page } from '@playwright/test';

export async function confirmSensitiveAction(page: Page, path: string) {
  const dialog = page.getByRole('dialog', { name: 'Confirm sensitive action', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(path, { exact: true })).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Confirm', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill('CONFIRM');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
}
