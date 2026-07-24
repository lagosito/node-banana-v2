// Phase 1 E2E: crawl + score all 11 control domains
import { collectFacts } from '../src/lib/geo-check/crawler';
import { scoreReport } from '../src/lib/geo-check/scoring';

const domains = [
  'stripe.com', 'example.com', 'buerklin-wolf.de', 'schlenkerla.de',
  'schwarzwaldmilch.de', 'weingut-kranz.de', 'lieken.de', 'frankenwein.de',
  'stuckateur-berlin.de', 'lammsbraeu.de', 'heise.de'
];

async function main() {
  console.log('Domain                  | Score | Summary Match | Time    | Status');
  console.log('------------------------|-------|---------------|---------|--------');

  let completed = 0;
  let failed = 0;

  for (const domain of domains) {
    const t0 = Date.now();
    try {
      const facts = await collectFacts('https://' + domain);
      const scores = scoreReport(facts);
      const elapsed = Date.now() - t0;

      // Verify summary matches
      const w: Record<string, number> = {technik:0.15, aiReadiness:0.20, content:0.15, trust:0.10, seo:0.10, designUx:0.10, performance:0.10};
      let sum = 0;
      for (const [k,v] of Object.entries(w)) {
        sum += (scores.categoryScores as any)[k].score * v;
      }
      const normalized = Math.round(sum / 0.9);
      const match = scores.overallScore === normalized;

      completed++;
      const scoreStr = String(scores.overallScore).padEnd(5);
      const matchStr = (match ? 'YES' : 'NO (' + normalized + ')').padEnd(13);
      const timeStr = String(elapsed).padEnd(7);
      console.log(`${domain.padEnd(24)}| ${scoreStr} | ${matchStr} | ${timeStr}ms | OK`);
    } catch (err: any) {
      const elapsed = Date.now() - t0;
      failed++;
      const timeStr = String(elapsed).padEnd(7);
      const errMsg = (err.message || String(err)).slice(0, 60);
      console.log(`${domain.padEnd(24)}| -     | -             | ${timeStr}ms | FAIL: ${errMsg}`);
    }
  }

  console.log();
  console.log(`Completed: ${completed}/11  Failed: ${failed}/11`);
}

main().catch(console.error);
