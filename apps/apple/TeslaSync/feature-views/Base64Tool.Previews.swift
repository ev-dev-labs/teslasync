//
//  Base64Tool.Previews.swift
//  TeslaSync — P4 feature view · 0011 · Base64Tool (Apple)
//
//  Xcode previews — one per state the web source produces (empty, encoded
//  content, decoded content, invalid) plus the decode-mode entry point. Preview-
//  only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentBase64Telemetry: Base64ToolTelemetry {
        func viewOpened(surface _: String) {}
    }

    #Preview("Empty · encode") {
        Base64Tool(model: Base64ToolModel(mode: .encode, input: "", telemetry: SilentBase64Telemetry()))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Content · encode") {
        Base64Tool(model: Base64ToolModel(mode: .encode, input: "Hello World", telemetry: SilentBase64Telemetry()))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Content · decode") {
        Base64Tool(
            model: Base64ToolModel(mode: .decode, input: "SGVsbG8gV29ybGQ=", telemetry: SilentBase64Telemetry())
        )
        .padding()
        .frame(maxWidth: 420)
    }

    #Preview("Invalid · decode") {
        Base64Tool(
            model: Base64ToolModel(mode: .decode, input: "!!! not base64 !!!", telemetry: SilentBase64Telemetry())
        )
        .padding()
        .frame(maxWidth: 420)
    }

    #Preview("Empty · decode") {
        Base64Tool(model: Base64ToolModel(mode: .decode, input: "", telemetry: SilentBase64Telemetry()))
            .padding()
            .frame(maxWidth: 420)
    }
#endif
