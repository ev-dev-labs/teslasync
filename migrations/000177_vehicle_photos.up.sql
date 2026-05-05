-- Phase-46 / Prompt 54 — Vehicle photo upload.
--
-- Stores the disk-relative paths to the three rendered sizes for the
-- per-vehicle hero image. The upload handler resizes the source to
-- thumb / medium / full, re-encodes as JPEG (which strips EXIF), and
-- writes the bytes under {cfg.VehiclePhotoDir} keyed by vehicle id;
-- this row is the index that lets GET /photo/{size} look up the file
-- and DELETE /photo unlink them on tear-down.
--
-- One row per vehicle (single hero photo — multi-photo galleries are
-- explicitly out of scope per the prompt). ON DELETE CASCADE so the
-- index goes when the vehicle does; the handler is responsible for
-- removing the on-disk bytes BEFORE the DELETE runs (best-effort —
-- orphan files only happen when the vehicle is hard-deleted out of
-- band, e.g. a manual SQL DELETE).
--
-- uploaded_at doubles as a cache buster: the SPA appends it as `?v=`
-- on every <img src> so a re-upload immediately invalidates browser
-- and CDN caches for the deterministic path.

CREATE TABLE IF NOT EXISTS vehicle_photos (
    vehicle_id  BIGINT      PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    thumb_path  TEXT        NOT NULL,
    medium_path TEXT        NOT NULL,
    full_path   TEXT        NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
