import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

console.log("Running Frontend Acceptance Tests in Node.js...");

// 1. Verify index.html contains all required elements
const htmlPath = path.resolve('d:/AeroCast/frontend/index.html');
assert.ok(fs.existsSync(htmlPath), "index.html exists");
const html = fs.readFileSync(htmlPath, 'utf8');

const requiredIds = [
  'langSelect',
  'cycloneToggle',
  'ttsToggle',
  'chipsContainer',
  'chatThread',
  'typingIndicator',
  'chatInput',
  'sendBtn',
  'micBtn',
  'voiceHint',
  'alertsContainer',
  'dataCard',
  'cyclonePanel',
  'verdictContainer',
  'currentConditions',
  'daySummary',
  'dailyStripContainer',
  'dailyStrip',
  'historyPanel',
  'weatherMap'
];

for (const id of requiredIds) {
  assert.ok(html.includes(`id="${id}"`), `Element id="${id}" must exist in index.html`);
}
console.log("✔ index.html contains all required UI elements");

// 2. Verify config.js
const configPath = path.resolve('d:/AeroCast/frontend/config.js');
assert.ok(fs.existsSync(configPath), "config.js exists");
const configContent = fs.readFileSync(configPath, 'utf8');
assert.ok(configContent.includes("API_URL"), "config.js contains API_URL");
assert.ok(configContent.includes("USE_MOCK"), "config.js contains USE_MOCK");
assert.ok(configContent.includes("ANON_KEY"), "config.js contains ANON_KEY");
console.log("✔ config.js properly structured");

// 3. Verify app.js syntax and line count constraint
const appPath = path.resolve('d:/AeroCast/frontend/app.js');
assert.ok(fs.existsSync(appPath), "app.js exists");
const appContent = fs.readFileSync(appPath, 'utf8');
const lineCount = appContent.split('\n').length;
console.log(`app.js line count: ${lineCount} (Target: under ~500 lines)`);
assert.ok(lineCount <= 520, "app.js is under constraint limit");

// 4. Verify multilingual dictionary covers en, hi, bn, ta, te, mr
for (const lang of ['en', 'hi', 'bn', 'ta', 'te', 'mr']) {
  assert.ok(appContent.includes(`${lang}: {`), `Language '${lang}' dictionary exists`);
}
console.log("✔ Multilingual dictionary covers all 6 required Indian languages");

// 5. Verify security: app.js does not use unsafe innerHTML for user text
assert.ok(!appContent.includes("innerHTML = text"), "Safe DOM text injection used");
assert.ok(appContent.includes("e.textContent = txt") || appContent.includes("textContent = text"), "textContent used for safe bubble rendering");
console.log("✔ Security: textContent verified for user and API texts");


console.log("ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY! 🎉");
