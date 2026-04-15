const { Client } = require('pg');
const { MongoClient } = require('mongodb');
const fs = require('fs');

async function main() {
  const pgPass = process.env.PG_PASSWORD || 'teslasyncdemo';

  // Fleet Telemetry config
  const ftConfig = JSON.parse(fs.readFileSync(
    'C:/Users/AtulM/.copilot/session-state/4dfe1c4d-fb2c-4d2a-9409-0dd6bf792717/files/paste-1776230404953.txt'
  ));
  const ftSignals = Object.keys(ftConfig.response.config.fields).sort();

  // Connect to Postgres
  const pg = new Client({ host: 'localhost', port: 54321, user: 'teslasync', password: pgPass, database: 'teslasync' });
  await pg.connect();

  // Get PG columns
  const colsRes = await pg.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='vehicle_live_state' AND column_name NOT IN ('id','vehicle_id','created_at','updated_at') ORDER BY column_name"
  );
  const pgCols = new Set(colsRes.rows.map(r => r.column_name));

  // Get latest live state
  const latestRes = await pg.query('SELECT * FROM vehicle_live_state WHERE vehicle_id=1 ORDER BY created_at DESC LIMIT 1');
  const latestRow = latestRes.rows[0] || {};

  // Get signal_history distinct signals (last 24h)
  const sigHistRes = await pg.query(
    "SELECT DISTINCT signal FROM signal_history WHERE vehicle_id=1 AND created_at > NOW() - interval '24 hours' ORDER BY signal"
  );
  const pgHistSignals = new Set(sigHistRes.rows.map(r => r.signal));

  // Get latest value per signal from signal_history
  const latestSigRes = await pg.query(
    `SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool, created_at
     FROM signal_history WHERE vehicle_id=1
     ORDER BY signal, created_at DESC`
  );
  const pgLatestBySignal = {};
  for (const r of latestSigRes.rows) {
    pgLatestBySignal[r.signal] = r.value_num ?? r.value_str ?? r.value_bool ?? null;
  }

  await pg.end();

  // Connect to MongoDB
  let mongoSignals = new Set();
  let mongoLatestBySignal = {};
  try {
    const mongo = new MongoClient(process.env.MONGO_URI || 'mongodb://teslasync:Y-y4vKw7cJlsfKQnmIm3sEwZS3-OBjRx@localhost:27018/teslasync');
    await mongo.connect();
    const db = mongo.db('teslasync');

    // Distinct signals from signal_log today
    const distinctSigs = await db.collection('signal_log').distinct('signal', {
      vehicle_id: 1,
      timestamp: { $gte: new Date(Date.now() - 24 * 3600 * 1000) }
    });
    mongoSignals = new Set(distinctSigs);

    // Latest value per signal
    const pipeline = [
      { $match: { vehicle_id: 1 } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$signal', value_num: { $first: '$value_num' }, value_str: { $first: '$value_str' }, ts: { $first: '$timestamp' } } }
    ];
    const aggResult = await db.collection('signal_log').aggregate(pipeline).toArray();
    for (const r of aggResult) {
      mongoLatestBySignal[r._id] = r.value_num ?? r.value_str ?? null;
    }

    await mongo.close();
  } catch (e) {
    console.error('MongoDB connection failed (optional):', e.message);
  }

  // Map fleet telemetry signal names to snake_case (for PG column matching)
  function toSnakeCase(s) {
    return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }

  // Build comparison data
  const rows = ftSignals.map(sig => {
    const snake = toSnakeCase(sig);
    const inPgCol = pgCols.has(snake);
    const inPgHist = pgHistSignals.has(sig);
    const inMongo = mongoSignals.has(sig);
    
    // Get latest value from PG (live_state column or signal_history)
    let pgValue = null;
    if (inPgCol && latestRow[snake] !== undefined && latestRow[snake] !== null) {
      pgValue = latestRow[snake];
    } else if (pgLatestBySignal[sig] !== undefined) {
      pgValue = pgLatestBySignal[sig];
    }

    const mongoValue = mongoLatestBySignal[sig] ?? null;

    return { signal: sig, snake, inPgCol, inPgHist, inMongo, pgValue, mongoValue };
  });

  // Generate HTML
  const totalSignals = rows.length;
  const inPgCount = rows.filter(r => r.inPgCol || r.inPgHist).length;
  const inMongoCount = rows.filter(r => r.inMongo).length;
  const bothCount = rows.filter(r => (r.inPgCol || r.inPgHist) && r.inMongo).length;
  const neitherCount = rows.filter(r => !r.inPgCol && !r.inPgHist && !r.inMongo).length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TeslaSync Signal Comparison — Fleet Telemetry vs Postgres vs MongoDB</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 8px; color: #38bdf8; }
  .subtitle { color: #94a3b8; margin-bottom: 24px; font-size: 14px; }
  .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: #1e293b; border-radius: 12px; padding: 16px 24px; min-width: 160px; }
  .stat .value { font-size: 28px; font-weight: 700; color: #38bdf8; }
  .stat .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
  .stat.green .value { color: #4ade80; }
  .stat.amber .value { color: #fbbf24; }
  .stat.red .value { color: #f87171; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
  th { background: #334155; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 16px; text-align: left; position: sticky; top: 0; }
  td { padding: 10px 16px; border-bottom: 1px solid #334155; font-size: 13px; }
  tr:hover { background: #334155; }
  .signal-name { font-family: 'SF Mono', 'Fira Code', monospace; font-weight: 600; color: #e2e8f0; }
  .snake { font-family: monospace; font-size: 11px; color: #64748b; }
  .yes { color: #4ade80; font-weight: 600; }
  .no { color: #475569; }
  .value-cell { font-family: monospace; font-size: 12px; color: #94a3b8; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
  .badge-pg { background: #064e3b; color: #6ee7b7; }
  .badge-mongo { background: #422006; color: #fbbf24; }
  .badge-both { background: #1e3a5f; color: #38bdf8; }
  .badge-none { background: #3f1219; color: #fca5a5; }
  .filter-bar { margin-bottom: 16px; display: flex; gap: 8px; }
  .filter-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid #475569; background: transparent; color: #94a3b8; cursor: pointer; font-size: 12px; }
  .filter-btn.active { background: #38bdf8; color: #0f172a; border-color: #38bdf8; }
  input[type=search] { background: #1e293b; border: 1px solid #475569; color: #e2e8f0; padding: 8px 14px; border-radius: 8px; font-size: 13px; width: 300px; }
  .timestamp { font-size: 11px; color: #64748b; margin-top: 4px; }
</style>
</head>
<body>

<h1>🔌 TeslaSync Signal Comparison</h1>
<p class="subtitle">Fleet Telemetry Config vs Postgres (live_state + signal_history) vs MongoDB (signal_log) — ${new Date().toLocaleString()}</p>

<div class="stats">
  <div class="stat"><div class="value">${totalSignals}</div><div class="label">Fleet Telemetry Signals</div></div>
  <div class="stat green"><div class="value">${inPgCount}</div><div class="label">In Postgres</div></div>
  <div class="stat amber"><div class="value">${inMongoCount}</div><div class="label">In MongoDB</div></div>
  <div class="stat"><div class="value">${bothCount}</div><div class="label">In Both</div></div>
  <div class="stat red"><div class="value">${neitherCount}</div><div class="label">In Neither</div></div>
</div>

<div class="filter-bar">
  <input type="search" id="search" placeholder="Search signals..." oninput="filterTable()">
  <button class="filter-btn active" onclick="setFilter('all', this)">All (${totalSignals})</button>
  <button class="filter-btn" onclick="setFilter('pg', this)">Postgres (${inPgCount})</button>
  <button class="filter-btn" onclick="setFilter('mongo', this)">MongoDB (${inMongoCount})</button>
  <button class="filter-btn" onclick="setFilter('both', this)">Both (${bothCount})</button>
  <button class="filter-btn" onclick="setFilter('neither', this)">Neither (${neitherCount})</button>
</div>

<table id="signalTable">
<thead>
<tr>
  <th>#</th>
  <th>Signal Name</th>
  <th>PG Column</th>
  <th>In Postgres</th>
  <th>In MongoDB</th>
  <th>Status</th>
  <th>Latest (Postgres)</th>
  <th>Latest (MongoDB)</th>
</tr>
</thead>
<tbody>
${rows.map((r, i) => {
  const status = (r.inPgCol || r.inPgHist) && r.inMongo ? 'both'
    : (r.inPgCol || r.inPgHist) ? 'pg'
    : r.inMongo ? 'mongo' : 'neither';
  const statusBadge = status === 'both' ? '<span class="badge badge-both">Both</span>'
    : status === 'pg' ? '<span class="badge badge-pg">PG Only</span>'
    : status === 'mongo' ? '<span class="badge badge-mongo">Mongo Only</span>'
    : '<span class="badge badge-none">Neither</span>';
  const pgVal = r.pgValue !== null ? String(r.pgValue).substring(0, 40) : '—';
  const mongoVal = r.mongoValue !== null ? String(r.mongoValue).substring(0, 40) : '—';
  return `<tr data-status="${status}">
    <td>${i + 1}</td>
    <td><span class="signal-name">${r.signal}</span><br><span class="snake">${r.snake}</span></td>
    <td class="${r.inPgCol ? 'yes' : 'no'}">${r.inPgCol ? '✅ Yes' : '❌ No'}</td>
    <td class="${(r.inPgCol || r.inPgHist) ? 'yes' : 'no'}">${r.inPgCol ? '✅ Column' : r.inPgHist ? '✅ History' : '❌ No'}</td>
    <td class="${r.inMongo ? 'yes' : 'no'}">${r.inMongo ? '✅ Yes' : '❌ No'}</td>
    <td>${statusBadge}</td>
    <td class="value-cell" title="${pgVal}">${pgVal}</td>
    <td class="value-cell" title="${mongoVal}">${mongoVal}</td>
  </tr>`;
}).join('\n')}
</tbody>
</table>

<script>
let currentFilter = 'all';
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterTable();
}
function filterTable() {
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('#signalTable tbody tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    const status = tr.dataset.status;
    const matchSearch = !q || text.includes(q);
    const matchFilter = currentFilter === 'all' || status === currentFilter;
    tr.style.display = matchSearch && matchFilter ? '' : 'none';
  });
}
</script>

</body>
</html>`;

  fs.writeFileSync('D:/copilot/teslasync/refactor/signal-comparison.html', html);
  console.log('Written to D:/copilot/teslasync/refactor/signal-comparison.html');
  console.log(`Total: ${totalSignals}, PG: ${inPgCount}, Mongo: ${inMongoCount}, Both: ${bothCount}, Neither: ${neitherCount}`);
}

main().catch(e => console.error(e));
