ALTER TABLE smart_overnight_drain_reviews
    ADD COLUMN evidence_fingerprint bytea CHECK (octet_length(evidence_fingerprint) = 32);

ALTER TABLE smart_capacity_trend_digests
    ADD COLUMN evidence_fingerprint bytea CHECK (octet_length(evidence_fingerprint) = 32);
