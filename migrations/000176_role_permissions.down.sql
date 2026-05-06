-- Phase-46 / Prompt 44 — rollback for role_permissions.
--
-- Hard-drops the table. Bindings are operator-curated at the UI layer;
-- a re-up migration leaves all roles "no opinion" (every cell falls
-- back to the implicit default), which the admin then re-fills via
-- the matrix UI.

DROP TABLE IF EXISTS role_permissions;
