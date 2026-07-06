package backup

import "errors"

// Sentinel errors shared by BackupConfigRepo and BackupRunRepo.
//
// Repo methods return these (never panic) so callers can branch with
// errors.Is. ErrRepoNotConfigured is returned whenever a method is
// invoked on a repo whose underlying pool was never wired (nil *database.DB
// or a DB with a nil Pool) — the constructors leave the querier nil in
// that case rather than dereferencing it at call time.
var (
	// ErrRepoNotConfigured is returned by any pool-touching method when
	// the repo has no usable querier (nil DB / nil pool).
	ErrRepoNotConfigured = errors.New("backup: repository not configured")

	// ErrNilConfig is returned by Create/Update when the supplied
	// *BackupConfig is nil, guarding the c.Enabled dereference.
	ErrNilConfig = errors.New("backup: config must not be nil")

	// ErrNilRun is returned by BackupRunRepo.Create when the supplied
	// *BackupRun is nil.
	ErrNilRun = errors.New("backup: run must not be nil")

	// ErrInvalidRetention is returned by CleanupOld when keepN <= 0.
	// A non-positive keep count would delete every row for the config
	// (the retention subquery keeps LIMIT keepN rows), so it is refused
	// rather than silently wiping history.
	ErrInvalidRetention = errors.New("backup: retention count must be positive")
)
