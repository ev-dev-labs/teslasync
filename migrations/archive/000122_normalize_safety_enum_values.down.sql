-- Revert migration 122: Restore raw Tesla enum prefixes in safety_snapshots.
-- This re-adds the prefixes that were stripped in the up migration.

UPDATE safety_snapshots SET forward_collision_warning = 'ForwardCollisionSensitivity' || forward_collision_warning
WHERE forward_collision_warning IN ('Off', 'Late', 'Average', 'Early');

UPDATE safety_snapshots SET lane_departure_avoidance = 'LaneAssistLevel' || lane_departure_avoidance
WHERE lane_departure_avoidance IN ('Off', 'Warning', 'Assist');

UPDATE safety_snapshots SET speed_limit_warning = CASE
    WHEN speed_limit_warning = 'Off' THEN 'SpeedAssistLevelNone'
    ELSE 'SpeedAssistLevel' || speed_limit_warning
END
WHERE speed_limit_warning IN ('Off', 'Display', 'Chime');

UPDATE safety_snapshots SET cruise_follow_distance = 'FollowDistance' || cruise_follow_distance
WHERE cruise_follow_distance ~ '^[1-7]$';
