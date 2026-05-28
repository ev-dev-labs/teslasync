// Phase-R / R6.14 — ptrString test helper for the parent tools package.
//
// ptrString was originally defined in auto_trip_naming_test.go but
// charge_curve_clustering_test.go also depends on it. When the trip
// cluster moved out, this single-line helper had to stay behind for
// the parent test file. A future internal/ai/tools/toolstest exported
// fixture package (deferred per Lesson 6 R6.7) will fold this in.

package tools

func ptrString(s string) *string { return &s }
