const fs = require('fs');
const mqtt = require('mqtt');

/* ================================================================
 *  TeslaSync Signal Replay Script
 *
 *  Reads exported MongoDB signals and publishes them to local MQTT
 *  in the exact format Fleet Telemetry uses:
 *    Topic:  telemetry/{VIN}/v/{SignalName}
 *    Payload: JSON value
 *
 *  Usage:
 *    node scripts/replay-signals.js [options]
 *
 *  Options:
 *    --input=FILE     Signal export JSON file (default: scripts/signals-export.json)
 *    --speed=N        Replay speed multiplier: 1, 2, 5, 10, 100, max (default: 10)
 *    --vin=VIN        VIN to publish as (default: TEST00000000VIN01)
 *    --broker=URL     MQTT broker URL (default: mqtt://localhost:1883)
 *    --topic-base=X   Topic prefix (default: telemetry)
 *    --dry-run        Print signals without publishing
 *    --limit=N        Stop after N signals (for testing)
 * ================================================================ */

// Parse CLI args
const args = {};
process.argv.slice(2).forEach(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  args[k] = v ?? 'true';
});

const INPUT = args.input || 'scripts/signals-export.json';
const SPEED = args.speed === 'max' ? Infinity : parseInt(args.speed || '10', 10);
const VIN = args.vin || 'TEST00000000VIN01';
const BROKER = args.broker || 'mqtt://localhost:1883';
const TOPIC_BASE = args['topic-base'] || 'telemetry';
const DRY_RUN = args['dry-run'] === 'true';
const LIMIT = args.limit ? parseInt(args.limit, 10) : 0;

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  TeslaSync Signal Replay');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Input:      ${INPUT}`);
  console.log(`  Speed:      ${SPEED === Infinity ? 'MAX (no delay)' : SPEED + 'x'}`);
  console.log(`  VIN:        ${VIN}`);
  console.log(`  Broker:     ${BROKER}`);
  console.log(`  Topic base: ${TOPIC_BASE}`);
  console.log(`  Dry run:    ${DRY_RUN}`);
  console.log('');

  // Load signals
  console.log('Loading signals...');
  const raw = fs.readFileSync(INPUT, 'utf8');
  const signals = JSON.parse(raw);
  const total = LIMIT > 0 ? Math.min(signals.length, LIMIT) : signals.length;
  console.log(`Loaded ${signals.length.toLocaleString()} signals, replaying ${total.toLocaleString()}`);

  if (signals.length === 0) {
    console.log('No signals to replay');
    return;
  }

  const firstTs = new Date(signals[0].timestamp).getTime();
  const lastTs = new Date(signals[Math.min(total - 1, signals.length - 1)].timestamp).getTime();
  const spanMs = lastTs - firstTs;
  const replayMs = SPEED === Infinity ? 0 : spanMs / SPEED;
  console.log(`Time span:   ${formatDuration(spanMs)} of real data`);
  console.log(`Replay time: ${SPEED === Infinity ? 'instant' : formatDuration(replayMs)}`);
  console.log('');

  // Connect MQTT
  let client = null;
  if (!DRY_RUN) {
    client = mqtt.connect(BROKER);
    await new Promise((resolve, reject) => {
      client.on('connect', () => { console.log('Connected to MQTT broker'); resolve(); });
      client.on('error', (e) => { console.error('MQTT error:', e.message); reject(e); });
      setTimeout(() => reject(new Error('MQTT connection timeout')), 5000);
    });
  }

  // Replay
  console.log('Starting replay...');
  const startTime = Date.now();
  let published = 0;
  let lastLog = Date.now();

  for (let i = 0; i < total; i++) {
    const sig = signals[i];
    const sigTs = new Date(sig.timestamp).getTime();
    const offsetMs = sigTs - firstTs;

    // Wait for the right time (adjusted for speed)
    if (SPEED !== Infinity && i > 0) {
      const targetWallTime = startTime + (offsetMs / SPEED);
      const now = Date.now();
      const delay = targetWallTime - now;
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // Extract the raw value
    const topic = `${TOPIC_BASE}/${VIN}/v/${sig.signal}`;
    let value;
    if (sig.value_num != null) value = sig.value_num;
    else if (sig.value_str != null) value = sig.value_str;
    else if (sig.value_bool != null) value = sig.value_bool;
    else value = null;

    if (DRY_RUN) {
      if (i < 10 || i % 10000 === 0) {
        console.log(`  [${i}] ${topic} = ${JSON.stringify(value)}`);
      }
    } else {
      // Fleet Telemetry sends raw JSON-encoded values, not wrapped objects
      // The subscriber does json.Unmarshal(payload, &value) — so send just the value
      client.publish(topic, JSON.stringify(value), { qos: 0, retain: false });
    }

    published++;

    // Progress log every 5 seconds
    if (Date.now() - lastLog > 5000) {
      const pct = ((i / total) * 100).toFixed(1);
      const elapsed = formatDuration(Date.now() - startTime);
      const rate = Math.round(published / ((Date.now() - startTime) / 1000));
      console.log(`  ${pct}% — ${published.toLocaleString()} published — ${rate} signals/sec — elapsed: ${elapsed}`);
      lastLog = Date.now();
    }
  }

  const totalElapsed = Date.now() - startTime;
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Done! ${published.toLocaleString()} signals replayed`);
  console.log(`  Elapsed: ${formatDuration(totalElapsed)}`);
  console.log(`  Rate: ${Math.round(published / (totalElapsed / 1000))} signals/sec`);
  console.log('═══════════════════════════════════════════════════════');

  if (client) {
    client.end();
  }
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
