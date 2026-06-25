/* eslint-disable no-console */
/* eslint-env node */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureVisualParity, parseArgs } from './harness.mjs';

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  captureVisualParity(parseArgs())
    .then(({ capture }) => {
      console.log(JSON.stringify(capture, null, 2));
      process.exitCode = capture.summary.blocked > 0 ? 1 : 0;
    })
    .catch(error => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
