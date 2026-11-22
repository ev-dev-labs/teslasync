DROP VIEW IF EXISTS smart_charging_candidate_decisions;
DROP TABLE IF EXISTS smart_charging_departure_conflicts;

-- Keep both the attempts and their family deduplication: older workers use
-- untargeted ON CONFLICT and can run without mutating retained delivery history.
