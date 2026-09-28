'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { resolveAsset } = require('./assets');

const root = path.resolve(__dirname, '..', '..', 'web', 'dist');

test('assets and SPA routes use the bundled web build', () => {
  assert.equal(resolveAsset(root, 'teslasync-app://app/'), path.join(root, 'index.html'));
  assert.equal(resolveAsset(root, 'teslasync-app://app/drives'), path.join(root, 'index.html'));
  assert.equal(resolveAsset(root, 'teslasync-app://app/manifest.webmanifest'), path.join(root, 'manifest.webmanifest'));
});

test('dotfiles and traversal cannot escape the bundle', () => {
  assert.equal(resolveAsset(root, 'teslasync-app://app/.secret'), null);
  assert.equal(resolveAsset(root, 'teslasync-app://app/%2e%2e%5csecret'), null);
  assert.equal(resolveAsset(root, 'teslasync-app://app/absent.js'), null);
  assert.equal(resolveAsset(root, 'teslasync-app://app/%ZZ'), null);
});
