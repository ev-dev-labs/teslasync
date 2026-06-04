package tools

import "regexp"

// ReLatLong matches a "lat, long" pair: two signed decimal numbers with at
// least 2 decimal digits each, separated by a comma + optional whitespace.
// Used by image-prompt/share-card PII redactors that need to refuse to
// emit precise GPS coordinates in user-facing media.
//
// Exported so internal/ai/tools/trip and sibling tools can share the
// canonical regex through one entrypoint.
var ReLatLong = regexp.MustCompile(`-?\d{1,3}\.\d{2,},\s*-?\d{1,3}\.\d{2,}`)

// ReStreetAddr matches an obvious "<number> <Word> <Street-type>" English
// US/CA street address. Same PII-redaction use case as ReLatLong.
//
// Exported for the same sharing reason as ReLatLong.
var ReStreetAddr = regexp.MustCompile(`(?i)\b\d{1,6}\s+[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)*\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Highway|Hwy|Parkway|Pkwy)\b`)
