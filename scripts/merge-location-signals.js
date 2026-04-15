const { MongoClient } = require('mongodb');
const fs = require('fs');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/teslasync';

async function run() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('teslasync');

  // Find all raw_signals batches that contain Location
  const cursor = db.collection('raw_signals').find(
    { 'signals.Location': { $exists: true } },
    { sort: { created_at: 1 } }
  );

  const locationSignals = [];
  for await (const doc of cursor) {
    const loc = doc.signals.Location;
    if (loc && loc.latitude && loc.longitude) {
      locationSignals.push({
        vehicle_id: 1,
        signal: 'Latitude',
        value_num: loc.latitude,
        timestamp: doc.created_at
      });
      locationSignals.push({
        vehicle_id: 1,
        signal: 'Longitude',
        value_num: loc.longitude,
        timestamp: doc.created_at
      });
    }
  }

  console.log(`Extracted ${locationSignals.length} lat/lng signals from ${locationSignals.length / 2} Location records`);
  if (locationSignals.length > 0) {
    console.log('Sample lat:', JSON.stringify(locationSignals[0]));
    console.log('Sample lng:', JSON.stringify(locationSignals[1]));
  }

  // Load existing export and merge
  console.log('\nLoading existing export...');
  const existing = JSON.parse(fs.readFileSync('scripts/signals-export.json', 'utf8'));
  console.log('Existing signals:', existing.length.toLocaleString());

  const merged = existing.concat(locationSignals);
  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  console.log('Merged total:', merged.length.toLocaleString());
  fs.writeFileSync('scripts/signals-export.json', JSON.stringify(merged));

  const size = fs.statSync('scripts/signals-export.json').size / 1024 / 1024;
  console.log(`New file size: ${size.toFixed(1)} MB`);

  await client.close();
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
