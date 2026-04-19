-- Migration 122: Normalize raw Tesla enum prefixes in safety_snapshots.
-- ForwardCollisionWarning, LaneDepartureAvoidance, SpeedLimitWarning, and
-- CruiseFollowDistance were stored with full Tesla enum prefixes
-- (e.g., "ForwardCollisionSensitivityEarly" instead of "Early").
-- This migration strips those prefixes for consistency with the new parse logic.

UPDATE safety_snapshots SET forward_collision_warning = CASE
    WHEN forward_collision_warning LIKE 'ForwardCollisionSensitivity%'
    THEN REPLACE(forward_collision_warning, 'ForwardCollisionSensitivity', '')
    ELSE forward_collision_warning
END
WHERE forward_collision_warning LIKE 'ForwardCollisionSensitivity%';

UPDATE safety_snapshots SET lane_departure_avoidance = CASE
    WHEN lane_departure_avoidance LIKE 'LaneAssistLevel%'
    THEN REPLACE(lane_departure_avoidance, 'LaneAssistLevel', '')
    ELSE lane_departure_avoidance
END
WHERE lane_departure_avoidance LIKE 'LaneAssistLevel%';

UPDATE safety_snapshots SET speed_limit_warning = CASE
    WHEN speed_limit_warning = 'SpeedAssistLevelNone' THEN 'Off'
    WHEN speed_limit_warning LIKE 'SpeedAssistLevel%'
    THEN REPLACE(speed_limit_warning, 'SpeedAssistLevel', '')
    ELSE speed_limit_warning
END
WHERE speed_limit_warning LIKE 'SpeedAssistLevel%';

UPDATE safety_snapshots SET cruise_follow_distance = CASE
    WHEN cruise_follow_distance LIKE 'FollowDistance%'
    THEN REPLACE(cruise_follow_distance, 'FollowDistance', '')
    ELSE cruise_follow_distance
END
WHERE cruise_follow_distance LIKE 'FollowDistance%';
