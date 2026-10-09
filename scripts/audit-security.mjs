import { spawnSync } from 'node:child_process';

// Full lockfile audit (production + development). No automatic upgrades/allowlist.
const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
if (result.error) throw result.error;
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw new Error('A auditoria não retornou JSON válido. Verifique o registry/rede.');
}
if (report.error || !report.metadata?.vulnerabilities)
  throw new Error(`Auditoria indisponível: ${report.message ?? 'erro do registry'}`);
for (const [name, item] of Object.entries(report.vulnerabilities))
  console.log(
    JSON.stringify({
      name,
      severity: item.severity,
      direct: item.isDirect,
      nodes: item.nodes,
      fixAvailable: item.fixAvailable,
      via: item.via,
    }),
  );
console.log(JSON.stringify(report.metadata, null, 2));
// Baseline at PWA-1: zero findings. Low/moderate are reported; high/critical fail CI.
// Any future exception needs a reviewed, expiring documented decision, not --force.
const { high, critical } = report.metadata.vulnerabilities;
process.exitCode = high || critical ? 1 : 0;
