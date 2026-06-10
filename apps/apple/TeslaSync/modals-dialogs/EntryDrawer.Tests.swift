//
//  EntryDrawer.Tests.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  Adapter + accessibility coverage for the EntryDrawer surface:
//    • `EntryDrawerTab` — id, label key + fallback.
//    • `EntryDrawerPayloadDecoder` — the faithful `decodeBase64Utf8` port (empty / valid UTF-8 /
//      valid base64 but non-UTF-8 / malformed base64 arms).
//    • `EntryDrawerIntFormatter` — the grouped `fmtInt` port.
//    • `EntryDrawerProjection` — the title, the KVList rows (em-dash fallbacks + grouped
//      redeliveries + absolute timestamp + monospace / muted flags), the `<pre>` display text +
//      binary fallback, the copy text fallback, the body phase matrix, the inline-failure
//      envelope, and the four-gate replay-disabled rule.
//    • `EntryDrawerAccessibility` — the dialog / close / replay / payload / copy VoiceOver content.
//
//  The state-holder coverage lives in EntryDrawer.ModelTests.swift. Pure, bundle-free: copy
//  resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum EntryDrawerSampleEntries {
    static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    static func summary(
        vin: String? = "5YJ3E1EA7KF000000",
        sourceTopic: String? = "telemetry/5YJ/v/VehicleSpeed",
        redeliveries: Int? = 3,
        parseError: String? = nil,
        replayable: Bool = true
    ) -> EntryDrawerSummary {
        EntryDrawerSummary(
            id: 4821,
            arrivedAt: anchor,
            dlqTopic: "telemetry.dlq/5YJ/v/VehicleSpeed",
            parsedReason: "codec: unknown enum value 99",
            parsedVehicleID: 12,
            parsedVIN: vin,
            parsedSourceTopic: sourceTopic,
            parsedRedeliveries: redeliveries,
            parsedTimestamp: anchor,
            parseError: parseError,
            replayable: replayable,
            rawPayloadSize: 412,
            innerPayloadSize: 128
        )
    }
}

final class EntryDrawerAdapterTests: XCTestCase {
    // MARK: Tab

    func testTabLabelKeysAndFallbacks() {
        XCTAssertEqual(EntryDrawerTab.inner.id, "inner")
        XCTAssertEqual(EntryDrawerTab.inner.labelKey, "admin.dlq.drawer.tabs.inner")
        XCTAssertEqual(EntryDrawerTab.inner.labelFallback, "Inner payload")
        XCTAssertEqual(EntryDrawerTab.raw.labelKey, "admin.dlq.drawer.tabs.raw")
        XCTAssertEqual(EntryDrawerTab.raw.labelFallback, "Raw envelope")
    }

    // MARK: Decoder

    func testDecoderEmptyInput() {
        XCTAssertEqual(EntryDrawerPayloadDecoder.decodeUTF8(""), "")
    }

    func testDecoderValidUTF8() {
        let base64 = Data("hello".utf8).base64EncodedString()
        XCTAssertEqual(EntryDrawerPayloadDecoder.decodeUTF8(base64), "hello")
    }

    func testDecoderValidBase64ButNonUTF8ReturnsEmpty() {
        let base64 = Data([0xFF, 0xFE]).base64EncodedString()
        XCTAssertEqual(EntryDrawerPayloadDecoder.decodeUTF8(base64), "")
    }

    func testDecoderMalformedBase64ReturnsEmpty() {
        XCTAssertEqual(EntryDrawerPayloadDecoder.decodeUTF8("!!!not-base64!!!"), "")
    }

    // MARK: Int formatter

    func testIntFormatterGroups() {
        XCTAssertEqual(EntryDrawerIntFormatter.grouped(12345), "12,345")
        XCTAssertEqual(EntryDrawerIntFormatter.grouped(3), "3")
        XCTAssertEqual(EntryDrawerIntFormatter.grouped(0), "0")
        XCTAssertEqual(EntryDrawerIntFormatter.grouped(1_000_000), "1,000,000")
    }

    // MARK: Title

    func testTitleWithAndWithoutHead() {
        XCTAssertEqual(
            EntryDrawerProjection.title(hasHead: true, id: 42, localize: passthroughLocalize),
            "DLQ entry #42"
        )
        XCTAssertEqual(
            EntryDrawerProjection.title(hasHead: false, id: 42, localize: passthroughLocalize),
            "DLQ entry"
        )
    }

    // MARK: Rows

    func testRowsOrderLabelsAndValues() {
        let rows = EntryDrawerProjection.rows(
            for: EntryDrawerSampleEntries.summary(),
            localize: passthroughLocalize,
            absolute: { "ABS:\(Int($0.timeIntervalSince1970))" }
        )
        XCTAssertEqual(rows.map(\.key), [
            "id", "arrivedAt", "dlqTopic", "reason", "vin", "sourceTopic", "redeliveries", "parseError"
        ])
        XCTAssertEqual(rows.map(\.label), [
            "ID", "Arrived", "DLQ topic", "Reason", "VIN", "Source topic", "Redeliveries", "Parse error"
        ])
        XCTAssertEqual(rows.first { $0.key == "id" }?.value, "4821")
        XCTAssertEqual(rows.first { $0.key == "arrivedAt" }?.value, "ABS:1717000000")
        XCTAssertEqual(rows.first { $0.key == "redeliveries" }?.value, "3")
    }

    func testRowsEmDashFallbacks() {
        let rows = EntryDrawerProjection.rows(
            for: EntryDrawerSampleEntries.summary(vin: nil, sourceTopic: nil, redeliveries: nil, parseError: ""),
            localize: passthroughLocalize,
            absolute: { _ in "ABS" }
        )
        XCTAssertEqual(rows.first { $0.key == "vin" }?.value, "—")
        XCTAssertEqual(rows.first { $0.key == "sourceTopic" }?.value, "—")
        XCTAssertEqual(rows.first { $0.key == "redeliveries" }?.value, "—")
        XCTAssertEqual(rows.first { $0.key == "parseError" }?.value, "—")
    }

    func testRowsFlags() {
        let rows = EntryDrawerProjection.rows(
            for: EntryDrawerSampleEntries.summary(),
            localize: passthroughLocalize,
            absolute: { _ in "ABS" }
        )
        XCTAssertTrue(rows.first { $0.key == "id" }?.monospace == true)
        XCTAssertTrue(rows.first { $0.key == "dlqTopic" }?.monospace == true)
        XCTAssertTrue(rows.first { $0.key == "arrivedAt" }?.monospace == false)
        XCTAssertTrue(rows.first { $0.key == "parseError" }?.muted == true)
    }

    // MARK: Display + copy text

    func testDisplayTextDecodedWins() {
        XCTAssertEqual(
            EntryDrawerProjection.displayText(
                tab: .inner, decoded: "{json}", byteSize: 99, localize: passthroughLocalize
            ),
            "{json}"
        )
    }

    func testDisplayTextBinaryFallbackPerTab() {
        let inner = EntryDrawerProjection.displayText(
            tab: .inner, decoded: "", byteSize: 128, localize: passthroughLocalize
        )
        XCTAssertTrue(inner.contains("non-UTF-8 binary"))
        XCTAssertTrue(inner.contains("128"))
        let raw = EntryDrawerProjection.displayText(
            tab: .raw, decoded: "", byteSize: 412, localize: passthroughLocalize
        )
        XCTAssertTrue(raw.contains("non-UTF-8 envelope"))
        XCTAssertTrue(raw.contains("412"))
    }

    func testCopyTextFallsBackToBase64() {
        XCTAssertEqual(EntryDrawerProjection.copyText(decoded: "text", base64: "QUJD"), "text")
        XCTAssertEqual(EntryDrawerProjection.copyText(decoded: "", base64: "QUJD"), "QUJD")
        XCTAssertEqual(EntryDrawerProjection.copyText(decoded: "", base64: nil), "")
    }

    // MARK: Phase matrix

    func testResolvePhaseMatrix() {
        XCTAssertEqual(
            EntryDrawerProjection.resolvePhase(status: .loading, hasSummary: false, hasFull: false),
            .loading
        )
        XCTAssertEqual(
            EntryDrawerProjection.resolvePhase(status: .loading, hasSummary: true, hasFull: false),
            .loading
        )
        XCTAssertEqual(
            EntryDrawerProjection.resolvePhase(status: .loading, hasSummary: true, hasFull: true),
            .content
        )
        XCTAssertEqual(
            EntryDrawerProjection.resolvePhase(status: .loaded, hasSummary: true, hasFull: false),
            .content
        )
        XCTAssertEqual(
            EntryDrawerProjection.resolvePhase(status: .loaded, hasSummary: false, hasFull: false),
            .empty
        )
        XCTAssertEqual(
            EntryDrawerProjection.resolvePhase(status: .failed("x"), hasSummary: true, hasFull: false),
            .content
        )
        XCTAssertEqual(
            EntryDrawerProjection.resolvePhase(status: .failed("x"), hasSummary: false, hasFull: false),
            .error("x")
        )
    }

    // MARK: Inline failure + replay disabled

    func testInlineFailureEnvelope() {
        XCTAssertEqual(EntryDrawerProjection.inlineFailure(status: .failed("boom"), hasHead: true), "boom")
        XCTAssertNil(EntryDrawerProjection.inlineFailure(status: .failed("boom"), hasHead: false))
        XCTAssertNil(EntryDrawerProjection.inlineFailure(status: .loaded, hasHead: true))
    }

    func testReplayDisabledGates() {
        XCTAssertFalse(EntryDrawerProjection.replayDisabled(
            replayEnabled: true, replayable: true, replayInFlight: false, loading: false
        ))
        XCTAssertTrue(EntryDrawerProjection.replayDisabled(
            replayEnabled: false, replayable: true, replayInFlight: false, loading: false
        ))
        XCTAssertTrue(EntryDrawerProjection.replayDisabled(
            replayEnabled: true, replayable: false, replayInFlight: false, loading: false
        ))
        XCTAssertTrue(EntryDrawerProjection.replayDisabled(
            replayEnabled: true, replayable: true, replayInFlight: true, loading: false
        ))
        XCTAssertTrue(EntryDrawerProjection.replayDisabled(
            replayEnabled: true, replayable: true, replayInFlight: false, loading: true
        ))
    }

    // MARK: Accessibility

    func testAccessibilitySummaryAndLabels() {
        XCTAssertEqual(
            EntryDrawerAccessibility.summary(hasHead: true, id: 7, localize: passthroughLocalize),
            "DLQ entry #7"
        )
        XCTAssertEqual(
            EntryDrawerAccessibility.summary(hasHead: false, id: 7, localize: passthroughLocalize),
            "DLQ entry"
        )
        XCTAssertEqual(EntryDrawerAccessibility.closeLabel(localize: passthroughLocalize), "Close")
        XCTAssertEqual(EntryDrawerAccessibility.replayLabel(localize: passthroughLocalize), "Replay")
    }

    func testAccessibilityPayloadAndCopyLabels() {
        XCTAssertEqual(
            EntryDrawerAccessibility.payloadLabel(tab: .inner, localize: passthroughLocalize),
            "Inner payload"
        )
        XCTAssertEqual(
            EntryDrawerAccessibility.payloadLabel(tab: .raw, localize: passthroughLocalize),
            "Raw envelope"
        )
        XCTAssertEqual(EntryDrawerAccessibility.copyLabel(copied: false, localize: passthroughLocalize), "Copy")
        XCTAssertEqual(EntryDrawerAccessibility.copyLabel(copied: true, localize: passthroughLocalize), "Copied")
    }
}
