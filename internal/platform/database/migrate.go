package database

import (
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/rs/zerolog/log"
)

// Migrate applies pending database migrations.
func (db *DB) Migrate(migrationsPath string) error {
	connStr := db.Pool.Config().ConnConfig.ConnString()
	return RunMigrations(connStr, migrationsPath)
}

// RunMigrations applies all pending migrations from the given source path.
func RunMigrations(connStr, migrationsPath string) error {
	m, err := migrate.New(migrationsPath, connStr)
	if err != nil {
		return fmt.Errorf("creating migrate instance: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("running migrations: %w", err)
	}

	version, dirty, _ := m.Version()
	log.Info().Uint("version", version).Bool("dirty", dirty).Msg("migrations applied")
	return nil
}
