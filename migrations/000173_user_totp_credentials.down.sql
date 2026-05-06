-- Phase-46 / Prompt 35 — Rollback for the per-user TOTP enrollment tables.
--
-- Order matters: the credentials table holds activated rows, the
-- enrollments table holds pending rows. Neither references the other,
-- so the drop order is purely cosmetic, but consistent listing in the
-- up migration's order keeps the diff easy to review.

DROP INDEX IF EXISTS idx_user_totp_credentials_activated_at;
DROP TABLE IF EXISTS user_totp_credentials;
DROP INDEX IF EXISTS idx_user_totp_enrollments_expires_at;
DROP TABLE IF EXISTS user_totp_enrollments;
