// Package protomodel hosts the typed model + decoders that bridge Tesla's
// vendored Fleet Telemetry protobuf (api/proto/tesla/vehicle_data.proto) into
// the rest of the TeslaSync ingest pipeline.
//
// Three files in this package are GENERATED from the vendored proto by
// cmd/protogen-tesla and MUST NOT be hand-edited:
//
//   - signal_metadata_gen.go
//   - enum_parsers_gen.go
//   - datum_decoder_gen.go
//
// Regenerate with `go generate ./internal/tesla/protomodel/...` (or
// `make gen-tesla`). CI enforces drift via `make gen-tesla-check`, which is
// invoked by the proto-gen-check workflow on any PR that touches the proto,
// the codegen binary, or the generated files.
package protomodel

//go:generate go run ../../../cmd/protogen-tesla --proto ../../../api/proto/tesla/vehicle_data.proto --out . --package protomodel
