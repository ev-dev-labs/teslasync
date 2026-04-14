const { MongoClient } = require('mongodb');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://teslasync:Y-y4vKw7cJlsfKQnmIm3sEwZS3-OBjRx@192.168.68.214:27017/teslasync?authSource=teslasync';

async function run() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('teslasync');

  // Check Location signal in signal_log
  const locCount = await db.collection('signal_log').countDocuments({ signal: 'Location' });
  console.log('Location signals in signal_log:', locCount);

  if (locCount > 0) {
    const sample = await db.collection('signal_log').findOne({ signal: 'Location' });
    console.log('Sample:', JSON.stringify(sample, null, 2));
  }

  // Check raw_signals collection for Location
  const withLocation = await db.collection('raw_signals').countDocuments({ 'signals.Location': { $exists: true } });
  console.log('\nraw_signals with Location:', withLocation);

  if (withLocation > 0) {
    const sample = await db.collection('raw_signals').findOne({ 'signals.Location': { $exists: true } });
    console.log('Sample:', JSON.stringify(sample, null, 2));
  }

  // Check all location-related signal names
  const pipeline = [
    { $project: { keys: { $objectToArray: '$signals' } } },
    { $unwind: '$keys' },
    { $group: { _id: '$keys.k' } },
    { $sort: { _id: 1 } }
  ];
  const allKeys = await db.collection('raw_signals').aggregate(pipeline).toArray();
  const locationKeys = allKeys.filter(k => k._id.match(/[Ll]ocation|[Ll]at|[Ll]on|[Gg]ps/));
  console.log('\nLocation-related keys in raw_signals:', locationKeys.map(k => k._id));

  await client.close();
}

run().catch(e => console.error(e.message));
