#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { DOCS_SCREENSHOT_ROUTES } from '../e2e/docsRoutes.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDirectory = resolve(
  repositoryRoot,
  process.env.DOCS_SCREENSHOT_DIR ?? 'docs/public/screenshots',
);
const storageState = process.env.E2E_STORAGE_STATE?.trim() || undefined;

if (process.argv.includes('--list')) {
  for (const route of DOCS_SCREENSHOT_ROUTES) {
    console.log(`${route.name}\t${route.path}`);
  }
  process.exit(0);
}

if (storageState && !existsSync(storageState)) {
  throw new Error(`E2E_STORAGE_STATE does not exist: ${storageState}`);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  storageState,
  viewport: { width: 1440, height: 900 },
  colorScheme: process.env.DOCS_SCREENSHOT_THEME === 'light' ? 'light' : 'dark',
  reducedMotion: 'reduce',
});

try {
  for (const route of DOCS_SCREENSHOT_ROUTES) {
    const page = await context.newPage();
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor({ state: 'visible' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const destination = resolve(outputDirectory, `${route.name}.png`);
    await page.screenshot({ path: destination, fullPage: false });
    console.log(`Captured ${route.path} -> ${destination}`);
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}
