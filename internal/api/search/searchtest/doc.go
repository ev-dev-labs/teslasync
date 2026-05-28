// Package searchtest provides exported test helpers (an in-memory
// FakeSearcher implementing search.Searcher) for unit tests of any
// consumer that depends on the canonical search backend without
// wanting a live pgx connection.
//
// # Layer
//
// Layer: platform
//
// # Why a non-_test subpackage
//
// Go forbids importing a *_test.go file from outside its package.
// Once internal/api/search was carved out of the flat internal/api
// parent in Phase R2d.1, the original `fakeSearcher` declared
// inside search/handler_test.go was no longer reachable from the
// AI hydrator tests still in internal/api/. searchtest is the
// smallest-blast-radius fix: a tiny non-_test subpackage that
// exports the same fake under a capitalised name so any consumer
// test in internal/api/* (and any future module) can import it.
//
// Implementation lives in fake.go; this file is doc-only to keep
// the arch baseline (TestEveryInternalPackageHasDocGoWithLayer)
// happy.
package searchtest
