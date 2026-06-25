/* eslint-disable no-console */
/* eslint-env node */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArgs,
  resolveRunDirectory,
  surveyVisualParity,
  writeJson,
} from './harness.mjs';

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs();
  const survey = surveyVisualParity(options);
  const runDirectory = resolveRunDirectory(options);

  writeJson(path.join(runDirectory, 'survey.json'), survey)
    .then(() => {
      console.log(JSON.stringify(survey, null, 2));
    })
    .catch(error => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
