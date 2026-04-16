-- Remove backfilled battery snapshots (keep any manually created ones).
DELETE FROM battery_snapshots WHERE id > 0;
