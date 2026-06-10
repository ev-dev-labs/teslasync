//
//  EntryDrawer.Previews.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  Xcode previews — one per state the surface produces: content with a UTF-8 payload, content with
//  a non-UTF-8 binary payload (the fallback message), the summary-only "loading full" spinner, the
//  first-load loading / empty / error envelopes, the replay-in-flight + replay-disabled (server
//  flag off) footer variants, and the stale / offline freshness banners. Preview-only; excluded
//  from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentEntryDrawerTelemetry: EntryDrawerTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op clipboard so previews don't touch the system pasteboard.
    private struct SilentEntryDrawerClipboard: EntryDrawerClipboard {
        func copy(_: String) {}
    }

    /// Sample DLQ entries anchored to a fixed clock so the absolute timestamp is deterministic.
    private enum EntryDrawerPreviewData {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        static func summary(replayable: Bool = true) -> EntryDrawerSummary {
            EntryDrawerSummary(
                id: 4821,
                arrivedAt: now.addingTimeInterval(-3600),
                dlqTopic: "telemetry.dlq/5YJ3E1EA7KF000000/v/VehicleSpeed",
                parsedReason: "codec: unknown enum value 99",
                parsedVehicleID: 12,
                parsedVIN: "5YJ3E1EA7KF000000",
                parsedSourceTopic: "telemetry/5YJ3E1EA7KF000000/v/VehicleSpeed",
                parsedRedeliveries: 3,
                parsedTimestamp: now.addingTimeInterval(-3605),
                parseError: nil,
                replayable: replayable,
                rawPayloadSize: 412,
                innerPayloadSize: 128
            )
        }

        static func full(replayable: Bool = true) -> EntryDrawerFull {
            let inner = Data(#"{"field":"VehicleSpeed","value":42.5,"unit":"mps"}"#.utf8)
            let raw = Data(#"{"topic":"telemetry/5YJ.../VehicleSpeed","body":"<protobuf>"}"#.utf8)
            return EntryDrawerFull(
                summary: summary(replayable: replayable),
                rawPayloadBase64: raw.base64EncodedString(),
                innerPayloadBase64: inner.base64EncodedString()
            )
        }

        static func binaryFull() -> EntryDrawerFull {
            let bytes = Data([0xFF, 0xFE, 0xFD, 0x00, 0x01, 0x02, 0x03])
            return EntryDrawerFull(
                summary: summary(),
                rawPayloadBase64: bytes.base64EncodedString(),
                innerPayloadBase64: bytes.base64EncodedString()
            )
        }
    }

    @MainActor
    private func entryDrawerModel(update: EntryDrawerUpdate) -> EntryDrawerModel {
        EntryDrawerModel(
            source: InMemoryEntryDrawerSource(initial: update),
            telemetry: SilentEntryDrawerTelemetry(),
            clipboard: SilentEntryDrawerClipboard(),
            dates: DefaultEntryDrawerDateFormatting(timeZone: TimeZone(identifier: "UTC") ?? .current)
        )
    }

    @MainActor
    private func entryDrawerPreview(update: EntryDrawerUpdate) -> some View {
        EntryDrawer(model: entryDrawerModel(update: update))
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Content · UTF-8") {
        entryDrawerPreview(update: EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerPreviewData.summary(),
            full: EntryDrawerPreviewData.full()
        ))
    }

    #Preview("Content · binary payload") {
        entryDrawerPreview(update: EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerPreviewData.summary(),
            full: EntryDrawerPreviewData.binaryFull()
        ))
    }

    #Preview("Summary only · loading full") {
        entryDrawerPreview(update: EntryDrawerUpdate(
            status: .loading,
            summary: EntryDrawerPreviewData.summary()
        ))
    }

    #Preview("Loading") {
        entryDrawerPreview(update: EntryDrawerUpdate(status: .loading))
    }

    #Preview("Empty") {
        entryDrawerPreview(update: EntryDrawerUpdate(status: .loaded))
    }

    #Preview("Error") {
        entryDrawerPreview(update: EntryDrawerUpdate(status: .failed("Request timed out")))
    }

    #Preview("Replay in flight") {
        entryDrawerPreview(update: EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerPreviewData.summary(),
            full: EntryDrawerPreviewData.full(),
            replayInFlight: true
        ))
    }

    #Preview("Replay disabled · server off") {
        entryDrawerPreview(update: EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerPreviewData.summary(),
            full: EntryDrawerPreviewData.full(),
            replayEnabled: false
        ))
    }

    #Preview("Stale") {
        entryDrawerPreview(update: EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerPreviewData.summary(),
            full: EntryDrawerPreviewData.full(),
            connection: .stale
        ))
    }

    #Preview("Offline") {
        entryDrawerPreview(update: EntryDrawerUpdate(
            status: .loaded,
            summary: EntryDrawerPreviewData.summary(),
            full: EntryDrawerPreviewData.full(),
            connection: .offline
        ))
    }
#endif
