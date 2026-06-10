//
//  CommandTile.Tests.swift
//  TeslaSync — P4 feature view · 0226 · CommandTile (Apple)
//
//  Unit coverage for the CommandTile surface: the Adapter projections (variant tone,
//  last-status outcome parse, render phase, freshness chip, VoiceOver builders, the
//  command-parameters value), the `CommandTileModel` state holder (initial parse, the
//  activate → execute / request-confirmation routing, the execution lifecycle, the
//  cached-behind-offline contract, freshness, the favorite toggle, the gating guards,
//  and the P1/S11 `view.opened` telemetry), and the i18n facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by the in-memory seams.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: definition + status → projection

@MainActor final class CommandTileAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    // Variant → tone (web `hoverStyles[variant]`)

    func testVariantToneMapping() {
        XCTAssertEqual(CommandTileVariant.default.tone, .accent)
        XCTAssertEqual(CommandTileVariant.danger.tone, .danger)
        XCTAssertEqual(CommandTileVariant.success.tone, .success)
    }

    // Definition projection

    func testDefHasSublabel() {
        let withSub = CommandTileDef(
            id: "a",
            command: "a",
            labelKey: "k",
            labelFallback: "A",
            sublabelKey: "sk",
            sublabelFallback: "Sub",
            systemImage: "bolt"
        )
        XCTAssertTrue(withSub.hasSublabel)

        let withoutSub = CommandTileDef(id: "b", command: "b", labelKey: "k", labelFallback: "B", systemImage: "bolt")
        XCTAssertFalse(withoutSub.hasSublabel)
    }

    // Command parameters value

    func testCommandParametersEqualityAndEmptiness() {
        XCTAssertTrue(CommandParameters().isEmpty)
        XCTAssertFalse(CommandParameters(["limit_mph": .int(70)]).isEmpty)
        XCTAssertEqual(CommandParameters(["on": .bool(true)]), CommandParameters(["on": .bool(true)]))
        XCTAssertNotEqual(CommandParameters(["on": .bool(true)]), CommandParameters(["on": .bool(false)]))
    }

    // Last-status outcome (web `lastStatus.startsWith('✓')`)

    func testOutcomeParseNilForBlank() {
        XCTAssertNil(CommandTileOutcome.parse(nil))
        XCTAssertNil(CommandTileOutcome.parse(""))
        XCTAssertNil(CommandTileOutcome.parse("   "))
    }

    func testOutcomeParseSuccessMarker() {
        XCTAssertEqual(CommandTileOutcome.parse("✓ Locked"), .succeeded(detail: "Locked"))
        XCTAssertEqual(CommandTileOutcome.parse("  ✓ Done  "), .succeeded(detail: "Done"))
        XCTAssertEqual(CommandTileOutcome.parse("✓"), .succeeded(detail: nil))
    }

    func testOutcomeParseFailure() {
        XCTAssertEqual(CommandTileOutcome.parse("Command failed"), .failed(detail: "Command failed"))
        XCTAssertEqual(CommandTileOutcome.parse("✗ Boom"), .failed(detail: "Boom"))
    }

    func testOutcomeToneAndSymbol() {
        XCTAssertEqual(CommandTileOutcome.succeeded(detail: nil).tone, .success)
        XCTAssertEqual(CommandTileOutcome.failed(detail: nil).tone, .danger)
        XCTAssertEqual(CommandTileOutcome.succeeded(detail: nil).systemImage, "checkmark.circle.fill")
        XCTAssertEqual(CommandTileOutcome.failed(detail: nil).systemImage, "exclamationmark.circle.fill")
        XCTAssertEqual(CommandTileOutcome.failed(detail: "x").detail, "x")
    }

    // Render phase (web `loading` + `lastStatus`)

    func testPhaseProjection() {
        XCTAssertEqual(CommandTilePhase.project(isExecuting: true, outcome: nil), .executing)
        XCTAssertEqual(
            CommandTilePhase.project(isExecuting: true, outcome: .succeeded(detail: nil)),
            .executing
        )
        XCTAssertEqual(
            CommandTilePhase.project(isExecuting: false, outcome: .failed(detail: "x")),
            .result(.failed(detail: "x"))
        )
        XCTAssertEqual(CommandTilePhase.project(isExecuting: false, outcome: nil), .idle)
    }

    // Freshness chip (native live-state chrome)

    func testConnectionChipMapsEveryState() {
        XCTAssertNil(CommandTileConnectionChip.project(.live))
        XCTAssertEqual(CommandTileConnectionChip.project(.stale)?.tone, .warning)
        XCTAssertEqual(CommandTileConnectionChip.project(.stale)?.labelKey, "commands.tile.freshness.stale")
        XCTAssertEqual(CommandTileConnectionChip.project(.offline)?.tone, .neutral)
        XCTAssertEqual(CommandTileConnectionChip.project(.offline)?.labelKey, "commands.tile.freshness.offline")
    }

    // Accessibility builders (web `aria-label`, testid)

    func testAccessibilityBuilders() {
        XCTAssertEqual(CommandTileAccessibility.favoriteLabel(localize: echo), "Toggle favorite")
        XCTAssertEqual(
            CommandTileAccessibility.activationHint(isDangerous: true, localize: echo),
            "Asks for confirmation before running"
        )
        XCTAssertEqual(
            CommandTileAccessibility.activationHint(isDangerous: false, localize: echo),
            "Runs the command"
        )
        XCTAssertEqual(CommandTileAccessibility.testID(commandID: "lock"), "command-tile-lock")
        XCTAssertEqual(CommandTileAccessibility.favoriteTestID(commandID: "lock"), "command-tile-favorite-lock")
    }

    // i18n facade resolves the verbatim source key (bundle-free → returns value)

    func testLocalizationFacadeReturnsFallback() {
        XCTAssertEqual(CommandTileStrings.string("commands.toggleFavorite", "Toggle favorite"), "Toggle favorite")
    }
}

// MARK: - State holder: parse + activate routing + lifecycle + favorite + telemetry

@MainActor final class CommandTileModelTests: XCTestCase {
    private let lockDef = CommandTileDef(
        id: "lock",
        command: "lock",
        labelKey: "commands.security.lock",
        labelFallback: "Lock",
        systemImage: "lock.fill"
    )

    private func dangerDef() -> CommandTileDef {
        CommandTileDef(
            id: "sentry",
            command: "sentry_on",
            labelKey: "commands.security.sentry",
            labelFallback: "Sentry",
            systemImage: "shield.lefthalf.filled",
            variant: .danger,
            isDangerous: true
        )
    }

    private func makeModel(
        def: CommandTileDef? = nil,
        isFavorite: Bool = false,
        lastStatus: String? = nil,
        dispatcher: InMemoryCommandDispatcher,
        favorites: InMemoryFavoriteToggle,
        telemetry: any CommandTileTelemetry = OSLogCommandTileTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 120
    ) -> CommandTileModel {
        CommandTileModel(
            def: def ?? lockDef,
            isFavorite: isFavorite,
            lastStatus: lastStatus,
            dispatcher: dispatcher,
            favorites: favorites,
            telemetry: telemetry,
            now: now,
            stalenessWindow: stalenessWindow
        )
    }

    func testInitialIdleState() {
        let model = makeModel(dispatcher: InMemoryCommandDispatcher(), favorites: InMemoryFavoriteToggle())
        XCTAssertFalse(model.isExecuting)
        XCTAssertNil(model.outcome)
        XCTAssertFalse(model.isFavorite)
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.connection, .live)
        XCTAssertTrue(model.isInteractive)
    }

    func testInitialParsesLastStatus() {
        let model = makeModel(
            isFavorite: true,
            lastStatus: "✓ Locked",
            dispatcher: InMemoryCommandDispatcher(),
            favorites: InMemoryFavoriteToggle(initial: true)
        )
        XCTAssertEqual(model.outcome, .succeeded(detail: "Locked"))
        XCTAssertEqual(model.phase, .result(.succeeded(detail: "Locked")))
        XCTAssertTrue(model.isFavorite)
        XCTAssertNotNil(model.lastOutcomeAt)
    }

    func testActivateNonDangerousExecutes() {
        let params = CommandParameters(["limit_mph": .int(70)])
        let def = CommandTileDef(
            id: "speed",
            command: "speed_limit_set_limit",
            labelKey: "k",
            labelFallback: "Speed",
            systemImage: "gauge",
            parameters: params
        )
        let dispatcher = InMemoryCommandDispatcher(autoEmits: false)
        let model = makeModel(
            def: def,
            lastStatus: "✓ Old",
            dispatcher: dispatcher,
            favorites: InMemoryFavoriteToggle()
        )
        model.activate()
        XCTAssertTrue(model.isExecuting)
        XCTAssertNil(model.outcome) // prior outcome cleared on re-run
        XCTAssertEqual(dispatcher.executeCount, 1)
        XCTAssertEqual(dispatcher.lastCommand, "speed_limit_set_limit")
        XCTAssertEqual(dispatcher.lastParameters, params)
        XCTAssertEqual(dispatcher.confirmationCount, 0)
    }

    func testActivateDangerousRequestsConfirmation() {
        let dispatcher = InMemoryCommandDispatcher(autoEmits: false)
        let model = makeModel(def: dangerDef(), dispatcher: dispatcher, favorites: InMemoryFavoriteToggle())
        model.activate()
        XCTAssertEqual(dispatcher.confirmationCount, 1)
        XCTAssertEqual(dispatcher.lastConfirmationID, "sentry")
        XCTAssertEqual(dispatcher.executeCount, 0)
        XCTAssertFalse(model.isExecuting)
    }

    func testActivateGuardedWhileExecuting() {
        let dispatcher = InMemoryCommandDispatcher(autoEmits: false)
        let model = makeModel(dispatcher: dispatcher, favorites: InMemoryFavoriteToggle())
        model.activate()
        model.activate()
        XCTAssertEqual(dispatcher.executeCount, 1)
    }

    func testSucceededEventSettlesOutcome() {
        let dispatcher = InMemoryCommandDispatcher(autoEmits: false)
        let model = makeModel(dispatcher: dispatcher, favorites: InMemoryFavoriteToggle())
        model.activate()
        dispatcher.push(.succeeded(detail: "Locked"))
        XCTAssertFalse(model.isExecuting)
        XCTAssertEqual(model.outcome, .succeeded(detail: "Locked"))
        XCTAssertEqual(model.connection, .live)
        XCTAssertTrue(model.isInteractive)
    }

    func testFailedEventSettlesOutcome() {
        let dispatcher = InMemoryCommandDispatcher(autoEmits: false)
        let model = makeModel(dispatcher: dispatcher, favorites: InMemoryFavoriteToggle())
        model.activate()
        dispatcher.push(.failed(detail: "Asleep"))
        XCTAssertFalse(model.isExecuting)
        XCTAssertEqual(model.outcome, .failed(detail: "Asleep"))
    }

    func testAutoEmittingDispatcherSettlesOnActivate() {
        let dispatcher = InMemoryCommandDispatcher(event: .succeeded(detail: "Done"))
        let model = makeModel(dispatcher: dispatcher, favorites: InMemoryFavoriteToggle())
        model.activate()
        XCTAssertFalse(model.isExecuting)
        XCTAssertEqual(model.outcome, .succeeded(detail: "Done"))
    }

    func testOfflineEventKeepsCachedOutcomeAndBlocks() {
        let dispatcher = InMemoryCommandDispatcher(autoEmits: false)
        let model = makeModel(lastStatus: "✓ Locked", dispatcher: dispatcher, favorites: InMemoryFavoriteToggle())
        dispatcher.push(.offline(detail: "No connection"))
        XCTAssertFalse(model.isExecuting)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.outcome, .succeeded(detail: "Locked")) // cached outcome stays
        XCTAssertFalse(model.isInteractive)
    }

    func testActivateBlockedWhileOffline() {
        let dispatcher = InMemoryCommandDispatcher(autoEmits: false)
        let model = makeModel(dispatcher: dispatcher, favorites: InMemoryFavoriteToggle())
        dispatcher.push(.offline(detail: "No connection"))
        model.activate()
        XCTAssertEqual(dispatcher.executeCount, 0)
        XCTAssertEqual(dispatcher.confirmationCount, 0)
    }

    func testToggleFavoriteFlipsAndCallsSeam() {
        let favorites = InMemoryFavoriteToggle(initial: false)
        let model = makeModel(dispatcher: InMemoryCommandDispatcher(), favorites: favorites)
        model.toggleFavorite()
        XCTAssertTrue(model.isFavorite)
        XCTAssertEqual(favorites.toggleCount, 1)
        XCTAssertEqual(favorites.lastCommandID, "lock")
    }

    func testFavoriteSeamIsAuthoritative() {
        let favorites = InMemoryFavoriteToggle(initial: false, autoConfirms: false)
        let model = makeModel(dispatcher: InMemoryCommandDispatcher(), favorites: favorites)
        model.toggleFavorite()
        XCTAssertTrue(model.isFavorite) // optimistic flip
        favorites.confirm(false) // server rejects
        XCTAssertFalse(model.isFavorite)
    }

    func testStaleAfterFreshnessWindow() {
        let clock = CommandTileMutableClock(Date(timeIntervalSince1970: 1_000_000))
        let model = makeModel(
            lastStatus: "✓ Locked",
            dispatcher: InMemoryCommandDispatcher(),
            favorites: InMemoryFavoriteToggle(),
            now: { clock.now() },
            stalenessWindow: 120
        )
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.connection, .live)

        clock.current = Date(timeIntervalSince1970: 1_000_300)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.connection, .stale)
    }

    func testIdleTileNeverGoesStale() {
        let clock = CommandTileMutableClock(Date(timeIntervalSince1970: 1_000_000))
        let model = makeModel(
            dispatcher: InMemoryCommandDispatcher(),
            favorites: InMemoryFavoriteToggle(),
            now: { clock.now() },
            stalenessWindow: 120
        )
        clock.current = Date(timeIntervalSince1970: 1_000_300)
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.connection, .live)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyCommandTileTelemetry()
        let model = makeModel(
            dispatcher: InMemoryCommandDispatcher(),
            favorites: InMemoryFavoriteToggle(),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CommandTileSurface.slug])
        XCTAssertEqual(CommandTileSurface.slug, "CommandTile")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCommandTileTelemetry: CommandTileTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// A settable clock so the freshness window can be crossed deterministically.
private final class CommandTileMutableClock: @unchecked Sendable {
    var current: Date
    init(_ start: Date) {
        current = start
    }

    func now() -> Date {
        current
    }
}
