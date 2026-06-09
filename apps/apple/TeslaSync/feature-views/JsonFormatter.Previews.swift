//
//  JsonFormatter.Previews.swift
//  TeslaSync — P4 feature view · 0017 · JsonFormatter (Apple)
//
//  Xcode previews — one per state the web source produces (empty, formatted,
//  invalid) plus a deep-nested formatted sample. Preview-only; excluded from release
//  builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentJsonFormatterTelemetry: JsonFormatterTelemetry {
        func viewOpened(surface _: String) {}
    }

    #Preview("Empty") {
        JsonFormatter(model: JsonFormatterModel(input: "", telemetry: SilentJsonFormatterTelemetry()))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Formatted") {
        JsonFormatter(
            model: JsonFormatterModel(
                input: "{\"key\":\"value\",\"count\":3}",
                telemetry: SilentJsonFormatterTelemetry()
            )
        )
        .padding()
        .frame(maxWidth: 420)
    }

    #Preview("Formatted · nested") {
        JsonFormatter(
            model: JsonFormatterModel(
                input: "{\"vehicle\":{\"vin\":\"5YJ\",\"soc\":0.82},\"trips\":[{\"d\":12.5},{\"d\":4}]}",
                telemetry: SilentJsonFormatterTelemetry()
            )
        )
        .padding()
        .frame(maxWidth: 420)
    }

    #Preview("Invalid") {
        JsonFormatter(
            model: JsonFormatterModel(
                input: "{\"key\": value}",
                telemetry: SilentJsonFormatterTelemetry()
            )
        )
        .padding()
        .frame(maxWidth: 420)
    }
#endif
