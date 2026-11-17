ALTER TABLE widget_design_preferences
    ADD COLUMN IF NOT EXISTS app_wide boolean NOT NULL DEFAULT false;
