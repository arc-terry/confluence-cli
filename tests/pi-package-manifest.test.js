const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');
const packageRoot = path.resolve(__dirname, '..');

test('declares the bundled Confluence skill and Pi extension', () => {
  expect(packageJson.pi).toEqual({
    skills: ['./plugins/confluence/skills'],
    extensions: ['./.pi/extensions/confluence-cli.ts'],
  });
});

test('publishes the Pi extension and declares only its runtime peer', () => {
  expect(packageJson.files).toContain('.pi/');
  expect(packageJson.peerDependencies['@earendil-works/pi-coding-agent']).toBeUndefined();
  expect(packageJson.peerDependencies.typebox).toBe('*');
  expect(packageJson.peerDependenciesMeta.typebox).toEqual({ optional: true });
  expect(fs.existsSync(path.join(__dirname, '../.pi/extensions/confluence-cli.ts'))).toBe(true);
});

test('README documents Pi write registration separately from read-only execution blocking', () => {
  const readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8');

  expect(readme).toContain('Write tool registration depends only on `CONFLUENCE_PI_WRITES=true` plus a valid non-empty `CONFLUENCE_PI_WRITE_SPACES` allowlist.');
  expect(readme).toContain('`CONFLUENCE_READ_ONLY=true` does not hide registered write tools; it blocks every write execution even if those tools remain visible.');
  expect(readme).toContain('Changing registration variables (`CONFLUENCE_PI_WRITES` or `CONFLUENCE_PI_WRITE_SPACES`) after Pi starts requires `/reload`');
  expect(readme).not.toContain('and `CONFLUENCE_READ_ONLY` is false, Pi also registers');
});

test('documents the opt-in bulk page manipulation contract', () => {
  const documents = [
    fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8'),
    fs.readFileSync(path.join(packageRoot, 'plugins/confluence/skills/confluence/SKILL.md'), 'utf8'),
  ];

  for (const document of documents) {
    expect(document).toContain('CONFLUENCE_PI_BULK_PAGE_MANIPULATION=true');
    expect(document).toContain('confluence_pages_manipulate');
    expect(document).toContain('`create`, `create-child`, `update`, `move`, and `delete`');
    expect(document).toContain('MANIPULATE <count> ACTIONS: <canonicalTargetId,...>');
    expect(document).toContain('one confirmation');
    expect(document).toContain('three retries');
    expect(document).toContain('continue with later actions');
    expect(document).toContain('`UNKNOWN_RESULT` actions are not retried');
    expect(document).not.toContain('CONFLUENCE_PI_BULK_PAGE_DELETE');
    expect(document).not.toContain('confluence_pages_delete');
  }
});

test('includes Pi resources in the npm package tarball', () => {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  }));
  const names = packed[0].files.map((file) => file.path);
  expect(names).toEqual(expect.arrayContaining([
    '.pi/extensions/confluence-cli.ts',
    'plugins/confluence/skills/confluence/SKILL.md',
    'bin/index.js',
    'lib/pi/command-runner.js',
    'lib/pi/operation-policy.js',
    'lib/pi/write-authorization.js',
    'lib/pi/preflight.js',
    'lib/pi/preflight-store.js',
  ]));
  expect(names).not.toContain('lib/pi/read-only-runner.js');
  expect(names).not.toContain('lib/pi/tool-policy.js');
});
