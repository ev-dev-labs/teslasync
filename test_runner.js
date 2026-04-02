/**
 * TeslaSync Full Integration Test — 10 Iterations + 8 Unit Combos
 * 
 * Iteration 1-8: One unit combination each (mi/km × F/C × rated/ideal)
 * Iteration 9: Re-test US defaults (mi+F+rated) 
 * Iteration 10: Re-test metric defaults (km+C+rated)
 * 
 * Each iteration:
 *  1. Reset DB (keep vehicles)
 *  2. Seed realistic data
 *  3. Set unit preferences
 *  4. Publish MQTT signals
 *  5. Wait for processing
 *  6. Verify API responses
 *  7. Take screenshots of all pages
 *  8. Check for NaN/undefined/crashes
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIN = 'TESTVIN0000000001';
const API = 'http://localhost:8080';
const UI = 'http://localhost:3000';
const BASE_DIR = 'D:\\copilot\\teslasync\\testplan';

const UNIT_COMBOS = [
  { name: 'mi+F+rated',  length: 'mi', temp: 'F', range: 'rated', desc: 'US Default' },
  { name: 'mi+F+ideal',  length: 'mi', temp: 'F', range: 'ideal', desc: 'US Ideal' },
  { name: 'mi+C+rated',  length: 'mi', temp: 'C', range: 'rated', desc: 'US Celsius' },
  { name: 'mi+C+ideal',  length: 'mi', temp: 'C', range: 'ideal', desc: 'US Celsius Ideal' },
  { name: 'km+F+rated',  length: 'km', temp: 'F', range: 'rated', desc: 'Metric Fahrenheit' },
  { name: 'km+F+ideal',  length: 'km', temp: 'F', range: 'ideal', desc: 'Metric Fahrenheit Ideal' },
  { name: 'km+C+rated',  length: 'km', temp: 'C', range: 'rated', desc: 'Metric Default' },
  { name: 'km+C+ideal',  length: 'km', temp: 'C', range: 'ideal', desc: 'Metric Ideal' },
  { name: 'mi+F+rated',  length: 'mi', temp: 'F', range: 'rated', desc: 'Re-test US Default' },
  { name: 'km+C+rated',  length: 'km', temp: 'C', range: 'rated', desc: 'Re-test Metric Default' },
];

function psql(sql) {
  try {
    return execSync(`docker exec teslasync-postgres psql -U teslasync -d teslasync -t -c "${sql.replace(/"/g, '\\"')}"`,
      { stdio: 'pipe', maxBuffer: 2*1024*1024 }).toString().trim();
  } catch { return ''; }
}

function resetAndSeed(units) {
  // Truncate data tables (NOT vehicles)
  psql('TRUNCATE positions, charging_telemetry, climate_snapshots, security_events, motor_snapshots, tire_pressure_snapshots, vehicle_states, charging_sessions, drives, daily_mileage, alerts, gas_price_history CASCADE');
  
  // Ensure vehicle exists
  psql(`INSERT INTO vehicles (vehicle_id,vin,display_name,model,trim_badging,exterior_color,wheel_type,state,healthy,created_at,updated_at) VALUES (100,'${VIN}','Test Model Y','Model Y','Long Range','Pearl White','19 Gemini','online',true,NOW(),NOW()) ON CONFLICT (vin) DO UPDATE SET state='online',healthy=true`);
  
  // Auth token
  psql("INSERT INTO tokens (id,access_token,refresh_token,expires_at,created_at,updated_at) VALUES (1,'fake-test-token','fake-refresh-token',NOW()+interval '30 days',NOW(),NOW()) ON CONFLICT (id) DO UPDATE SET access_token='fake-test-token',expires_at=NOW()+interval '30 days'");
  
  // Settings with requested unit combo
  psql(`INSERT INTO settings (id,unit_of_length,unit_of_temp,preferred_range,language,base_cost_per_kwh,api_suspended,theme,mode,custom_primary,custom_accent,gas_price_per_unit,gas_unit,gas_efficiency_mpg) VALUES (1,'${units.length}','${units.temp}','${units.range}','en',0.12,false,'neon-cyan','dark','#00b4d8','#e63946',3.96,'gallon',25) ON CONFLICT (id) DO UPDATE SET unit_of_length='${units.length}',unit_of_temp='${units.temp}',preferred_range='${units.range}'`);
  
  // Positions (24h of data)
  for (let i = 0; i < 48; i++) {
    const h = i * 0.5;
    const spd = (h >= 16 && h <= 17) ? (55 + Math.random() * 20).toFixed(1) : '0';
    const pwr = parseFloat(spd) > 0 ? (15 + Math.random() * 10).toFixed(1) : '0';
    const bat = 70 + Math.floor(Math.random() * 20);
    psql(`INSERT INTO positions (vehicle_id,latitude,longitude,speed,power,heading,odometer,ideal_range,rated_range,battery_level,inside_temp,outside_temp,is_climate_on,created_at) VALUES (1,${37.77+(Math.random()-0.5)*0.1},${-122.42+(Math.random()-0.5)*0.1},${spd},${pwr},${Math.floor(Math.random()*360)},${15234+i*0.5},${250+Math.random()*30},${240+Math.random()*30},${bat},${20+Math.random()*5},${15+Math.random()*10},${Math.random()>0.5},NOW()-interval '${24-h} hours')`);
  }
  
  // Vehicle states
  psql("INSERT INTO vehicle_states (vehicle_id,state,start_date,end_date,duration_min) VALUES (1,'online',NOW()-interval '24 hours',NOW()-interval '20 hours',240),(1,'driving',NOW()-interval '20 hours',NOW()-interval '19 hours',60),(1,'online',NOW()-interval '19 hours',NOW()-interval '12 hours',420),(1,'charging',NOW()-interval '12 hours',NOW()-interval '8 hours',240),(1,'online',NOW()-interval '8 hours',NOW()-interval '2 hours',360),(1,'driving',NOW()-interval '2 hours',NOW()-interval '1 hour',60),(1,'charging',NOW()-interval '1 hour',NULL,NULL)");
  
  // Drives
  psql("INSERT INTO drives (vehicle_id,start_date,end_date,distance,duration_min,speed_max,power_max,power_min,start_battery_level,end_battery_level) VALUES (1,NOW()-interval '20 hours',NOW()-interval '19 hours',45.2,60,110,85,-30,85,72),(1,NOW()-interval '2 hours',NOW()-interval '1 hour',32.8,55,95,65,-25,78,68)");
  
  // Charging sessions
  psql("INSERT INTO charging_sessions (vehicle_id,start_date,end_date,charge_energy_added,start_battery_level,end_battery_level,start_range_km,end_range_km,charger_power,duration_min,cost) VALUES (1,NOW()-interval '12 hours',NOW()-interval '8 hours',35.5,55,85,140,220,7.68,240,4.26),(1,NOW()-interval '1 hour',NULL,8.2,68,NULL,175,NULL,7.68,0,NULL)");
  
  // Daily mileage (30 days)
  for (let i = 0; i < 30; i++) {
    psql(`INSERT INTO daily_mileage (vehicle_id,date,start_odometer,end_odometer,distance_km) VALUES (1,(NOW()-interval '${30-i} days')::date,${15200+i*10},${15200+i*10+30+Math.random()*50},${(30+Math.random()*50).toFixed(1)})`);
  }
  
  // Telemetry snapshots
  psql("INSERT INTO charging_telemetry (vehicle_id,battery_level,soc,charge_state,charge_amps,charger_voltage,charger_phases,charge_rate_mph,ac_charging_power,est_battery_range,ideal_battery_range,rated_range,energy_remaining,pack_voltage,pack_current,time_to_full_charge,charge_limit_soc,created_at) VALUES (1,80,80.5,'Charging',32,240.5,1,30.5,7.68,250.3,280.1,260.0,55.2,390.5,20.1,2.5,90,NOW())");
  psql("INSERT INTO climate_snapshots (vehicle_id,inside_temp,outside_temp,hvac_fan_speed,hvac_left_temp_request,hvac_right_temp_request,created_at) VALUES (1,22.5,18.3,3,21.0,22.0,NOW())");
  // Telemetry snapshots (motor, climate, security, charging, tire) - use file to avoid escaping
  try {
    execSync('docker cp D:\\repos\\teslasync\\seed_snapshots.sql teslasync-postgres:/tmp/seed.sql', { stdio: 'pipe' });
    execSync('docker exec teslasync-postgres psql -U teslasync -d teslasync -f /tmp/seed.sql', { stdio: 'pipe' });
  } catch {}
  
  // Alerts
  psql("INSERT INTO alerts (vehicle_id,type,severity,title,message,is_read,created_at) VALUES (1,'low_battery','warning','Low Battery','Battery below 20%',false,NOW()-interval '5 hours'),(1,'charging_complete','info','Charging Done','Finished at 85%',true,NOW()-interval '8 hours')");
  psql("INSERT INTO alert_rules (name,type,enabled,threshold,created_at,updated_at) VALUES ('Low Battery','battery_low',true,20,NOW(),NOW()),('Speed Limit','speed_limit',true,120,NOW(),NOW()) ON CONFLICT DO NOTHING");
  
  // Gas price
  psql("INSERT INTO gas_price_history (price_per_unit,unit,efficiency_mpg,effective_from) SELECT 3.96,'gallon',25,NOW()-interval '7 days' WHERE NOT EXISTS (SELECT 1 FROM gas_price_history)");
}

const SIGNALS = [
  ['BatteryLevel','80'],['Soc','80.5'],['ChargeState','Charging'],
  ['ChargeAmps','32'],['ChargerVoltage','240.5'],['ChargeRateMilePerHour','30.5'],
  ['ACChargingPower','7.68'],['EstBatteryRange','250.3'],['RatedRange','260.0'],
  ['PackVoltage','390.5'],['TimeToFullCharge','2.5'],
  ['InsideTemp','22.5'],['OutsideTemp','18.3'],['HvacFanSpeed','3'],
  ['Locked','true'],['SentryMode','true'],['DoorState','ClosedAll'],['FdWindow','Closed'],
  ['TpmsPressureFl','2.9'],['TpmsPressureFr','3.0'],['TpmsPressureRl','2.85'],['TpmsPressureRr','2.95'],
  ['VehicleSpeed','0'],['Gear','P'],['Odometer','15234.5'],
];

function publishSignals() {
  let ok = 0;
  for (const [n,v] of SIGNALS) {
    try { execSync(`docker exec teslasync-mosquitto mosquitto_pub -h localhost -t "telemetry/${VIN}/v/${n}" -m "${v}" -q 1`,{stdio:'pipe'}); ok++; } catch {}
  }
  return ok;
}

const PAGES = [
  { name: 'Dashboard', path: '/' },
  { name: 'Vehicles', path: '/vehicles' },
  { name: 'Charging', path: '/charging' },
  { name: 'Energy', path: '/energy' },
  { name: 'EnergyFlow', path: '/energy-flow' },
  { name: 'ClimateControl', path: '/climate-control' },
  { name: 'SecurityAccess', path: '/security-access' },
  { name: 'DrivetrainHealth', path: '/drivetrain-health' },
  { name: 'TirePressure', path: '/tire-pressure' },
  { name: 'Timeline', path: '/timeline' },
  { name: 'Drives', path: '/drives' },
  { name: 'Analytics', path: '/analytics' },
  { name: 'Alerts', path: '/alerts' },
  { name: 'Settings', path: '/settings' },
  { name: 'Mileage', path: '/mileage' },
  { name: 'CostAnalysis', path: '/cost-analysis' },
  { name: 'SystemStatus', path: '/system-status' },
];

async function fetchJson(url) {
  try { const r = await fetch(url); return { status: r.status, data: await r.json() }; }
  catch { return { status: 0, data: null }; }
}

async function runIteration(iterNum, units, browser) {
  const iterDir = path.join(BASE_DIR, `iteration-${iterNum}`);
  const ssDir = path.join(iterDir, 'screenshots');
  fs.mkdirSync(ssDir, { recursive: true });

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ITERATION ${iterNum}: ${units.name} (${units.desc})`);
  console.log(`${'='.repeat(70)}`);

  let pass = 0, fail = 0;
  const failures = [];

  // 1. Reset + Seed
  console.log('  [1] Reset & Seed DB...');
  resetAndSeed(units);

  // 2. Publish MQTT
  console.log('  [2] Publish signals...');
  const pubOk = publishSignals();
  pass += pubOk;
  console.log(`      ${pubOk}/${SIGNALS.length} published`);

  // 3. Wait for processing
  console.log('  [3] Waiting 25s for signal processing...');
  await new Promise(r => setTimeout(r, 12000));
  try { execSync(`docker exec teslasync-mosquitto mosquitto_pub -h localhost -t "telemetry/${VIN}/v/Soc" -m "80.5" -q 1`,{stdio:'pipe'}); } catch {}
  await new Promise(r => setTimeout(r, 13000));

  // 4. API checks
  console.log('  [4] API endpoints...');
  const apis = ['/healthz','/readyz','/api/v1/vehicles','/api/v1/vehicles/1/state','/api/v1/settings','/api/v1/alerts','/api/v1/system/status','/api/v1/charging?vehicle_id=1&limit=5','/api/v1/drives?vehicle_id=1&limit=5','/api/v1/climate/latest?vehicle_id=1','/api/v1/security/latest?vehicle_id=1','/api/v1/tire-pressure/latest?vehicle_id=1','/api/v1/charging-telemetry/latest?vehicle_id=1','/api/v1/telemetry'];
  for (const ep of apis) {
    const { status } = await fetchJson(`${API}${ep}`);
    status === 200 ? pass++ : (fail++, failures.push(`API ${ep}: ${status}`));
  }

  // 5. Vehicle state
  console.log('  [5] Vehicle state...');
  const { data: vs } = await fetchJson(`${API}/api/v1/vehicles/1/state`);
  const s = vs?.state || {};
  const checks = {
    'battery>0': s.battery_level > 0,
    'range>0': s.rated_range > 0 || s.ideal_range > 0,
    'is_charging': s.is_charging === true,
    'inside_temp>0': s.inside_temp > 0,
    'is_locked': s.is_locked === true,
  };
  for (const [k, v] of Object.entries(checks)) {
    v ? pass++ : (fail++, failures.push(`State: ${k}`));
  }

  // 6. Settings verification
  console.log('  [6] Settings verification...');
  const { data: settings } = await fetchJson(`${API}/api/v1/settings`);
  const settingsOk = settings?.unit_of_length === units.length && settings?.unit_of_temp === units.temp && settings?.preferred_range === units.range;
  settingsOk ? pass++ : (fail++, failures.push(`Settings mismatch: got ${settings?.unit_of_length}/${settings?.unit_of_temp}/${settings?.preferred_range}, expected ${units.length}/${units.temp}/${units.range}`));

  // 7. Table counts
  console.log('  [7] Table counts...');
  const tables = ['positions','charging_telemetry','climate_snapshots','security_events','motor_snapshots','tire_pressure_snapshots','vehicle_states','drives','charging_sessions','daily_mileage','alerts'];
  for (const t of tables) {
    const c = parseInt(psql(`SELECT COUNT(*) FROM ${t}`)) || 0;
    c > 0 ? pass++ : (fail++, failures.push(`Table ${t}=0`));
  }

  // 8. Error check
  console.log('  [8] Error check...');
  try {
    const logs = execSync('docker logs teslasync-api --tail 100 2>&1', { stdio: 'pipe' }).toString();
    const errs = logs.split('\n').filter(l => l.includes('"level":"error"')).length;
    errs === 0 ? pass++ : (fail++, failures.push(`${errs} errors in logs`));
  } catch { fail++; }

  // 9. Screenshots
  console.log('  [9] Screenshots...');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('teslasync-onboarded', 'true'); });
  const page = await ctx.newPage();
  const pageResults = [];

  for (const pg of PAGES) {
    try {
      await page.goto(`${UI}${pg.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: path.join(ssDir, `${pg.name}.png`), fullPage: true });

      const body = await page.textContent('body');
      const hasNaN = /\bNaN\b/.test(body);
      const hasUndef = /\bundefined\b/.test(body);
      const hasInf = /(?<!\w)Infinity\b/.test(body);
      const ok = !hasNaN && !hasUndef && !hasInf;
      ok ? pass++ : (fail++, failures.push(`UI ${pg.name}: ${[hasNaN&&'NaN',hasUndef&&'undefined',hasInf&&'Infinity'].filter(Boolean).join('+')}`));
      pageResults.push({ name: pg.name, pass: ok, hasNaN, hasUndef, hasInf, ss: `screenshots/${pg.name}.png` });
      console.log(`      ${ok ? '✅' : '❌'} ${pg.name}${ok ? '' : ` [${hasNaN?'NaN ':''}${hasUndef?'undef ':''}${hasInf?'Inf':''}]`}`);
    } catch (e) {
      fail++;
      failures.push(`UI ${pg.name}: CRASH`);
      pageResults.push({ name: pg.name, pass: false, error: e.message.slice(0, 80) });
      console.log(`      ❌ ${pg.name}: CRASH`);
    }
  }
  await ctx.close();

  // Report
  let md = `# Iteration ${iterNum} — ${units.name} (${units.desc})\n\n`;
  md += `**Date**: ${new Date().toISOString()}\n`;
  md += `**Units**: length=${units.length}, temp=${units.temp}, range=${units.range}\n`;
  md += `**Result**: **${pass} PASS / ${fail} FAIL**\n\n`;
  
  if (failures.length) {
    md += `## ❌ Failures (${failures.length})\n`;
    failures.forEach(f => md += `- ${f}\n`);
    md += '\n';
  }

  md += `## UI Pages (${units.name})\n`;
  md += `| Page | Result | Screenshot |\n|------|--------|------------|\n`;
  for (const p of pageResults) {
    md += `| ${p.name} | ${p.pass ? '✅' : '❌'} | ${p.ss ? `![](${p.ss})` : 'N/A'} |\n`;
  }
  md += `\n## Summary: ${pass} PASS / ${fail} FAIL\n`;

  fs.writeFileSync(path.join(iterDir, 'report.md'), md);
  console.log(`\n  >>> ITERATION ${iterNum} (${units.name}): ${pass} PASS / ${fail} FAIL`);
  return { pass, fail, failures };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let gp = 0, gf = 0;
  const summary = [];

  for (let i = 10; i < 20; i++) {
    const { pass, fail, failures } = await runIteration(i + 1, UNIT_COMBOS[i % UNIT_COMBOS.length], browser);
    gp += pass; gf += fail;
    summary.push({ iter: i + 1, units: UNIT_COMBOS[i % UNIT_COMBOS.length].name, desc: UNIT_COMBOS[i % UNIT_COMBOS.length].desc, pass, fail, failures: failures.length });
    if (i < 19) { console.log('\n  --- pause 3s ---'); await new Promise(r => setTimeout(r, 3000)); }
  }

  await browser.close();

  // Grand summary
  let md = `# TeslaSync Test Summary — Iterations 11-20\n\n`;
  md += `**Date**: ${new Date().toISOString()}\n`;
  md += `**Total**: ${gp} PASS / ${gf} FAIL\n\n`;
  md += `| Iter | Units | Description | Pass | Fail |\n|------|-------|-------------|------|------|\n`;
  for (const s of summary) {
    md += `| ${s.iter} | ${s.units} | ${s.desc} | ${s.pass} | ${s.fail} |\n`;
  }
  fs.writeFileSync(path.join(BASE_DIR, 'summary.md'), md);

  console.log(`\n${'#'.repeat(70)}`);
  console.log(`  FINAL: ${gp} PASS / ${gf} FAIL across 10 iterations (8 unit combos)`);
  console.log(`${'#'.repeat(70)}`);
}

main().catch(console.error);


