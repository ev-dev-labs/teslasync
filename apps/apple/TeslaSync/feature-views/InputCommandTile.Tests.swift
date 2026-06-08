//
//  InputCommandTile.Tests.swift
//  TeslaSync — P4 feature view · 0232 · InputCommandTile (Apple)
//
//  Unit coverage for the InputCommandTile surface:
//    • Adapter — the ✓/✗ last-status parsing (port of the web
//      `lastStatus.startsWith('✓')` convention), the variant → accent mapping, the
//      sublabel presence rule, and the VoiceOver summaries.
//    • State holder — `InputCommandTileProjection` across loading / empty / error /
//      data and the interactivity gate, plus the `InputCommandTileModel` wiring, the
//      P1/S11 `view.opened` telemetry, the favorite + request-dialog actions, and
//      the stale auto-refresh transition.
//    • Accessibility — the spoken tile + status label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryInputCommandSource`.
//

import XCTest
@testable import TeslaSync

private func sampleDef(
    id: String = "set_speed_limit",
    variant: InputCommandTileCommandTileVariant = .danger,
    sublabelFallback: String? = "Set MPH"
) -> InputCommandTileCommandTileDef {
    InputCommandTileCommandTileDef(
        id: id,
        command: id,
        labelKey: "commands.security.speedLimit",
        labelFallback: "Speed Limit",
        sublabelKey: sublabelFallback == nil ? nil : "commands.security.setMph",
        sublabelFallback: sublabelFallback,
        systemImage: "speedometer",
        variant: variant
    )
}

// MARK: - Last-result status parsing (web `lastStatus` ✓/✗)

@MainActor
final class CommandTileStatusTests: XCTestCase {
    func testSuccessMarkerParsesAndStrips() {
        let status = CommandTileStatus.parse("✓ 2m ago")
        XCTAssertEqual(status?.outcome, .success)
        XCTAssertEqual(status?.detail, "2m ago")
    }

    func testFailureMarkerParsesAndStrips() {
        let status = CommandTileStatus.parse("✗ just now")
        XCTAssertEqual(status?.outcome, .failure)
        XCTAssertEqual(status?.detail, "just now")
    }

    func testNonMarkerTreatedAsFailure() {
        let status = CommandTileStatus.parse("error 500")
        XCTAssertEqual(status?.outcome, .failure)
        XCTAssertEqual(status?.detail, "error 500")
    }

    func testNilAndEmptyYieldNoStatus() {
        XCTAssertNil(CommandTileStatus.parse(nil))
        XCTAssertNil(CommandTileStatus.parse(""))
        XCTAssertNil(CommandTileStatus.parse("   "))
    }

    func testDisplayTextReconstructsMarker() {
        XCTAssertEqual(CommandTileStatus(outcome: .success, detail: "2m ago").displayText, "✓ 2m ago")
        XCTAssertEqual(CommandTileStatus(outcome: .failure, detail: "now").displayText, "✗ now")
        XCTAssertEqual(CommandTileStatus(outcome: .success, detail: "").displayText, "✓")
    }
}

// MARK: - Variant → accent + raw value parity

@MainActor
final class CommandTileVariantTests: XCTestCase {
    func testAccentMapping() {
        XCTAssertEqual(InputCommandTileCommandTileVariant.standard.accent, .neutral)
        XCTAssertEqual(InputCommandTileCommandTileVariant.danger.accent, .danger)
        XCTAssertEqual(InputCommandTileCommandTileVariant.success.accent, .success)
    }

    func testRawValuePreservesWebWireString() {
        XCTAssertEqual(InputCommandTileCommandTileVariant.standard.rawValue, "default")
        XCTAssertEqual(InputCommandTileCommandTileVariant(rawValue: "default"), .standard)
    }
}

// MARK: - Sublabel presence (web `def.sublabelFallback && …`)

@MainActor
final class CommandTileDefTests: XCTestCase {
    func testHasSublabelWhenFallbackPresent() {
        XCTAssertTrue(sampleDef(sublabelFallback: "Set MPH").hasSublabel)
    }

    func testNoSublabelWhenNilOrEmpty() {
        XCTAssertFalse(sampleDef(sublabelFallback: nil).hasSublabel)
        XCTAssertFalse(sampleDef(sublabelFallback: "").hasSublabel)
    }
}

// MARK: - Accessibility summaries

@MainActor
final class CommandTileAccessibilityTests: XCTestCase {
    func testTileLabelJoinsLabelAndSublabel() {
        XCTAssertEqual(
            InputCommandTileCommandTileAccessibility.tileLabel(label: "Speed Limit", sublabel: "Set MPH"),
            "Speed Limit, Set MPH"
        )
    }

    func testTileLabelOmitsMissingSublabel() {
        XCTAssertEqual(InputCommandTileCommandTileAccessibility.tileLabel(label: "Wake Up", sublabel: nil), "Wake Up")
        XCTAssertEqual(InputCommandTileCommandTileAccessibility.tileLabel(label: "Wake Up", sublabel: ""), "Wake Up")
    }

    func testStatusLabelJoinsWordingAndDetail() {
        XCTAssertEqual(
            InputCommandTileCommandTileAccessibility.statusLabel(outcomeWording: "Last result succeeded", detail: "2m ago"),
            "Last result succeeded 2m ago"
        )
        XCTAssertEqual(
            InputCommandTileCommandTileAccessibility.statusLabel(outcomeWording: "Last result failed", detail: ""),
            "Last result failed"
        )
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor
final class InputCommandTileProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = InputCommandTileProjection.resolve(
            InputCommandTileInput(def: sampleDef(), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertFalse(resolved.isInteractive)
    }

    func testLoadingWhenFlagged() {
        let resolved = InputCommandTileProjection.resolve(InputCommandTileInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertFalse(resolved.isInteractive)
    }

    func testEmptyWhenNoDefBound() {
        let resolved = InputCommandTileProjection.resolve(InputCommandTileInput(def: nil))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testDataResolvesAccentStatusAndInteractivity() {
        let resolved = InputCommandTileProjection.resolve(
            InputCommandTileInput(def: sampleDef(variant: .danger), lastStatusRaw: "✓ 1m ago", isFavorite: true)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.accent, .danger)
        XCTAssertEqual(resolved.status?.outcome, .success)
        XCTAssertTrue(resolved.isFavorite)
        XCTAssertTrue(resolved.isInteractive)
    }

    func testExecutingBlocksInteractivity() {
        let resolved = InputCommandTileProjection.resolve(
            InputCommandTileInput(def: sampleDef(), isExecuting: true)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertTrue(resolved.isExecuting)
        XCTAssertFalse(resolved.isInteractive)
    }

    func testOfflineBlocksInteractivity() {
        let resolved = InputCommandTileProjection.resolve(
            InputCommandTileInput(def: sampleDef(), connection: .offline)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertFalse(resolved.isInteractive)
    }

    func testNeutralAccentWhenNoDef() {
        let resolved = InputCommandTileProjection.resolve(InputCommandTileInput(isLoading: true))
        XCTAssertEqual(resolved.accent, .neutral)
    }
}

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor
final class InputCommandTileModelTests: XCTestCase {
    private func makeModel(
        _ input: InputCommandTileInput,
        telemetry: InputCommandTelemetry = OSLogInputCommandTelemetry()
    ) -> (InputCommandTileModel, InMemoryInputCommandSource) {
        let source = InMemoryInputCommandSource(initial: input)
        let model = InputCommandTileModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: InputCommandTileInput {
        InputCommandTileInput(def: sampleDef())
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyInputCommandTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(spy.surfaces, [InputCommandTile.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(InputCommandTileInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testRequestDialogDelegatesWhenInteractive() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.requestDialog()
        XCTAssertEqual(source.dialogCount, 1)
    }

    func testRequestDialogInertWhileExecuting() {
        let (model, source) = makeModel(InputCommandTileInput(def: sampleDef(), isExecuting: true))
        model.start()
        model.requestDialog()
        XCTAssertEqual(source.dialogCount, 0)
    }

    func testRequestDialogInertWhileOffline() {
        let (model, source) = makeModel(InputCommandTileInput(def: sampleDef(), connection: .offline))
        model.start()
        model.requestDialog()
        XCTAssertEqual(source.dialogCount, 0)
    }

    func testToggleFavoriteAlwaysDelegates() {
        let (model, source) = makeModel(InputCommandTileInput(def: sampleDef(), connection: .offline))
        model.start()
        model.toggleFavorite()
        XCTAssertEqual(source.favoriteToggleCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(InputCommandTileInput(def: sampleDef(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(InputCommandTileInput(def: sampleDef(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(InputCommandTileInput(def: sampleDef(), connection: .offline))
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
        XCTAssertEqual(InputCommandTile.surfaceSlug, "InputCommandTile")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyInputCommandTelemetry: InputCommandTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
