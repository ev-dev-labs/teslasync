package adminobssvc

// Phase-45 / Phase-47/10 — handler-facing type aliases.
//
// These re-exports keep internal/handler/v1 from importing
// internal/database directly (per ADR-009 and TestHandlerV1Thinness).
// The aliases are transparent so the runtime cost is zero and call-
// sites in the service implementation continue to use the original
// database.* identifiers without churn.

import "github.com/ev-dev-labs/teslasync/internal/database"

// OrderBy is the slow-query ordering parameter exposed to the handler.
type OrderBy = database.SlowQueryOrderBy

// Slow-query order-by constants exposed to the handler.
const (
	OrderByMeanTime  = database.OrderByMeanTime
	OrderByCallCount = database.OrderByCalls
	OrderByTotalTime = database.OrderByTotalTime
)

// SlowQuery is the row shape returned by SlowQueries.
type SlowQuery = database.SlowQuery

// VehicleCostReport is the response shape returned by VehicleCost.
type VehicleCostReport = database.VehicleCostReport

// HypertableSize is the row shape returned by DiskForecast.
type HypertableSize = database.HypertableSize
