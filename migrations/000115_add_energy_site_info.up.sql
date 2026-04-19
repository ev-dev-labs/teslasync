ALTER TABLE tesla_energy_sites ADD COLUMN IF NOT EXISTS site_info_json JSONB;
ALTER TABLE tesla_energy_sites ADD COLUMN IF NOT EXISTS site_info_fetched_at TIMESTAMPTZ;
