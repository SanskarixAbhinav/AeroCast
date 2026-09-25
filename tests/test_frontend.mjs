import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('Running frontend acceptance tests...');

const htmlPath = path.resolve('frontend/index.html');
const appPath = path.resolve('frontend/app.js');
const configPath = path.resolve('frontend/config.js');
const manifestPath = path.resolve('frontend/manifest.json');
const swPath = path.resolve('frontend/sw.js');
const iconPath = path.resolve('frontend/icon.svg');

// 1. Verify index.html exists and contains necessary DOM elements
assert.ok(fs.existsSync(htmlPath), 'index.html must exist');
const html = fs.readFileSync(htmlPath, 'utf8');

const requiredIds = [
  'ui-title',
  'langSelect',
  'cycloneToggle',
  'ttsToggle',
  'chipsContainer',
  'chatThread',
  'typingIndicator',
  'chatForm',
  'chatInput',
  'sendBtn',
  'micBtn',
  'alertsContainer',
  'dataCard',
  'cardLocation',
  'marinePanel',
  'verdictContainer',
  'daySummary',
  'modelComparisonPanel',
  'dailyStripContainer',
  'historyPanel',
  'mapWrapper',
  'mapTabSingle',
  'mapTabRegional',
  'weatherMap',
  'archBtn',
  'archModal',
  'modalCloseBtn'
];

for (const id of requiredIds) {
  assert.ok(html.includes(`id="${id}"`), `index.html must contain id="${id}"`);
}
console.log('✔ All required DOM element IDs verified in index.html');

// 2. Verify manifest.json and PWA setup
assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.ok(manifest.name, 'manifest must have a name');
assert.ok(manifest.start_url, 'manifest must have a start_url');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must have icons');
assert.ok(html.includes('manifest.json'), 'index.html must link to manifest.json');
assert.ok(fs.existsSync(iconPath), 'icon.svg must exist');
console.log('✔ PWA Manifest and icon assets verified');

// 3. Verify sw.js exists and handles static shell caching
assert.ok(fs.existsSync(swPath), 'sw.js must exist');
const swContent = fs.readFileSync(swPath, 'utf8');
assert.ok(swContent.includes('install'), 'sw.js must handle install event');
assert.ok(swContent.includes('fetch'), 'sw.js must handle fetch event');
assert.ok(swContent.includes('caches'), 'sw.js must use Cache API');
console.log('✔ Service Worker verified');

// 4. Verify app.js syntax and key capabilities
assert.ok(fs.existsSync(appPath), 'app.js must exist');
const appContent = fs.readFileSync(appPath, 'utf8');
assert.ok(appContent.includes('renderHistorySvgChart'), 'app.js must include SVG climate chart generator');
assert.ok(appContent.includes('modelComparisonPanel'), 'app.js must handle modelComparisonPanel');
assert.ok(appContent.includes('renderRegionalMap'), 'app.js must handle regional disaster map');
assert.ok(appContent.includes('marine'), 'app.js must handle marine advisory');
assert.ok(appContent.includes('latency_ms') || appContent.includes('latency-pill'), 'app.js must display response latency');
console.log('✔ app.js features and capabilities verified');

console.log('ALL FRONTEND ACCEPTANCE TESTS PASSED! 🎉');
