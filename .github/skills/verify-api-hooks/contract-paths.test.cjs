const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const extractor = path.join(__dirname, 'contract-paths.cjs');

function extract(mode, extension, source) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'teslasync-contract-paths-'),
  );
  const file = path.join(directory, `fixture.${extension}`);
  try {
    fs.writeFileSync(file, source);
    return execFileSync(process.execPath, [extractor, mode, file], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('extracts bare methods from multiline Chi middleware chains', () => {
  const routes = extract(
    'routes',
    'go',
    `package fixture

func MountRoutes(r chi.Router) {
  r.Route("/system", func(r chi.Router) {
    r.With(requireAdmin).
      Get("/flags", handleFlags)
  })
}
`,
  );

  assert.ok(routes.includes('/system/flags'));
});

test('expands string-path route helpers at each literal call site', () => {
  const routes = extract(
    'routes',
    'go',
    `package fixture

func MountRoutes(r chi.Router) {
  r.Route("/fleet-ops", func(r chi.Router) {
    mountCRUD := func(path string, list, get http.HandlerFunc) {
      r.Get(path, list)
      r.Get(path+"/{id}", get)
    }
    mountCRUD("/drivers", listDrivers, getDriver)
    mountCRUD("/work-orders", listOrders, getOrder)
  })
}
`,
  );

  assert.ok(routes.includes('/fleet-ops/drivers'));
  assert.ok(routes.includes('/fleet-ops/drivers/{PARAM}'));
  assert.ok(routes.includes('/fleet-ops/work-orders'));
  assert.ok(routes.includes('/fleet-ops/work-orders/{PARAM}'));
});

test('preserves dynamic path and query expressions in request patterns', () => {
  const requests = extract(
    'requests',
    'ts',
    `request(\`/fleet-ops/\${resource}/\${id}?version=\${version}\`);`,
  );

  assert.equal(requests.length, 1);
  assert.match(
    requests[0],
    /\t\/fleet-ops\/\{PARAM\}\/\{PARAM\}\?version=\{PARAM\}$/,
  );
});
