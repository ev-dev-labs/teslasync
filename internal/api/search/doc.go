// Package search hosts GET /api/v1/search for the SPA omnibar and AI citation
// hydrators.
//
// # Layer
//
// Layer: handler
//
// Carved from the flat internal/api parent in Phase R2d.1. The package owns the
// handler, Searcher port, SearchHit envelope, ranking helpers, and PGSearcher;
// AI hydrators import this package one-way so typed search and citations share
// one SQL fan-out (ADR-015 §I3).
package search
