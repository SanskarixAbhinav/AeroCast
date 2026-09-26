import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const files = [
  'supabase/functions/health/index.ts',
  'supabase/functions/chat/index.ts',
  'supabase/functions/_shared/utils.ts',
  'supabase/functions/_shared/db.ts',
  'supabase/functions/_shared/location.ts',
  'supabase/functions/_shared/weather.ts',
  'supabase/functions/_shared/alerts.ts',
  'supabase/functions/_shared/advisory.ts',
  'supabase/functions/_shared/dates.ts',
  'supabase/functions/_shared/guard.ts',
  'supabase/functions/_shared/llm.ts',
];

console.log('Validating TypeScript syntax for all Edge Function files...');

let passed = true;
for (const file of files) {
  const fullPath = path.resolve(file);
  try {
    const code = fs.readFileSync(fullPath, 'utf8');
    stripTypeScriptTypes(code);
    console.log(`✔ ${file} (Syntax valid)`);
  } catch (err) {
    console.error(`✖ ${file} Failed:`, err.message);
    passed = false;
  }
}

if (!passed) {
  process.exit(1);
}

console.log('ALL BACKEND TYPESCRIPT FILES PASSED SYNTAX CHECK! 🎉');
