DROP TABLE smart_push_commute_deliveries;

DROP INDEX smart_push_devices_commute_recipient_idx;

ALTER TABLE smart_push_devices
    DROP COLUMN commute_body,
    DROP COLUMN commute_title,
    DROP COLUMN commute_enabled;
