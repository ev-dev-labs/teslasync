const { MongoClient } = require('mongodb');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/teslasync';

async function run() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('teslasync');

  // Get all distinct signal names from signal_log (per-signal store)
  const signalLogNames = await db.collection('signal_log').distinct('signal');
  const signalLogSet = new Set(signalLogNames);

  // Get all distinct signal names from raw_signals (batched store)
  const pipeline = [
    { $project: { keys: { $objectToArray: '$signals' } } },
    { $unwind: '$keys' },
    { $group: { _id: '$keys.k' } },
    { $sort: { _id: 1 } }
  ];
  const rawKeys = await db.collection('raw_signals').aggregate(pipeline).toArray();
  const rawSignalNames = rawKeys.map(k => k._id);

  // Find signals in raw_signals but NOT in signal_log (compound types that got skipped)
  const missingFromSignalLog = rawSignalNames.filter(n => !signalLogSet.has(n));

  console.log(`signal_log has ${signalLogNames.length} distinct signals`);
  console.log(`raw_signals has ${rawSignalNames.length} distinct signals`);
  console.log(`\nSignals in raw_signals but NOT in signal_log (${missingFromSignalLog.length}):`);

  // For each missing signal, check what type of value it has
  for (const name of missingFromSignalLog) {
    const sample = await db.collection('raw_signals').findOne(
      { [`signals.${name}`]: { $exists: true } }
    );
    const value = sample.signals[name];
    const type = typeof value === 'object' ? `object: ${JSON.stringify(value).substring(0, 80)}` : `${typeof value}: ${value}`;
    const count = await db.collection('raw_signals').countDocuments({ [`signals.${name}`]: { $exists: true } });
    console.log(`  ${name}: ${count} occurrences — ${type}`);
  }

  await client.close();
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
