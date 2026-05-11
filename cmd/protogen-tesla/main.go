// Command protogen-tesla generates the deterministic Go bindings for the
// Tesla Fleet Telemetry vehicle_data.proto vendored under api/proto/tesla/.
//
// It produces three files into the target package directory:
//
//	signal_metadata_gen.go   Field enum, SignalMeta, SignalMetaByField, ParseField
//	enum_parsers_gen.go      every other named enum + Parse<Name>
//	datum_decoder_gen.go     compound message types, Value, Datum, Payload, DecodeValue
//
// The emitter is byte-stable: running it twice on the same input proto MUST
// produce identical output bytes. This invariant is enforced by the unit
// test in main_test.go and (in CI) by a drift gate that re-runs codegen and
// fails on any diff against the committed *_gen.go files.
//
// Usage:
//
//	protogen-tesla [--proto api/proto/tesla/vehicle_data.proto] [--out internal/tesla/protomodel] [--package protomodel] [--only signal_metadata|enum_parsers|datum_decoder]
//
// All flags have sane defaults; the binary is intended to be invoked from a
// `go generate` directive at internal/tesla/protomodel/doc.go. The --only
// flag is a transitional helper used by the phase-42 prompts that land
// each generated file in isolation; once every file has been claimed,
// callers should drop --only and let Emit produce all three.
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "protogen-tesla:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("protogen-tesla", flag.ContinueOnError)
	protoPath := fs.String("proto", "api/proto/tesla/vehicle_data.proto", "Path to the input vendored proto file.")
	outDir := fs.String("out", "internal/tesla/protomodel", "Directory to write the generated *_gen.go files.")
	pkgName := fs.String("package", "protomodel", "Go package name for the emitted files.")
	only := fs.String("only", "", "If set, emit only the named file. One of: signal_metadata, enum_parsers, datum_decoder. Default emits all three.")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *protoPath == "" {
		return fmt.Errorf("--proto must not be empty")
	}
	if *outDir == "" {
		return fmt.Errorf("--out must not be empty")
	}
	if *pkgName == "" {
		return fmt.Errorf("--package must not be empty")
	}
	pf, err := ParseProtoFile(*protoPath)
	if err != nil {
		return err
	}
	if err := EmitFiltered(pf, *pkgName, *outDir, *only); err != nil {
		return err
	}
	switch *only {
	case "":
		fmt.Fprintf(os.Stderr, "protogen-tesla: emitted %s, %s, %s into %s\n",
			fileSignalMetadata, fileEnumParsers, fileDatumDecoder, *outDir)
	case "signal_metadata":
		fmt.Fprintf(os.Stderr, "protogen-tesla: emitted %s into %s\n", fileSignalMetadata, *outDir)
	case "enum_parsers":
		fmt.Fprintf(os.Stderr, "protogen-tesla: emitted %s into %s\n", fileEnumParsers, *outDir)
	case "datum_decoder":
		fmt.Fprintf(os.Stderr, "protogen-tesla: emitted %s into %s\n", fileDatumDecoder, *outDir)
	}
	return nil
}
