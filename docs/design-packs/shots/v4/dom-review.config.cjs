const path = require('node:path');
const { defineConfig } = require(path.resolve(process.cwd(), 'node_modules', '@playwright', 'test'));

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'dom-review.spec.cjs',
  outputDir: path.resolve(__dirname, 'dom-review-results'),
  timeout: 90_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:54872',
    channel: 'msedge',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
