// Package summary contains AI tools that summarize recent system data windows.
//
// Each tool receives a scoped time range or identifier from middleware, reads
// typed envelopes from signal_log, logs, FSM traces, or changelog data, and lets
// the LLM narrate those envelopes. Callers may alias this package as
// summaryaitools when importing it alongside similarly named packages.
//
// Layer: domain
package summary
