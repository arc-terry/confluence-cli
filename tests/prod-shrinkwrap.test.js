const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const generateShrinkwrap = path.resolve(__dirname, '../scripts/generate-prod-shrinkwrap.sh');

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-shrinkwrap-'));
}

describe('production shrinkwrap generation', () => {
  const tempDirectories = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('declares Pi TUI and TypeBox as optional Pi runtime peers', () => {
    const manifest = require('../package.json');

    expect(manifest.peerDependencies).toEqual({ '@earendil-works/pi-tui': '*', typebox: '*' });
    expect(manifest.peerDependenciesMeta).toEqual({
      '@earendil-works/pi-tui': { optional: true },
      typebox: { optional: true },
    });
  });

  test('keeps unsupported Pi TUI packages out of Node 18/20 development installs', () => {
    const manifest = require('../package.json');
    const lock = require('../package-lock.json');

    expect(manifest.devDependencies['@earendil-works/pi-tui']).toBeUndefined();
    expect(manifest.devDependencies.typebox).toBe('^1.3.18');
    expect(lock.packages['node_modules/@earendil-works/pi-tui']).toBeUndefined();
    expect(lock.packages['node_modules/get-east-asian-width']).toBeUndefined();
    expect(lock.packages['node_modules/marked']).toBeUndefined();
  });

  test('excludes peer packages from the production shrinkwrap', () => {
    const directory = createTempDirectory();
    tempDirectories.push(directory);
    fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({
      name: 'fixture',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', devDependencies: { devOnly: '1.0.0' } },
        'node_modules/production': { version: '1.0.0' },
        'node_modules/devOnly': { version: '1.0.0', dev: true },
        'node_modules/piPeer': { version: '1.0.0', peer: true }
      }
    }));

    execFileSync('bash', [generateShrinkwrap], { cwd: directory, stdio: 'pipe' });

    const shrinkwrap = JSON.parse(fs.readFileSync(path.join(directory, 'npm-shrinkwrap.json'), 'utf8'));
    expect(shrinkwrap.packages).toEqual({
      '': { name: 'fixture' },
      'node_modules/production': { version: '1.0.0' }
    });
  });
});
