const { MongoClient } = require('mongodb');
const fs = require('fs');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://teslasync:Y-y4vKw7cJlsfKQnmIm3sEwZS3-OBjRx@192.168.68.214:27017/teslasync?authSource=teslasync';

async function run() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('teslasync');

  const extraSignals = [];

  // 1. DestinationLocation → DestinationLatitude + DestinationLongitude
  const destCursor = db.collection('raw_signals').find(
    { 'signals.DestinationLocation': { $exists: true, $ne: null } },
    { sort: { created_at: 1 } }
  );
  for await (const doc of destCursor) {
    const loc = doc.signals.DestinationLocation;
    if (loc && loc.latitude && loc.longitude) {
      extraSignals.push({ vehicle_id: 1, signal: 'DestinationLatitude', value_num: loc.latitude, timestamp: doc.created_at });
      extraSignals.push({ vehicle_id: 1, signal: 'DestinationLongitude', value_num: loc.longitude, timestamp: doc.created_at });
    }
  }

  // 2. OriginLocation → OriginLatitude + OriginLongitude
  const originCursor = db.collection('raw_signals').find(
    { 'signals.OriginLocation': { $exists: true, $ne: null } },
    { sort: { created_at: 1 } }
  );
  for await (const doc of originCursor) {
    const loc = doc.signals.OriginLocation;
    if (loc && loc.latitude && loc.longitude) {
      extraSignals.push({ vehicle_id: 1, signal: 'OriginLatitude', value_num: loc.latitude, timestamp: doc.created_at });
      extraSignals.push({ vehicle_id: 1, signal: 'OriginLongitude', value_num: loc.longitude, timestamp: doc.created_at });
    }
  }

  // 3. DoorState → individual door booleans
  const doorCursor = db.collection('raw_signals').find(
    { 'signals.DoorState': { $exists: true, $ne: null } },
    { sort: { created_at: 1 } }
  );
  for await (const doc of doorCursor) {
    const doors = doc.signals.DoorState;
    if (doors && typeof doors === 'object') {
      for (const [door, isOpen] of Object.entries(doors)) {
        extraSignals.push({ vehicle_id: 1, signal: `DoorState_${door}`, value_bool: isOpen, timestamp: doc.created_at });
      }
    }
  }

  console.log(`Extracted ${extraSignals.length} additional signals:`);
  const bySignal = {};
  extraSignals.forEach(s => { bySignal[s.signal] = (bySignal[s.signal] || 0) + 1 });
  Object.entries(bySignal).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Load and merge
  console.log('\nLoading existing export...');
  const existing = JSON.parse(fs.readFileSync('scripts/signals-export.json', 'utf8'));
  console.log('Existing:', existing.length.toLocaleString());

  const merged = existing.concat(extraSignals);
  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  console.log('Merged:', merged.length.toLocaleString());
  fs.writeFileSync('scripts/signals-export.json', JSON.stringify(merged));

  const size = fs.statSync('scripts/signals-export.json').size / 1024 / 1024;
  console.log(`File size: ${size.toFixed(1)} MB`);

  await client.close();
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
