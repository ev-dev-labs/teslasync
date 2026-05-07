// Scan the prod signal history CSV for charging windows.
// Usage: node find_charging_windows.js path/to/signal_history.csv
const fs = require('fs');
const readline = require('readline');

const path = process.argv[2];
if (!path) {
  console.error('Usage: node find_charging_windows.js <csv>');
  process.exit(1);
}

const rl = readline.createInterface({ input: fs.createReadStream(path) });
let header = null;
let idx = {};
const rows = [];
const windows = [];
let active = false;
let activeStart = null;

rl.on('line', (line) => {
  if (!header) {
    header = line.split(',');
    idx = {
      sig: header.indexOf('signal'),
      ts: header.indexOf('created_at'),
      vbool: header.indexOf('value_bool'),
      vstr: header.indexOf('value_str'),
    };
    return;
  }
  const cols = line.split(',');
  const sig = cols[idx.sig];
  const ts = cols[idx.ts];
  if (!ts) return;
  rows.push({ sig, ts });
  if (sig === 'ChargingActive' || sig === 'ChargeState' || sig === 'DetailedChargeState') {
    const vbool = cols[idx.vbool];
    const vstr = cols[idx.vstr];
    const isCharging =
      vbool === 't' || vstr === 'Charging' || vstr === 'Starting' || vstr === 'Enabled';
    if (isCharging && !active) {
      activeStart = ts;
      active = true;
    } else if (!isCharging && active) {
      windows.push([activeStart, ts]);
      active = false;
    }
  }
});

rl.on('close', () => {
  console.log('total signal rows: ' + rows.length);
  console.log('charging windows: ' + windows.length);
  console.log('');
  windows.forEach((w, i) => {
    const t1 = new Date(w[0].replace(' ', 'T').replace('+00', 'Z'));
    const t2 = new Date(w[1].replace(' ', 'T').replace('+00', 'Z'));
    const durMin = (t2 - t1) / 60000;
    const inWindow = rows.filter((s) => s.ts >= w[0] && s.ts <= w[1]);
    console.log(
      '[' +
        String(i).padStart(2) +
        '] ' +
        w[0].slice(0, 19) +
        ' -> ' +
        w[1].slice(11, 19) +
        '  ' +
        durMin.toFixed(0).padStart(4) +
        ' min  ' +
        String(inWindow.length).padStart(6) +
        ' signals',
    );
  });
});
