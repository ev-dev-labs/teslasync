/* eslint-disable no-console */
/* eslint-env node */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { PNG } from 'pngjs';

import {
  representativeRoutes,
  schemaVersion,
  viewport,
  visualThreshold as defaultVisualThreshold,
} from './routes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const nativeRoot = path.resolve(__dirname, '..', '..');
export const repoRoot = path.resolve(nativeRoot, '..', '..');
export const oldWebRoot = path.join(repoRoot, 'web');
export const artifactsRoot = path.join(nativeRoot, 'visual-parity-artifacts');
export const visualThreshold = defaultVisualThreshold;

const defaultHost = '127.0.0.1';
const defaultOldPort = 4310;
const defaultNativePort = 4311;
const defaultTimeoutMs = 60_000;
const defaultSettleMs = 2_000;

export class VisualParityBlocker extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'VisualParityBlocker';
    this.details = details;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [rawKey, rawValue] = arg.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) =>
      letter.toUpperCase(),
    );

    if (rawValue !== undefined) {
      options[key] = rawValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return options;
}

export function toBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function toNumber(value, defaultValue) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function currentRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function resolveRunDirectory(options = {}) {
  const configured =
    options.outDir ??
    process.env.TESLASYNC_VISUAL_OUT_DIR ??
    path.join(artifactsRoot, 'latest');

  return path.resolve(nativeRoot, configured);
}

export async function prepareRunDirectory(runDirectory, clean = true) {
  if (clean) {
    await fs.rm(runDirectory, { recursive: true, force: true });
  }
  await fs.mkdir(runDirectory, { recursive: true });
}

export async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rename(`${filePath}.tmp`, filePath);
}

export function relativeToNative(filePath) {
  return path.relative(nativeRoot, filePath);
}

export function routeUrl(baseUrl, routePath) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedRoute = routePath.startsWith('/')
    ? routePath.slice(1)
    : routePath;
  return new URL(normalizedRoute, normalizedBase).toString();
}

export function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
}

async function canListen(port, host = defaultHost) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findOpenPort(startPort, reservedPorts = new Set()) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (reservedPorts.has(port)) {
      continue;
    }
    if (await canListen(port)) {
      reservedPorts.add(port);
      return port;
    }
  }

  throw new VisualParityBlocker(
    `No open TCP port found in range ${startPort}-${startPort + 99}.`,
  );
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => {
      setTimeout(resolve, 500);
    });
  }

  throw new VisualParityBlocker(`Timed out waiting for ${url}.`, {
    cause: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

async function assertExistingDirectory(directory, label) {
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new VisualParityBlocker(`${label} directory does not exist.`, {
      directory,
    });
  }
}

function viteBin(projectRoot) {
  return path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
}

async function assertViteAvailable(projectRoot, label) {
  const bin = viteBin(projectRoot);
  const stat = await fs.stat(bin).catch(() => null);
  if (!stat?.isFile()) {
    throw new VisualParityBlocker(
      `${label} Vite binary is missing. Run npm install in ${projectRoot}.`,
      { viteBin: bin },
    );
  }
  return bin;
}

async function startViteServer({ label, projectRoot, port, timeoutMs }) {
  await assertExistingDirectory(projectRoot, label);
  const bin = await assertViteAvailable(projectRoot, label);
  const args = [
    bin,
    '--host',
    defaultHost,
    '--port',
    String(port),
    '--strictPort',
  ];
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      BROWSER: 'none',
      CI: process.env.CI ?? 'true',
      VITE_PWA_DEV: process.env.VITE_PWA_DEV ?? 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  const remember = chunk => {
    output.push(chunk.toString());
    if (output.length > 80) {
      output.shift();
    }
  };

  child.stdout.on('data', remember);
  child.stderr.on('data', remember);

  const url = `http://${defaultHost}:${port}`;
  let exited = false;
  child.once('exit', code => {
    exited = true;
    if (code !== 0) {
      output.push(`${label} server exited with code ${code}.`);
    }
  });

  try {
    await waitForHttp(url, timeoutMs);
  } catch (error) {
    child.kill();
    throw new VisualParityBlocker(
      `${label} failed to start on ${url}.`,
      {
        output: output.join('').trim(),
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  if (exited) {
    throw new VisualParityBlocker(`${label} exited before it became ready.`, {
      output: output.join('').trim(),
    });
  }

  return {
    label,
    url,
    started: true,
    pid: child.pid,
    command: `${process.execPath} ${args.join(' ')}`,
    async stop() {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

async function resolveServer({
  label,
  suppliedUrl,
  projectRoot,
  preferredPort,
  reservedPorts,
  timeoutMs,
}) {
  if (suppliedUrl) {
    await waitForHttp(suppliedUrl, timeoutMs);
    return {
      label,
      url: suppliedUrl.replace(/\/$/, ''),
      started: false,
      pid: null,
      command: null,
      async stop() {},
    };
  }

  const port = await findOpenPort(preferredPort, reservedPorts);
  return startViteServer({ label, projectRoot, port, timeoutMs });
}

export async function resolveServers(options = {}) {
  const timeoutMs = toNumber(
    options.timeoutMs ?? process.env.TESLASYNC_VISUAL_TIMEOUT_MS,
    defaultTimeoutMs,
  );
  const reservedPorts = new Set();
  const oldPort = toNumber(
    options.oldPort ?? process.env.TESLASYNC_VISUAL_OLD_PORT,
    defaultOldPort,
  );
  const nativePort = toNumber(
    options.nativePort ?? process.env.TESLASYNC_VISUAL_NATIVE_PORT,
    defaultNativePort,
  );

  const old = await resolveServer({
    label: 'old web',
    suppliedUrl: options.oldUrl ?? process.env.TESLASYNC_OLD_WEB_URL,
    projectRoot: oldWebRoot,
    preferredPort: oldPort,
    reservedPorts,
    timeoutMs,
  });
  const native = await resolveServer({
    label: 'React Native Web',
    suppliedUrl: options.nativeUrl ?? process.env.TESLASYNC_RN_WEB_URL,
    projectRoot: nativeRoot,
    preferredPort: nativePort,
    reservedPorts,
    timeoutMs,
  });

  return {
    old,
    native,
    async stop() {
      await Promise.allSettled([old.stop(), native.stop()]);
    },
  };
}

async function screenshotMetadata(filePath) {
  const bytes = await fs.readFile(filePath);
  const png = PNG.sync.read(bytes);
  return {
    path: relativeToNative(filePath),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: png.width,
    height: png.height,
    bytes: bytes.length,
  };
}

async function createContext(browser) {
  const context = await browser.newContext({
    colorScheme: 'dark',
    deviceScaleFactor: viewport.deviceScaleFactor,
    reducedMotion: 'reduce',
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
  });

  await context.addInitScript(() => {
    window.localStorage.setItem('teslasync:onboarding:skipped:v1', '1');
  });

  return context;
}

async function captureRoute({
  context,
  appName,
  baseUrl,
  route,
  screenshotPath,
  settleMs,
  timeoutMs,
}) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  try {
    const url = routeUrl(baseUrl, route.route);
    await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(settleMs);
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({
      path: screenshotPath,
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
      type: 'png',
    });
    const metadata = await screenshotMetadata(screenshotPath);

    return {
      appName,
      url,
      screenshotPath: metadata.path,
      sha256: metadata.sha256,
      width: metadata.width,
      height: metadata.height,
      bytes: metadata.bytes,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      blocker: null,
    };
  } catch (error) {
    return {
      appName,
      url: routeUrl(baseUrl, route.route),
      screenshotPath: null,
      sha256: null,
      width: null,
      height: null,
      bytes: null,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      blocker: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function captureVisualParity(options = {}) {
  const runDirectory = resolveRunDirectory(options);
  const clean = !toBoolean(options.noClean, false);
  await prepareRunDirectory(runDirectory, clean);

  const timeoutMs = toNumber(
    options.timeoutMs ?? process.env.TESLASYNC_VISUAL_TIMEOUT_MS,
    defaultTimeoutMs,
  );
  const settleMs = toNumber(
    options.settleMs ?? process.env.TESLASYNC_VISUAL_SETTLE_MS,
    defaultSettleMs,
  );
  const runId = currentRunId();
  const startedAt = new Date().toISOString();
  const servers = await resolveServers(options);
  let browser;

  try {
    browser = await chromium.launch({
      headless: !toBoolean(options.headed, false),
    });
    const oldContext = await createContext(browser);
    const nativeContext = await createContext(browser);
    const routes = [];

    for (const route of representativeRoutes) {
      const fileName = `${safeName(route.id)}.png`;
      const oldScreenshot = path.join(
        runDirectory,
        'screenshots',
        'old-web',
        fileName,
      );
      const nativeScreenshot = path.join(
        runDirectory,
        'screenshots',
        'react-native-web',
        fileName,
      );

      const [oldCapture, nativeCapture] = await Promise.all([
        captureRoute({
          context: oldContext,
          appName: 'old-web',
          baseUrl: servers.old.url,
          route,
          screenshotPath: oldScreenshot,
          settleMs,
          timeoutMs,
        }),
        captureRoute({
          context: nativeContext,
          appName: 'react-native-web',
          baseUrl: servers.native.url,
          route,
          screenshotPath: nativeScreenshot,
          settleMs,
          timeoutMs,
        }),
      ]);

      const blocker = oldCapture.blocker ?? nativeCapture.blocker;
      routes.push({
        ...route,
        oldScreenshotPath: oldCapture.screenshotPath,
        rnScreenshotPath: nativeCapture.screenshotPath,
        old: oldCapture,
        rn: nativeCapture,
        status: blocker ? 'blocked' : 'captured',
        blocker,
      });
    }

    const capture = {
      schemaVersion,
      runId,
      generatedAt: new Date().toISOString(),
      startedAt,
      mode: 'capture',
      runDirectory: relativeToNative(runDirectory),
      roots: {
        repo: repoRoot,
        oldWeb: oldWebRoot,
        native: nativeRoot,
      },
      servers: {
        oldWeb: {
          url: servers.old.url,
          started: servers.old.started,
          pid: servers.old.pid,
          command: servers.old.command,
        },
        reactNativeWeb: {
          url: servers.native.url,
          started: servers.native.started,
          pid: servers.native.pid,
          command: servers.native.command,
        },
      },
      viewport,
      threshold: visualThreshold,
      routes,
      summary: {
        routeCount: routes.length,
        captured: routes.filter(route => route.status === 'captured').length,
        blocked: routes.filter(route => route.status === 'blocked').length,
      },
    };

    await writeJson(path.join(runDirectory, 'capture.json'), capture);
    return { capture, runDirectory };
  } finally {
    await browser?.close().catch(() => {});
    await servers.stop();
  }
}

export function surveyVisualParity(options = {}) {
  const groups = new Map();
  for (const route of representativeRoutes) {
    const group = groups.get(route.group) ?? {
      group: route.group,
      routeCount: 0,
      routes: [],
    };
    group.routeCount += 1;
    group.routes.push(route.id);
    groups.set(route.group, group);
  }

  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    mode: 'survey',
    runDirectory: relativeToNative(resolveRunDirectory(options)),
    roots: {
      repo: repoRoot,
      oldWeb: oldWebRoot,
      native: nativeRoot,
    },
    apps: {
      oldWeb: {
        defaultPort: defaultOldPort,
        envUrl: 'TESLASYNC_OLD_WEB_URL',
      },
      reactNativeWeb: {
        defaultPort: defaultNativePort,
        envUrl: 'TESLASYNC_RN_WEB_URL',
      },
    },
    viewport,
    threshold: visualThreshold,
    routeGroups: [...groups.values()],
    routes: representativeRoutes,
    summary: {
      routeCount: representativeRoutes.length,
      routeGroupCount: groups.size,
      coversOnlyHomePage:
        representativeRoutes.length === 1 && representativeRoutes[0].route === '/',
    },
  };
}
