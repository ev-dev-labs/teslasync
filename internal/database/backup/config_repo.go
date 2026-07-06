package backup

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"
)

// BackupConfigRepo persists user-configured backup schedules.
//
// It holds a database.DBTX querier rather than the concrete pool so the
// same code path is exercised by unit tests (which inject an in-memory
// fake) and production (which injects *database.DB's pool). The querier
// is nil when the repo was constructed without a usable pool; every
// pool-touching method guards on ready() and returns ErrRepoNotConfigured
// instead of panicking.
type BackupConfigRepo struct {
	q database.DBTX
}

// NewBackupConfigRepo wires the repo to db's connection pool. A nil db,
// or a db with a nil Pool, yields a repo whose methods return
// ErrRepoNotConfigured — this keeps construction infallible while making
// misuse observable rather than a nil-pointer panic.
func NewBackupConfigRepo(db *database.DB) *BackupConfigRepo {
	var q database.DBTX
	if db != nil && db.Pool != nil {
		q = db.Pool
	}
	return &BackupConfigRepo{q: q}
}

// ready reports whether the repo has a usable querier.
func (r *BackupConfigRepo) ready() error {
	if r == nil || r.q == nil {
		return ErrRepoNotConfigured
	}
	return nil
}

func (r *BackupConfigRepo) Create(ctx context.Context, c *backupmodel.BackupConfig) error {
	if c == nil {
		return ErrNilConfig
	}
	if err := r.ready(); err != nil {
		return err
	}
	const query = `INSERT INTO backup_configs (name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, next_run_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, created_at, updated_at`
	var nextRun *time.Time
	if c.Enabled {
		t := time.Now().UTC().Add(time.Duration(c.FrequencyDays) * 24 * time.Hour)
		nextRun = &t
	}
	if err := r.q.QueryRow(ctx, query,
		c.Name, c.Enabled, c.BackupType, c.FrequencyDays, c.MaxRetention,
		c.Provider, c.ProviderConfig, c.IncludeTables, c.Compress, c.Encrypt, nextRun,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return fmt.Errorf("backup config create: %w", err)
	}
	return nil
}

func (r *BackupConfigRepo) GetByID(ctx context.Context, id int64) (*backupmodel.BackupConfig, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `SELECT id, name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, last_run_at, next_run_at, created_at, updated_at
		FROM backup_configs WHERE id = $1`
	c := &backupmodel.BackupConfig{}
	if err := r.q.QueryRow(ctx, query, id).Scan(
		&c.ID, &c.Name, &c.Enabled, &c.BackupType, &c.FrequencyDays, &c.MaxRetention,
		&c.Provider, &c.ProviderConfig, &c.IncludeTables, &c.Compress, &c.Encrypt,
		&c.LastRunAt, &c.NextRunAt, &c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("backup config get %d: %w", id, err)
	}
	return c, nil
}

func (r *BackupConfigRepo) List(ctx context.Context) ([]*backupmodel.BackupConfig, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `SELECT id, name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, last_run_at, next_run_at, created_at, updated_at
		FROM backup_configs ORDER BY created_at DESC`
	rows, err := r.q.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("backup config list: %w", err)
	}
	defer rows.Close()
	var configs []*backupmodel.BackupConfig
	for rows.Next() {
		c := &backupmodel.BackupConfig{}
		if err := rows.Scan(&c.ID, &c.Name, &c.Enabled, &c.BackupType, &c.FrequencyDays, &c.MaxRetention,
			&c.Provider, &c.ProviderConfig, &c.IncludeTables, &c.Compress, &c.Encrypt,
			&c.LastRunAt, &c.NextRunAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("backup config list scan: %w", err)
		}
		configs = append(configs, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("backup config list rows: %w", err)
	}
	return configs, nil
}

func (r *BackupConfigRepo) Update(ctx context.Context, c *backupmodel.BackupConfig) error {
	if c == nil {
		return ErrNilConfig
	}
	if err := r.ready(); err != nil {
		return err
	}
	const query = `UPDATE backup_configs SET name=$2, enabled=$3, backup_type=$4, frequency_days=$5, max_retention=$6, provider=$7, provider_config=$8, include_tables=$9, compress=$10, encrypt=$11, next_run_at=$12, updated_at=NOW()
		WHERE id=$1`
	var nextRun *time.Time
	if c.Enabled {
		t := time.Now().UTC().Add(time.Duration(c.FrequencyDays) * 24 * time.Hour)
		nextRun = &t
	}
	if _, err := r.q.Exec(ctx, query, c.ID, c.Name, c.Enabled, c.BackupType, c.FrequencyDays, c.MaxRetention,
		c.Provider, c.ProviderConfig, c.IncludeTables, c.Compress, c.Encrypt, nextRun); err != nil {
		return fmt.Errorf("backup config update %d: %w", c.ID, err)
	}
	return nil
}

func (r *BackupConfigRepo) Delete(ctx context.Context, id int64) error {
	if err := r.ready(); err != nil {
		return err
	}
	if _, err := r.q.Exec(ctx, `DELETE FROM backup_configs WHERE id = $1`, id); err != nil {
		return fmt.Errorf("backup config delete %d: %w", id, err)
	}
	return nil
}

func (r *BackupConfigRepo) GetDueConfigs(ctx context.Context) ([]*backupmodel.BackupConfig, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `SELECT id, name, enabled, backup_type, frequency_days, max_retention, provider, provider_config, include_tables, compress, encrypt, last_run_at, next_run_at, created_at, updated_at
		FROM backup_configs WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= NOW())
		ORDER BY next_run_at ASC`
	rows, err := r.q.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("backup config due: %w", err)
	}
	defer rows.Close()
	var configs []*backupmodel.BackupConfig
	for rows.Next() {
		c := &backupmodel.BackupConfig{}
		if err := rows.Scan(&c.ID, &c.Name, &c.Enabled, &c.BackupType, &c.FrequencyDays, &c.MaxRetention,
			&c.Provider, &c.ProviderConfig, &c.IncludeTables, &c.Compress, &c.Encrypt,
			&c.LastRunAt, &c.NextRunAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("backup config due scan: %w", err)
		}
		configs = append(configs, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("backup config due rows: %w", err)
	}
	return configs, nil
}

func (r *BackupConfigRepo) MarkRun(ctx context.Context, id int64) error {
	if err := r.ready(); err != nil {
		return err
	}
	const query = `UPDATE backup_configs SET last_run_at = NOW(), next_run_at = NOW() + (frequency_days || ' days')::INTERVAL, updated_at = NOW() WHERE id = $1`
	if _, err := r.q.Exec(ctx, query, id); err != nil {
		return fmt.Errorf("backup config mark run %d: %w", id, err)
	}
	return nil
}
