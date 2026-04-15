const { MongoClient } = require('mongodb');
const fs = require('fs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/teslasync';
const OUTPUT_FILE = 'scripts/signals-export.json';
const DAYS = 14;

async function run() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('Connected to MongoDB');

  const db = client.db('teslasync');

  // Explore
  const collections = await db.listCollections().toArray();
  console.log('Collections:', collections.map(c => c.name).join(', '));

  const totalCount = await db.collection('signal_log').countDocuments();
  console.log('Total signals:', totalCount.toLocaleString());

  const vehicleIds = await db.collection('signal_log').distinct('vehicle_id');
  console.log('Vehicle IDs:', vehicleIds);

  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const recentCount = await db.collection('signal_log').countDocuments({ timestamp: { $gte: cutoff } });
  console.log(`Signals (last ${DAYS} days):`, recentCount.toLocaleString());

  const signalNames = await db.collection('signal_log').distinct('signal', { timestamp: { $gte: cutoff } });
  console.log('Distinct signals:', signalNames.length);
  console.log('  ', signalNames.join(', '));

  // Export
  console.log(`\nExporting ${recentCount.toLocaleString()} signals to ${OUTPUT_FILE}...`);
  const cursor = db.collection('signal_log').find({ timestamp: { $gte: cutoff } }).sort({ timestamp: 1 });

  const out = fs.createWriteStream(OUTPUT_FILE);
  out.write('[\n');
  let count = 0;
  let first = true;

  for await (const doc of cursor) {
    if (!first) out.write(',\n');
    first = false;
    out.write(JSON.stringify(doc));
    count++;
    if (count % 100000 === 0) {
      console.log(`  ${count.toLocaleString()} exported...`);
    }
  }

  out.write('\n]\n');
  out.end();

  console.log(`\nDone! Exported ${count.toLocaleString()} signals to ${OUTPUT_FILE}`);
  const stats = fs.statSync(OUTPUT_FILE);
  console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);

  await client.close();
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
