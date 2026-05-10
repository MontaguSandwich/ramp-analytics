// Probe peerlytics liquidity series shape.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { envelopeGet } from '../lib/peerlytics.ts';

async function main() {
  console.log('=== overview.timeseries.liquidity sampling ===');
  const ov = await envelopeGet<Record<string, unknown>>('/analytics/overview');
  const ts = ov.timeseries as { liquidity?: Array<{ date: string; liquidity_usd: number; average_liquidity_usd?: number }> };
  const liq = ts.liquidity ?? [];
  console.log(`length: ${liq.length}`);
  // Sample every 60 days to see growth pattern
  for (let i = 0; i < liq.length; i += 60) {
    const p = liq[i];
    console.log(`  ${p.date}: liquidity=${p.liquidity_usd.toFixed(0)} avg=${p.average_liquidity_usd?.toFixed(0) ?? '—'}`);
  }
  // Check for any decreases (net) vs always-increasing (cumulative)
  let decreases = 0;
  let maxDecrease = 0;
  let maxDecreaseDate = '';
  for (let i = 1; i < liq.length; i++) {
    const delta = liq[i].liquidity_usd - liq[i - 1].liquidity_usd;
    if (delta < 0) {
      decreases++;
      if (delta < maxDecrease) {
        maxDecrease = delta;
        maxDecreaseDate = liq[i].date;
      }
    }
  }
  console.log(`\n  decreases (net days): ${decreases} of ${liq.length - 1}`);
  console.log(`  largest drop: ${maxDecrease.toFixed(0)} on ${maxDecreaseDate}`);
  console.log(`  last 7 days:`);
  for (const p of liq.slice(-7)) {
    console.log(`    ${p.date}: ${p.liquidity_usd.toFixed(0)} (avg=${p.average_liquidity_usd?.toFixed(0) ?? '—'})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
