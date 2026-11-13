import { rm, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import sharp from 'sharp';
import { ROUTE_REGISTRY } from '../src/lib/routeRegistry';

export const CAPTURE_VIEWPORTS = [
  { name: 'phone-360', width: 360, height: 800 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-430', width: 430, height: 932 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const STANDALONE_ROUTES = new Set([
  '/connect', '/glance', '/onboarding', '/s/:token', '/watch', '/year-review/:year',
]);

const DETAIL_ROUTES: Readonly<Record<string, string>> = {
  '/automations/:id/edit': '/automations/701/edit',
  '/charging/:id': '/charging/201',
  '/drives/:id': '/drives/412',
  '/drives/:id/replay': '/drives/412/replay',
  '/system-status/incidents/:id': '/system-status/incidents/1',
  '/trips/:id': '/trips/603',
  '/vehicles/:id': '/vehicles/7',
  '/vehicles/:id/access': '/vehicles/7/access',
};

export interface CaptureRoute {
  template: string;
  path: string;
  file: string;
  name: string;
}

export function captureRoutes(): CaptureRoute[] {
  const routes = ROUTE_REGISTRY.filter(route =>
    !STANDALONE_ROUTES.has(route.path)
    && !route.path.startsWith('/dev/')
    && !route.name.startsWith('Legacy'));
  const result = routes.map(route => {
    const path = DETAIL_ROUTES[route.path] ?? route.path;
    if (path.includes(':') || path.includes('*')) {
      throw new Error(`Missing a synthetic capture URL for ${route.path}`);
    }
    return {
      template: route.path,
      path,
      file: path === '/' ? 'dashboard' : path.slice(1).replaceAll('/', '--'),
      name: route.name,
    };
  });
  if (new Set(result.map(route => route.file)).size !== result.length) {
    throw new Error('Design pack capture filenames must be unique');
  }
  return result;
}

export function selectCaptureRoutes(selection: string | undefined): CaptureRoute[] {
  const routes = captureRoutes();
  if (!selection?.trim()) return routes;
  const requested = new Set(selection.split(',').map(value => value.trim()).filter(Boolean));
  const selected = routes.filter(route => requested.has(route.file) || requested.has(route.template));
  for (const value of requested) {
    if (!selected.some(route => route.file === value || route.template === value)) {
      throw new Error(`Unknown design pack capture page: ${value}`);
    }
  }
  return selected;
}

export async function findHorizontalScrollRegions(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('*'))
    .filter(element => {
      if (element === document.documentElement || element === document.body
        || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (!['auto', 'scroll'].includes(style.overflowX)
        || style.visibility === 'hidden' || style.display === 'none'
        || box.width <= 0 || box.height <= 0 || element.scrollWidth <= element.clientWidth + 1) return false;
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (['absolute', 'fixed'].includes(ancestorStyle.position)
          && ancestorStyle.clip.replace(/\s+/g, '') === 'rect(0px,0px,0px,0px)') return false;
      }
      return true;
    })
    .map(element => ({
      tag: element.tagName.toLowerCase(),
      id: element.id,
      role: element.getAttribute('role'),
      part: element.getAttribute('data-app-part'),
      label: element.getAttribute('aria-label'),
      className: element.getAttribute('class'),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    })));
}

export async function findSmallTouchTargets(page: Page) {
  return page.evaluate(() => {
    const candidates = document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, '
      + '[role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], '
      + '[role="radio"], [role="slider"], [role="option"], [role^="menuitem"]',
    );
    const targets = new Set(Array.from(candidates, element => {
      if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
        return element.labels?.[0] ?? element;
      }
      return element;
    }));
    return Array.from(targets).flatMap(element => {
      if (element.matches(':disabled, [aria-disabled="true"]') || element.closest('[aria-hidden="true"]')) return [];
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (style.display === 'none' || style.visibility !== 'visible' || style.pointerEvents === 'none'
        || box.width <= 0 || box.height <= 0
        || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return [];
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== element && !element.contains(hit))) return [];
      if (box.width >= 43.9 && box.height >= 43.9) return [];
      return [{
        tag: element.tagName.toLowerCase(), id: element.id,
        role: element.getAttribute('role'),
        part: element.getAttribute('data-app-part'),
        className: element.getAttribute('class'),
        controlId: element instanceof HTMLLabelElement ? element.htmlFor : null,
        label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 100),
        width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10,
      }];
    });
  });
}

export async function findClippedBottomNavigationLabels(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(
    '[data-role="bottom-tab-bar"] .sidenav-tab-label',
  )).flatMap(label => {
    const navigation = label.closest<HTMLElement>('[data-role="bottom-tab-bar"]');
    const button = label.closest<HTMLElement>('button');
    if (!navigation || !button || getComputedStyle(label).visibility !== 'visible') return [];
    const navigationBox = navigation.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    if (navigationBox.width === 0 || navigationBox.height === 0 || buttonBox.width === 0) return [];
    const safePadding = parseFloat(getComputedStyle(navigation).paddingBottom) || 0;
    const bounds = {
      left: Math.max(0, navigationBox.left, buttonBox.left),
      right: Math.min(innerWidth, navigationBox.right, buttonBox.right),
      top: Math.max(0, navigationBox.top, buttonBox.top),
      bottom: Math.min(innerHeight, navigationBox.bottom - safePadding, buttonBox.bottom),
    };
    const range = document.createRange();
    range.selectNodeContents(label);
    const clipped = Array.from(range.getClientRects()).filter(rect =>
      rect.width > 0 && rect.height > 0 && (
        rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5
        || rect.top < bounds.top - 0.5 || rect.bottom > bounds.bottom + 0.5
      ));
    if (clipped.length === 0) return [];
    return [{
      label: label.textContent?.trim() ?? '',
      bounds,
      rects: clipped.map(({ left, right, top, bottom }) => ({ left, right, top, bottom })),
    }];
  }));
}

export async function findSplitBottomNavigationWords(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(
    '[data-role="bottom-tab-bar"] .sidenav-tab-label',
  )).flatMap(label => {
    const text = label.textContent?.trim() ?? '';
    const box = label.getBoundingClientRect();
    if (!/^[A-Za-z]+$/.test(text) || box.width === 0 || box.height === 0
      || getComputedStyle(label).visibility !== 'visible') return [];
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = new Set(Array.from(range.getClientRects())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => Math.round(rect.top)));
    return lines.size > 1 ? [{ label: text, lines: lines.size }] : [];
  }));
}

export const BODY_ROLE_SELECTOR = [
  '[data-typography-role="body"]',
  '[data-typography-role="bodySm"]',
  '.text-sm[class~="text-[var(--text-primary)]"]',
  '.text-sm[class~="text-[var(--text-secondary)]"]',
  '.text-sm[class~="text-[var(--text-muted)]"]',
].join(', ');

export async function findSmallBodyText(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(
    'p:not([data-typography-role]):not(.text-xs):not([data-app-part~="metric-label"]):not([data-app-part~="metric-context"]), '
    + '[data-typography-role="body"], [data-typography-role="bodySm"], '
    + '.text-sm[class~="text-[var(--text-primary)]"], .text-sm[class~="text-[var(--text-secondary)]"], .text-sm[class~="text-[var(--text-muted)]"], '
    + '[data-app-part~="feedback-title"], [data-app-part~="feedback-message"], '
    + '[data-app-part~="history-route"], [data-app-part~="list-row"] [data-history-primary] > :first-child, '
    + '[data-app-part~="list-row"] [data-app-metric-grid="inline"], '
    + '[data-app-part~="list-row"] [data-app-metric-grid="inline"] [data-app-metric="inline"], '
    + '[data-operational-metric-list] [data-app-part~="metric-label"], '
    + '[data-mobile-table] :is(.mgr-title, .mgr-primary, .mgr-meta-label, .mgr-meta-value), '
    + '[data-app-part~="dialog"] [data-app-part~="table-cell"] > :is(dt, dd), '
    + '[data-app-part~="dialog"] [data-app-part~="table-cell"] > dd :is(span, strong, code), '
    + '[data-app-part~="field-label"], '
    + 'a[href]:not(.sr-only), '
    + 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="hidden"], [type="color"])[data-app-part~="field-control"], '
    + 'select[data-app-part~="field-control"], textarea[data-app-part~="field-control"], '
    + 'button[data-app-part~="button"]:not([data-app-icon-only="true"])',
  )).flatMap(element => {
    if (element.closest('[aria-hidden="true"]')) return [];
    if (element.matches('a[href]') && element.closest('[data-role="status-bar"]')) return [];
    if (element.matches('[data-app-part~="metric-value"]')
      || (element.matches('[data-app-part~="metric-label"]') && !element.closest('[data-operational-metric-list]'))) return [];
    if (element.matches('[data-app-metric-grid="inline"]')
      && !Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) return [];
    const text = (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value || element.placeholder
      : element instanceof HTMLSelectElement
        ? element.selectedOptions[0]?.textContent ?? ''
        : element.innerText).trim().replace(/\s+/g, ' ');
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const size = parseFloat(style.fontSize);
    if (!text || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0
      || (box.width <= 1 && box.height <= 1) || box.right <= 0 || box.bottom <= 0
      || box.left >= innerWidth || box.top >= innerHeight || size >= 15.9) return [];
    return [{
      tag: element.tagName.toLowerCase(), id: element.id,
      role: element.getAttribute('data-typography-role'),
      part: element.getAttribute('data-app-part'),
      text: text.slice(0, 100), size: Math.round(size * 10) / 10,
    }];
  }));
}

export async function clearCaptureImages(
  viewportPath: string, fullPath: string, tablePath: string, captureStates: boolean,
): Promise<void> {
  const paths = captureStates ? [viewportPath, fullPath, tablePath] : [viewportPath, fullPath];
  await Promise.all(paths.map(path => rm(path, { force: true })));
}

export async function writeCaptureImages(viewportPath: string, fullPath: string, frames: Buffer[]): Promise<void> {
  const first = frames[0];
  if (!first) throw new Error('A capture needs at least one viewport image');
  try {
    let full: Buffer | undefined;
    if (frames.length > 1) {
      const { width, height } = await sharp(first).metadata();
      if (!width || !height) throw new Error('Capture dimensions unavailable');
      full = await sharp({
        create: {
          width, height: height * frames.length, channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).composite(frames.map((input, index) => ({ input, left: 0, top: index * height })))
        .png().toBuffer();
    }
    await writeFile(viewportPath, first);
    if (full) await writeFile(fullPath, full);
    else await rm(fullPath, { force: true });
  } catch (error) {
    const cleanup = await Promise.allSettled([
      rm(viewportPath, { force: true }),
      rm(fullPath, { force: true }),
    ]);
    const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) {
      throw new AggregateError([error, ...failures.map(result => result.reason)], 'Capture and cleanup failed');
    }
    throw error;
  }
}
