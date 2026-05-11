# models vs domain — quick reference

Per ADR-006 (`.github/ARCHITECTURE.md`).

## Persistence DTO (`internal/models`)

```go
// internal/models/vehicle.go
type Vehicle struct {
    ID          int64    `json:"id" db:"id"`
    DisplayName string   `json:"display_name" db:"display_name"`
    BatteryKwh  *float64 `json:"battery_kwh,omitempty" db:"battery_kwh"`
}

// ToDomain converts the persistence DTO into a pure domain entity.
// Lives in models so the conversion is colocated with the struct
// definition; an alternative is to put FromX helpers in domain.
func (v Vehicle) ToDomain() vehicle.Vehicle {
    return vehicle.Vehicle{ /* ... */ }
}
```

Rules (enforced by `internal/arch/arch_test.go`):

- Every exported field of every exported struct carries `db:"..."` or
  `json:"..."` (or both). `TestModelsHaveStructTags` enforces.
- `internal/models` may NOT import `internal/database`,
  `internal/adapter/*`, `internal/api`, `internal/handler/*`,
  `internal/app/*`, or `internal/port/*`. `TestModelsImportsRestricted`
  enforces.
- Importing `internal/domain/*` is explicitly allowed (for `ToDomain`
  helpers).

## Domain entity (`internal/domain/<bounded-context>`)

```go
// internal/domain/vehicle/vehicle.go
type Vehicle struct {
    ID          int64
    DisplayName string
    BatteryKwh  float64 // domain rejects nil — use Option semantics if needed
}

func (v Vehicle) IsBatteryUsable() bool { return v.BatteryKwh > 5.0 }
```

Rules (enforced by `internal/arch/arch_test.go`):

- May import only stdlib and other `internal/domain/*` subpackages
  (including the parent `internal/domain` package). `TestDomainPurity`
  enforces.
- Persistence and HTTP imports are forbidden (no `internal/database`,
  `internal/adapter/*`, `internal/api`, `internal/handler/*`,
  `internal/app/*`, `internal/port/*`).
- MAY carry `db:`/`json:` tags. Today's domain types do, and that is
  grandfathered. The HARD rule is the import boundary, not tag
  presence. Future types should minimize tags when feasible.

## Use-case boundary

```go
// internal/app/vehiclesvc/get.go
func (s *Service) Get(ctx context.Context, id int64) (vehicle.Vehicle, error) {
    row, err := s.repo.Vehicle(ctx, id)
    if err != nil {
        return vehicle.Vehicle{}, err
    }
    return row.ToDomain(), nil
}
```

The use-case service in `internal/app/<name>svc` is the only place
that may freely import both `internal/models` and
`internal/domain/<name>` and convert between them. Repos return
`models.X`; services convert via `ToDomain` and apply business rules
to the domain entity; HTTP handlers in `internal/handler/v1` see only
domain types (or DTOs from `internal/handler/dto`).

## Why this charter exists

Before ADR-006 the practical split was "models = whatever existed
before, domain = whatever the hexagonal migration added." The
boundary was invisible to contributors and types risked being
duplicated across both packages.

ADR-006 codifies what the audit confirmed is already safe to enforce
today (the import boundary) without requiring a mass rewrite of
existing tag-bearing domain types. Future tightening (e.g. removing
tags from domain) can land as separate prompts.
