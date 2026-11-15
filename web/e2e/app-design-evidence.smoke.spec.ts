import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { attachJsonEvidence } from './app-design-test';

test('large design evidence remains complete and file-backed', async () => {
  const testInfo = test.info();
  const evidence = {
    scope: { pack: 'classic', width: 390 },
    observations: Array.from({ length: 10_000 }, (_, index) => ({ family: 'charts', width: 320 + index })),
  };
  await attachJsonEvidence(testInfo, 'design-evidence.json', evidence);

  const attachment = testInfo.attachments.find(item => item.name === 'design-evidence.json');
  expect(attachment?.contentType).toBe('application/json');
  expect(attachment?.body).toBeUndefined();
  expect(attachment?.path).toBeTruthy();
  expect(JSON.parse(await readFile(attachment!.path!, 'utf8'))).toEqual(evidence);
});
