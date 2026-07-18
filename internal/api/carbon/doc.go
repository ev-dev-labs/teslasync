// Package carbon serves the Carbon Intelligence endpoints: grid-aware CO2
// accounting for charging. It attributes a real CO2 footprint to each charging
// session from the hour it charged (grid carbon intensity varies across the
// day), tracks lifetime CO2 saved versus an equivalent gasoline car, scores how
// green the charging timing is, and recommends the greenest charging window.
//
// The CO2 arithmetic, green-score, and greenest-window selection are PURE,
// deterministic functions in carbon.go with table-driven tests; the handler
// only parses/validates requests, reads the pgx pool, folds rows through the
// pure core, and writes snake_case JSON. The diurnal grid model is a seeded,
// admin-editable table (migrations/000217_grid_carbon_intensity) so the feature
// works self-hosted with no external grid-intensity API.
//
// Layer: handler
package carbon
