/* eslint-disable no-console */
/* eslint-env node */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import {
  captureVisualParity,
  nativeRoot,
  parseArgs,
  relativeToNative,
  resolveRunDirectory,
  safeName,
  toBoolean,
  toNumber,
  visualThreshold,
  writeJson,
} from './harness.mjs';

async function readPng(relativePath) {
  const absolutePath = path.resolve(nativeRoot, relativePath);
  return PNG.sync.read(await fs.readFile(absolutePath));
}

const defaultPixelmatchThreshold = 0.3;

async function compareRoute(
  route,
  runDirectory,
  threshold,
  pixelmatchThreshold,
) {
  const blocker = route.blocker ?? route.old?.blocker ?? route.rn?.blocker;
  if (blocker) {
    return {
      route: route.route,
      id: route.id,
      group: route.group,
      label: route.label,
      oldScreenshotPath: route.oldScreenshotPath,
      rnScreenshotPath: route.rnScreenshotPath,
      diffPath: null,
      score: null,
      diffPixels: null,
      diffRatio: null,
      diffStatus: 'blocked',
      blocker,
    };
  }

  if (!route.oldScreenshotPath || !route.rnScreenshotPath) {
    return {
      route: route.route,
      id: route.id,
      group: route.group,
      label: route.label,
      oldScreenshotPath: route.oldScreenshotPath,
      rnScreenshotPath: route.rnScreenshotPath,
      diffPath: null,
      score: null,
      diffPixels: null,
      diffRatio: null,
      diffStatus: 'blocked',
      blocker: 'Missing one or both screenshot paths.',
    };
  }

  const oldPng = await readPng(route.oldScreenshotPath);
  const rnPng = await readPng(route.rnScreenshotPath);
  if (oldPng.width !== rnPng.width || oldPng.height !== rnPng.height) {
    return {
      route: route.route,
      id: route.id,
      group: route.group,
      label: route.label,
      oldScreenshotPath: route.oldScreenshotPath,
      rnScreenshotPath: route.rnScreenshotPath,
      diffPath: null,
      score: 0,
      diffPixels: null,
      diffRatio: 1,
      diffStatus: 'dimension-mismatch',
      blocker: `Screenshot dimensions differ: old=${oldPng.width}x${oldPng.height}, rn=${rnPng.width}x${rnPng.height}.`,
    };
  }

  const diff = new PNG({ width: oldPng.width, height: oldPng.height });
  const diffPixels = pixelmatch(
    oldPng.data,
    rnPng.data,
    diff.data,
    oldPng.width,
    oldPng.height,
    { threshold: pixelmatchThreshold },
  );
  const totalPixels = oldPng.width * oldPng.height;
  const diffRatio = diffPixels / totalPixels;
  const score = Number((1 - diffRatio).toFixed(6));
  const diffPath = path.join(
    runDirectory,
    'screenshots',
    'diff',
    `${safeName(route.id)}.png`,
  );
  await fs.mkdir(path.dirname(diffPath), { recursive: true });
  await fs.writeFile(diffPath, PNG.sync.write(diff));

  return {
    route: route.route,
    id: route.id,
    group: route.group,
    label: route.label,
    oldScreenshotPath: route.oldScreenshotPath,
    rnScreenshotPath: route.rnScreenshotPath,
    diffPath: relativeToNative(diffPath),
    score,
    diffPixels,
    diffRatio: Number(diffRatio.toFixed(6)),
    diffStatus:
      diffPixels === 0 ? 'identical' : score >= threshold ? 'within-threshold' : 'different',
    blocker: null,
  };
}

export async function compareVisualParity(options = {}) {
  const threshold = toNumber(
    options.threshold ?? process.env.TESLASYNC_VISUAL_THRESHOLD,
    visualThreshold,
  );
  const pixelmatchThreshold = toNumber(
    options.pixelmatchThreshold ??
      process.env.TESLASYNC_VISUAL_PIXELMATCH_THRESHOLD,
    defaultPixelmatchThreshold,
  );
  const captureResult = await captureVisualParity(options);
  const runDirectory = captureResult.runDirectory ?? resolveRunDirectory(options);
  const comparedRoutes = [];

  for (const route of captureResult.capture.routes) {
    comparedRoutes.push(
      await compareRoute(route, runDirectory, threshold, pixelmatchThreshold),
    );
  }

  const blocked = comparedRoutes.filter(route => route.diffStatus === 'blocked');
  const dimensionMismatches = comparedRoutes.filter(
    route => route.diffStatus === 'dimension-mismatch',
  );
  const belowThreshold = comparedRoutes.filter(
    route => route.diffStatus === 'different',
  );
  const failOnDiff = toBoolean(
    options.failOnDiff ?? process.env.TESLASYNC_VISUAL_FAIL_ON_DIFF,
    false,
  );

  const result = {
    schemaVersion: captureResult.capture.schemaVersion,
    runId: captureResult.capture.runId,
    generatedAt: new Date().toISOString(),
    mode: 'compare',
    runDirectory: captureResult.capture.runDirectory,
    threshold,
    pixelmatchThreshold,
    failOnDiff,
    servers: captureResult.capture.servers,
    viewport: captureResult.capture.viewport,
    routes: comparedRoutes,
    summary: {
      routeCount: comparedRoutes.length,
      identical: comparedRoutes.filter(route => route.diffStatus === 'identical').length,
      withinThreshold: comparedRoutes.filter(
        route => route.diffStatus === 'within-threshold',
      ).length,
      different: belowThreshold.length,
      dimensionMismatches: dimensionMismatches.length,
      blocked: blocked.length,
      minScore: comparedRoutes.reduce((min, route) => {
        if (route.score == null) {
          return min;
        }
        return Math.min(min, route.score);
      }, 1),
    },
  };

  await writeJson(path.join(runDirectory, 'compare.json'), result);

  const hasRuntimeBlocker = blocked.length > 0 || dimensionMismatches.length > 0;
  const hasVisualFailure = failOnDiff && belowThreshold.length > 0;
  return {
    result,
    exitCode: hasRuntimeBlocker || hasVisualFailure ? 1 : 0,
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs();
  compareVisualParity(options)
    .then(({ result, exitCode }) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = exitCode;
    })
    .catch(error => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
