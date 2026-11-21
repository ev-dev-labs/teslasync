CREATE TABLE smart_subscription_renewal_plans (
    subscription_id bigint PRIMARY KEY REFERENCES vehicle_subscriptions(id) ON DELETE CASCADE,
    subscription_version integer NOT NULL CHECK (subscription_version > 0),
    revision uuid NOT NULL DEFAULT gen_random_uuid(),
    renewal_day date NOT NULL,
    time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    lead_days integer NOT NULL CHECK (lead_days BETWEEN 1 AND 30),
    paused boolean NOT NULL,
    next_check_at timestamptz CHECK (NOT paused OR next_check_at IS NULL),
    expires_at timestamptz NOT NULL,
    lease_until timestamptz
);

CREATE INDEX idx_smart_subscription_renewal_plans_due ON smart_subscription_renewal_plans (next_check_at, subscription_id)
    WHERE next_check_at IS NOT NULL;

CREATE TABLE smart_subscription_renewal_occurrences (
    -- Action Center history survives rollback of the renewal tables.
    id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    subscription_id bigint NOT NULL REFERENCES smart_subscription_renewal_plans(subscription_id) ON DELETE CASCADE,
    renewal_day date NOT NULL,
    published_at timestamptz NOT NULL,
    dismissed_at timestamptz,
    PRIMARY KEY (subscription_id, renewal_day)
);
