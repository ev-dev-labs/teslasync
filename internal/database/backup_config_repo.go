package database

import (
	"context"
	"time"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"
)

type BackupConfigRepo struct {
	db *DB
}

func NewBackupConfigRepo(db *DB) *BackupConfigRepo {
	return &BackupConfigRepo{db: db}
}

func (r *BackupConfigRepo) Create(ctx context.Context, c *backupmodel.BackupConfig) error {
	query := `INSERT INTO backup_configs (name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, next_run_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, created_at, updated_at`
	var nextRun *time.Time
	if c.Enabled {
		t := time.Now().UTC().Add(time.Duration(c.FrequencyDays) * 24 * time.Hour)
		nextRun = &t
	}
	return r.db.Pool.QueryRow(ctx, query,
		c.Name, c.Enabled, c.BackupType, c.FrequencyDays, c.MaxRetention,
		c.Provider, c.ProviderConfig, c.IncludeTables, c.Compress, c.Encrypt, nextRun,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}

func (r *BackupConfigRepo) GetByID(ctx context.Context, id int64) (*backupmodel.BackupConfig, error) {
	query := `SELECT id, name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, last_run_at, next_run_at, created_at, updated_at
		FROM backup_configs WHERE id = $1`
	c := &backupmodel.BackupConfig{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&c.ID, &c.Name, &c.Enabled, &c.BackupType, &c.FrequencyDays, &c.MaxRetention,
		&c.Provider, &c.ProviderConfig, &c.IncludeTables, &c.Compress, &c.Encrypt,
		&c.LastRunAt, &c.NextRunAt, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (r *BackupConfigRepo) List(ctx context.Context) ([]*backupmodel.BackupConfig, error) {
	query := `SELECT id, name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, last_run_at, next_run_at, created_at, updated_at
		FROM backup_configs ORDER BY created_at DESC`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var configs []*backupmodel.BackupConfig
	for rows.Next() {
		c := &backupmodel.BackupConfig{}
		if err := rows.Scan(&c.ID, &c.Name, &c.Enabled, &c.BackupType, &c.FrequencyDays, &c.MaxRetention,
			&c.Provider, &c.ProviderConfig, &c.IncludeTables, &c.Compress, &c.Encrypt,
			&c.LastRunAt, &c.NextRunAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		configs = append(configs, c)
	}
	return configs, rows.Err()
}

func (r *BackupConfigRepo) Update(ctx context.Context, c *backupmodel.BackupConfig) error {
	query := `UPDATE backup_configs SET name=$2, enabled=$3, backup_type=$4, frequency_days=$5, max_retention=$6, provider=$7, provider_config=$8, include_tables=$9, compress=$10, encrypt=$11, next_run_at=$12, updated_at=NOW()
		WHERE id=$1`
	var nextRun *time.Time
	if c.Enabled {
		t := time.Now().UTC().Add(time.Duration(c.FrequencyDays) * 24 * time.Hour)
		nextRun = &t
	}
	_, err := r.db.Pool.Exec(ctx, query, c.ID, c.Name, c.Enabled, c.BackupType, c.FrequencyDays, c.MaxRetention,
		c.Provider, c.ProviderConfig, c.IncludeTables, c.Compress, c.Encrypt, nextRun)
	return err
}

func (r *BackupConfigRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM backup_configs WHERE id = $1`, id)
	return err
}

func (r *BackupConfigRepo) GetDueConfigs(ctx context.Context) ([]*backupmodel.BackupConfig, error) {
	query := `SELECT id, name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, last_run_at, next_run_at, created_at, updated_at
		FROM backup_configs WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= NOW())
		ORDER BY next_run_at ASC`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var configs []*backupmodel.BackupConfig
	for rows.Next() {
		c := &backupmodel.BackupConfig{}
		if err := rows.Scan(&c.ID, &c.Name, &c.Enabled, &c.BackupType, &c.FrequencyDays, &c.MaxRetention,
			&c.Provider, &c.ProviderConfig, &c.IncludeTables, &c.Compress, &c.Encrypt,
			&c.LastRunAt, &c.NextRunAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		configs = append(configs, c)
	}
	return configs, rows.Err()
}

func (r *BackupConfigRepo) MarkRun(ctx context.Context, id int64) error {
	query := `UPDATE backup_configs SET last_run_at = NOW(), next_run_at = NOW() + (frequency_days || ' days')::INTERVAL, updated_at = NOW() WHERE id = $1`
	_, err := r.db.Pool.Exec(ctx, query, id)
	return err
}
