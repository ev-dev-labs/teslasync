//
//  helpers.Tests.swift
//  TeslaSync — P4 feature view · 0245 · helpers (Apple)
//
//  Unit coverage for the status `helpers` surface:
//    • Adapter — the status classification (`kind` / `badgeKind`, including the
//      "connected" colour-success / badge-neutral divergence from the web source),
//      the SF Symbol mapping, and the `formatUptime` / `formatBytes` ports.
//    • State holder — `StatusHelpersProjection` across loading / empty / error / data,
//      plus the `StatusHelpersModel` wiring, the P1/S11 `view.opened` telemetry, and
//      the stale auto-refresh transition.
//    • Accessibility — the VoiceOver legend + metric label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryStatusHelpersSource`, and the locale
//  is injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Classification (web getStatusColor / statusTextClass / getStatusIcon)

@MainActor final class StatusKindTests: XCTestCase {
    func testSuccessTokens() {
        for token in ["healthy", "ok", "online", "connected", "ready", "sent", "completed"] {
            XCTAssertEqual(StatusHelpers.kind(for: token), .success, token)
        }
    }

    func testWarningTokens() {
        for token in ["degraded", "warning", "pending", "queued", "processing"] {
            XCTAssertEqual(StatusHelpers.kind(for: token), .warning, token)
        }
    }

    func testDangerTokens() {
        for token in ["unhealthy", "offline", "error", "down", "failed"] {
            XCTAssertEqual(StatusHelpers.kind(for: token), .danger, token)
        }
    }

    func testUnknownAndEmptyAreNeutral() {
        XCTAssertEqual(StatusHelpers.kind(for: "frobnicating"), .neutral)
        XCTAssertEqual(StatusHelpers.kind(for: ""), .neutral)
    }

    func testClassificationIsCaseInsensitive() {
        XCTAssertEqual(StatusHelpers.kind(for: "HEALTHY"), .success)
        XCTAssertEqual(StatusHelpers.kind(for: "Offline"), .danger)
        XCTAssertEqual(StatusHelpers.kind(for: "QuEuEd"), .warning)
    }

    func testSymbolMapping() {
        XCTAssertEqual(StatusHelpers.symbolName(for: "healthy"), "checkmark.circle.fill")
        XCTAssertEqual(StatusHelpers.symbolName(for: "degraded"), "exclamationmark.triangle.fill")
        XCTAssertEqual(StatusHelpers.symbolName(for: "offline"), "xmark.circle.fill")
        // Web `getStatusIcon` default → AlertTriangle (shared by the neutral group).
        XCTAssertEqual(StatusHelpers.symbolName(for: "unknown"), "exclamationmark.triangle.fill")
    }

    func testDisplayFallbackCapitalisesFirst() {
        XCTAssertEqual(StatusHelpers.displayFallback("queued"), "Queued")
        XCTAssertEqual(StatusHelpers.displayFallback("ok"), "Ok")
        XCTAssertEqual(StatusHelpers.displayFallback(""), "")
    }
}

// MARK: - Badge classification (web statusToBadgeVariant — the "connected" divergence)

@MainActor final class StatusBadgeKindTests: XCTestCase {
    func testBadgeSuccessTokens() {
        for token in ["healthy", "ok", "online", "ready", "sent", "completed"] {
            XCTAssertEqual(StatusHelpers.badgeKind(for: token), .success, token)
        }
    }

    func testBadgeWarningAndDangerMatchKind() {
        for token in ["degraded", "warning", "pending", "queued", "processing"] {
            XCTAssertEqual(StatusHelpers.badgeKind(for: token), .warning, token)
        }
        for token in ["unhealthy", "offline", "error", "down", "failed"] {
            XCTAssertEqual(StatusHelpers.badgeKind(for: token), .danger, token)
        }
    }

    /// The faithful web asymmetry: "connected" is colour/icon-success but badge-neutral.
    func testConnectedIsSuccessForColourButNeutralForBadge() {
        XCTAssertEqual(StatusHelpers.kind(for: "connected"), .success)
        XCTAssertEqual(StatusHelpers.badgeKind(for: "connected"), .neutral)
    }

    func testUnknownIsNeutralBadge() {
        XCTAssertEqual(StatusHelpers.badgeKind(for: "frobnicating"), .neutral)
    }
}

// MARK: - Uptime formatting (port of formatUptime)

@MainActor final class StatusFormatUptimeTests: XCTestCase {
    func testDaysHoursMinutes() {
        XCTAssertEqual(StatusFormat.formatUptime(93784), "1d 2h 3m")
    }

    func testHoursAndMinutesWhenUnderADay() {
        XCTAssertEqual(StatusFormat.formatUptime(7384), "2h 3m")
    }

    func testMinutesOnlyWhenUnderAnHour() {
        XCTAssertEqual(StatusFormat.formatUptime(184), "3m")
        XCTAssertEqual(StatusFormat.formatUptime(0), "0m")
    }

    func testExactDayKeepsZeroedHoursAndMinutes() {
        XCTAssertEqual(StatusFormat.formatUptime(86400), "1d 0h 0m")
    }

    func testNonFiniteAndNegativeClampToZero() {
        XCTAssertEqual(StatusFormat.formatUptime(-5), "0m")
        XCTAssertEqual(StatusFormat.formatUptime(.nan), "0m")
        XCTAssertEqual(StatusFormat.formatUptime(.infinity), "0m")
    }
}

// MARK: - Byte formatting (port of formatBytes)

@MainActor final class StatusFormatBytesTests: XCTestCase {
    func testZeroIsBytes() {
        XCTAssertEqual(StatusFormat.formatBytes(0, locale: enUS), "0 B")
    }

    func testSubKilobyteStaysBytes() {
        XCTAssertEqual(StatusFormat.formatBytes(512, locale: enUS), "512.0 B")
    }

    func testKilobyteScaling() {
        XCTAssertEqual(StatusFormat.formatBytes(1536, locale: enUS), "1.5 KB")
    }

    func testMegaGigaTera() {
        XCTAssertEqual(StatusFormat.formatBytes(1_048_576, locale: enUS), "1.0 MB")
        XCTAssertEqual(StatusFormat.formatBytes(1_073_741_824, locale: enUS), "1.0 GB")
        XCTAssertEqual(StatusFormat.formatBytes(1_099_511_627_776, locale: enUS), "1.0 TB")
    }

    func testExponentClampsAtTerabyte() {
        // 1 PB has no unit in the table — the web would index `undefined`; the port
        // clamps to TB (1 PB = 1024 TB).
        XCTAssertEqual(StatusFormat.formatBytes(1_125_899_906_842_624, locale: enUS), "1,024.0 TB")
    }

    func testNonFiniteAndNegativeAreZeroBytes() {
        XCTAssertEqual(StatusFormat.formatBytes(-1, locale: enUS), "0 B")
        XCTAssertEqual(StatusFormat.formatBytes(.nan, locale: enUS), "0 B")
        XCTAssertEqual(StatusFormat.formatBytes(.infinity, locale: enUS), "0 B")
    }
}

// MARK: - Legend rows (web classification applied per sample)

@MainActor final class StatusHelpersRowsTests: XCTestCase {
    func testRowsCarryKindBadgeAndKey() {
        let rows = StatusHelpersRows.rows(for: ["Healthy", "connected", "boom"])
        XCTAssertEqual(rows.map(\.id), ["0-healthy", "1-connected", "2-boom"])
        XCTAssertEqual(rows[0].kind, .success)
        XCTAssertEqual(rows[0].badgeKind, .success)
        XCTAssertEqual(rows[0].labelKey, "helpers.status.healthy")
        XCTAssertEqual(rows[0].labelFallback, "Healthy")
        // The "connected" divergence flows into the row.
        XCTAssertEqual(rows[1].kind, .success)
        XCTAssertEqual(rows[1].badgeKind, .neutral)
        // Unknown token → neutral, fallback capitalised.
        XCTAssertEqual(rows[2].kind, .neutral)
        XCTAssertEqual(rows[2].labelFallback, "Boom")
    }

    func testEmptySamplesYieldNoRows() {
        XCTAssertTrue(StatusHelpersRows.rows(for: []).isEmpty)
    }
}

// MARK: - Projection (P4 leaf contract)

@MainActor final class StatusHelpersProjectionTests: XCTestCase {
    private let samples = ["healthy", "offline"]

    func testErrorTakesPrecedence() {
        let resolved = StatusHelpersProjection.resolve(
            StatusHelpersInput(samples: samples, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = StatusHelpersProjection.resolve(StatusHelpersInput(samples: samples, isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNothingToShow() {
        XCTAssertEqual(StatusHelpersProjection.resolve(StatusHelpersInput()).phase, .empty)
    }

    func testDataWhenSamplesPresent() {
        let resolved = StatusHelpersProjection.resolve(StatusHelpersInput(samples: samples))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.legend.count, 2)
        XCTAssertFalse(resolved.hasFormatting)
    }

    func testDataWhenOnlyFormattingPresent() {
        let resolved = StatusHelpersProjection.resolve(StatusHelpersInput(uptimeSeconds: 60))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertTrue(resolved.legend.isEmpty)
        XCTAssertTrue(resolved.hasFormatting)
    }

    func testResolvedCarriesRawNumbers() {
        let resolved = StatusHelpersProjection.resolve(
            StatusHelpersInput(samples: samples, uptimeSeconds: 93784, byteCount: 1536)
        )
        XCTAssertEqual(resolved.uptimeSeconds, 93784)
        XCTAssertEqual(resolved.byteCount, 1536)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class StatusHelpersModelTests: XCTestCase {
    private func makeModel(
        _ input: StatusHelpersInput,
        telemetry: StatusHelpersTelemetry = OSLogStatusHelpersTelemetry()
    ) -> (StatusHelpersModel, InMemoryStatusHelpersSource) {
        let source = InMemoryStatusHelpersSource(initial: input)
        let model = StatusHelpersModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: StatusHelpersInput {
        StatusHelpersInput(samples: ["healthy", "offline"], uptimeSeconds: 93784, byteCount: 1536)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyStatusHelpersTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.legend.count, 2)
        XCTAssertEqual(spy.surfaces, [StatusHelpersPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(StatusHelpersInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(StatusHelpersInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(StatusHelpersInput(samples: ["healthy"], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(StatusHelpersInput(samples: ["healthy"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(StatusHelpersInput(samples: ["healthy"], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(StatusHelpersPanel.surfaceSlug, "helpers")
    }
}

// MARK: - Accessibility summary content

@MainActor final class StatusHelpersAccessibilityTests: XCTestCase {
    func testLegendRowLabelJoinsParts() {
        XCTAssertEqual(
            StatusHelpersAccessibility.legendRowLabel(status: "Connected", variant: "Unknown"),
            "Connected, Unknown"
        )
    }

    func testMetricLabelJoinsParts() {
        XCTAssertEqual(
            StatusHelpersAccessibility.metricLabel(label: "Uptime", value: "1d 2h 3m"),
            "Uptime: 1d 2h 3m"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyStatusHelpersTelemetry: StatusHelpersTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
