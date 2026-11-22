CREATE TABLE smart_feature_preferences (
    subject text COLLATE "C" NOT NULL CHECK (octet_length(subject) BETWEEN 1 AND 512),
    feature text COLLATE "C" NOT NULL CHECK (feature ~ '^[a-z][a-z0-9_]{0,63}$'),
    allowed boolean NOT NULL,
    paused_at timestamptz,
    PRIMARY KEY (subject, feature)
);

CREATE FUNCTION smart_feature_allowed(p_subject text, p_feature text)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT p_subject IS NOT NULL AND p_subject <> '' AND COALESCE(
        (SELECT allowed FROM smart_feature_preferences
         WHERE subject = p_subject AND feature = p_feature), true)
$$;

CREATE FUNCTION smart_feature_current(p_subject text, p_feature text, p_work_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT p_subject IS NOT NULL AND p_subject <> '' AND COALESCE((
        SELECT allowed AND (paused_at IS NULL OR COALESCE(p_work_at > paused_at, false))
        FROM smart_feature_preferences WHERE subject = p_subject AND feature = p_feature
    ), true)
$$;

CREATE FUNCTION smart_feature_lock_key(p_subject text, p_feature text)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT hashtextextended('smart-feature:' || p_feature || ':' || p_subject, 0)
$$;

CREATE FUNCTION smart_charging_feature(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE p_kind WHEN 'departure_overlap' THEN 'departure_overlap' WHEN 'early_stop' THEN 'early_stop'
                       ELSE 'charging_readiness' END
$$;

ALTER TABLE smart_recall_watches ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_overnight_drain_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_capacity_trend_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_climate_schedule_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_cabin_prep_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_park_reserve_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_window_rain_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_parked_closure_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_parked_unlock_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_solar_charging_plans ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_backup_charging_watches ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_warranty_reminders ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_trip_maintenance ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_favorite_digest_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_charging_cost_plans ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_charging_cost_digests ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_monthly_tariff_plans ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_monthly_tariff_digests ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_mileage_term_plans ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_mileage_term_digests ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_trip_packet_plans ADD COLUMN feature_claimed_at timestamptz, ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_subscription_renewal_plans ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_subscription_renewal_occurrences ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_weekly_drive_efficiency_plans ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_weekly_drive_efficiency_digests ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_commute_routines ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_commute_traffic_occurrences ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_charging_plans ADD COLUMN feature_claimed_at timestamptz,
    ADD COLUMN feature_readiness_at timestamptz, ADD COLUMN feature_overlap_at timestamptz;
ALTER TABLE smart_charging_slow_samples ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_push_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_commute_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_public_fee_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_backup_charging_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_cabin_prep_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_park_reserve_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_window_rain_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_parked_closure_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_push_parked_unlock_deliveries ADD COLUMN feature_enqueued_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE smart_trip_stop_scopes ADD COLUMN feature_claimed_at timestamptz;
ALTER TABLE smart_cold_tire_reviews ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_shared_charger_swaps ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_media_playlist_drafts ADD COLUMN feature_checked_at timestamptz;
ALTER TABLE smart_drive_track_reviews ADD COLUMN feature_authorized_at timestamptz;
ALTER TABLE smart_episode_reviews ADD COLUMN feature_authorized_at timestamptz;
