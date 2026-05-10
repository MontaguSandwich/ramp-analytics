import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from '../adapters/index.ts';

const OUT_DIR = 'data/charts';
const DAYS = 90;
mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const adapter of adapters) {
  try {
    const points = await adapter.history(DAYS);
    writeFileSync(join(OUT_DIR, `${adapter.id}.json`), JSON.stringify(points, null, 2));
    console.log(`OK  ${adapter.id} (${points.length} days)`);
  } catch (e) {
    failed++;
    console.error(`ERR ${adapter.id}: ${(e as Error).message}`);
  }
}

if (failed) process.exit(1);
