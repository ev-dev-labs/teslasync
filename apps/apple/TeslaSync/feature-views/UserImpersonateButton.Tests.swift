//
//  UserImpersonateButton.Tests.swift
//  TeslaSync — P4 feature view · 0050 · UserImpersonateButton (Apple)
//
//  Unit coverage for the UserImpersonateButton surface: the Adapter projections
//  (availability gate, button label, freshness chip, unavailable note, confirm
//  content, VoiceOver aria/testid), the `UserImpersonateButtonModel` state holder
//  (status load phases, the confirm-then-start flow, the start lifecycle, the
//  cached-behind-offline contract, freshness, the gating/re-entrancy guards, and
//  the P1/S11 `view.opened` telemetry), and the accessibility builders.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by the in-memory seams.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: status + props → projection

@MainActor final class UserImpersonateButtonAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// English-fallback `%@` formatter (bundle-free).
    private let fmt: (String, String, String) -> String = { _, fallbackFormat, arg in
        String(format: fallbackFormat, arg)
    }

    // Availability gate (web parent gate + `disabled` prop)

    func testAvailabilityOpenModeWins() {
        let status = ImpersonationStatus(mode: .open, activeSubject: "x")
        XCTAssertEqual(ImpersonationAvailability.project(status: status, disabledByParent: true), .openMode)
    }

    func testAvailabilityAlreadyActive() {
        let status = ImpersonationStatus(mode: .restricted, activeSubject: "bob")
        XCTAssertEqual(
            ImpersonationAvailability.project(status: status, disabledByParent: false),
            .alreadyActive(subject: "bob")
        )
    }

    func testAvailabilityDisabledByParent() {
        let status = ImpersonationStatus(mode: .restricted, activeSubject: nil)
        XCTAssertEqual(
            ImpersonationAvailability.project(status: status, disabledByParent: true),
            .disabledByParent
        )
    }

    func testAvailabilityAvailable() {
        let status = ImpersonationStatus(mode: .restricted, activeSubject: nil)
        let availability = ImpersonationAvailability.project(status: status, disabledByParent: false)
        XCTAssertEqual(availability, .available)
        XCTAssertTrue(availability.canStart)
    }

    func testCanStartOnlyWhenAvailable() {
        XCTAssertTrue(ImpersonationAvailability.available.canStart)
        XCTAssertFalse(ImpersonationAvailability.openMode.canStart)
        XCTAssertFalse(ImpersonationAvailability.alreadyActive(subject: "a").canStart)
        XCTAssertFalse(ImpersonationAvailability.disabledByParent.canStart)
    }

    // Button label (web `isPending ? 'Starting…' : 'Impersonate'`)

    func testButtonLabelProjection() {
        XCTAssertEqual(ImpersonateButtonLabel.project(isStarting: false).key, "impersonation.button.start")
        XCTAssertEqual(ImpersonateButtonLabel.project(isStarting: true).key, "impersonation.button.starting")
        XCTAssertEqual(ImpersonateButtonLabel.project(isStarting: false).fallback, "Impersonate")
        XCTAssertEqual(ImpersonateButtonLabel.project(isStarting: true).fallback, "Starting…")
    }

    func testConnectionChipMapsEveryState() {
        XCTAssertEqual(ImpersonationConnectionChip.project(.live).labelKey, "impersonation.freshness.live")
        XCTAssertEqual(ImpersonationConnectionChip.project(.live).tone, .success)
        XCTAssertEqual(ImpersonationConnectionChip.project(.stale).labelKey, "impersonation.freshness.stale")
        XCTAssertEqual(ImpersonationConnectionChip.project(.stale).tone, .warning)
        XCTAssertEqual(ImpersonationConnectionChip.project(.offline).labelKey, "impersonation.freshness.offline")
        XCTAssertEqual(ImpersonationConnectionChip.project(.offline).tone, .neutral)
    }

    func testUnavailableNoteProjection() {
        XCTAssertNil(ImpersonationUnavailableNote.project(.available))
        XCTAssertEqual(
            ImpersonationUnavailableNote.project(.openMode)?.messageKey,
            "impersonation.unavailable.openMode"
        )
        XCTAssertEqual(
            ImpersonationUnavailableNote.project(.alreadyActive(subject: "a"))?.messageKey,
            "impersonation.unavailable.active"
        )
        XCTAssertEqual(
            ImpersonationUnavailableNote.project(.disabledByParent)?.messageKey,
            "impersonation.unavailable.disabled"
        )
    }

    // ConfirmDialog content (web `ConfirmDialog` props, subject-interpolated)

    func testConfirmContentInterpolatesSubject() {
        let content = ImpersonateConfirmContent.build(subject: "alice", localize: echo, format: fmt)
        XCTAssertEqual(content.title, "Start impersonation session?")
        XCTAssertEqual(content.confirmLabel, "Start impersonation")
        XCTAssertEqual(content.cancelLabel, "Cancel")
        XCTAssertTrue(content.message.contains("alice"))
        XCTAssertTrue(content.message.contains("15 minutes"))
        XCTAssertFalse(content.message.contains("%@"))
        XCTAssertFalse(content.message.contains("{{subject}}"))
    }

    func testAccessibilityButtonLabelInterpolatesSubject() {
        XCTAssertEqual(
            ImpersonateAccessibility.buttonLabel(subject: "alice", format: fmt),
            "Impersonate alice"
        )
    }

    func testAccessibilityTestID() {
        XCTAssertEqual(ImpersonateAccessibility.testID(subject: "alice"), "user-impersonate-button-alice")
    }

    func testStatusPhaseStatusAccessor() {
        let status = ImpersonationStatus(mode: .restricted)
        XCTAssertEqual(ImpersonationStatusPhase.loaded(status).status, status)
        XCTAssertNil(ImpersonationStatusPhase.loading.status)
        XCTAssertNil(ImpersonationStatusPhase.empty.status)
        XCTAssertNil(ImpersonationStatusPhase.failed(message: "x").status)
    }

    // i18n facade resolves the verbatim source keys (bundle-free → returns value)

    func testLocalizationFacadeReturnsFallback() {
        XCTAssertEqual(
            UserImpersonateButtonStrings.string("impersonation.button.start", "Impersonate"),
            "Impersonate"
        )
        XCTAssertEqual(
            UserImpersonateButtonStrings.format("impersonation.button.aria", "Impersonate %@", "alice"),
            "Impersonate alice"
        )
    }
}

// MARK: - State holder: status phases + confirm/start flow + freshness + telemetry

@MainActor final class UserImpersonateButtonModelTests: XCTestCase {
    private func makeModel(
        subject: String = "subject-1",
        disabled: Bool = false,
        provider: InMemoryImpersonationStatusProvider,
        starter: InMemoryImpersonationStarter,
        telemetry: any UserImpersonateButtonTelemetry = OSLogUserImpersonateButtonTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 60,
        onStarted: (@MainActor (String) -> Void)? = nil
    ) -> UserImpersonateButtonModel {
        UserImpersonateButtonModel(
            subject: subject,
            disabledByParent: disabled,
            statusProvider: provider,
            starter: starter,
            telemetry: telemetry,
            now: now,
            stalenessWindow: stalenessWindow,
            onStarted: onStarted
        )
    }

    func testInitialStateIsLoading() {
        let model = makeModel(
            provider: InMemoryImpersonationStatusProvider(autoEmits: false),
            starter: InMemoryImpersonationStarter()
        )
        XCTAssertEqual(model.statusPhase, .loading)
        XCTAssertEqual(model.actionPhase, .idle)
        XCTAssertFalse(model.isConfirmPresented)
        XCTAssertFalse(model.canStart)
        XCTAssertNil(model.availability)
    }

    func testStartLoadsStatusAndBecomesAvailable() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        XCTAssertEqual(provider.loadCount, 1)
        XCTAssertEqual(model.availability, .available)
        XCTAssertTrue(model.canStart)
        XCTAssertFalse(model.isButtonDisabled)
        XCTAssertEqual(model.connection, .live)
    }

    func testOpenModeBlocksStart() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .open)))
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        XCTAssertEqual(model.availability, .openMode)
        XCTAssertFalse(model.canStart)
        model.requestStart()
        XCTAssertFalse(model.isConfirmPresented)
    }

    func testAlreadyActiveBlocksStart() {
        let provider = InMemoryImpersonationStatusProvider(
            initial: .loaded(ImpersonationStatus(mode: .restricted, activeSubject: "bob"))
        )
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        XCTAssertEqual(model.availability, .alreadyActive(subject: "bob"))
        XCTAssertFalse(model.canStart)
    }

    func testDisabledByParentBlocksStart() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let model = makeModel(disabled: true, provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        XCTAssertEqual(model.availability, .disabledByParent)
        XCTAssertFalse(model.canStart)
        XCTAssertTrue(model.isButtonDisabled)
    }

    func testRequestStartOpensConfirmWhenAvailable() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        model.requestStart()
        XCTAssertTrue(model.isConfirmPresented)
    }

    func testConfirmStartFiresStarterWithSubjectAndGoesStarting() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let starter = InMemoryImpersonationStarter(autoResponds: false)
        let model = makeModel(subject: "subject-9", provider: provider, starter: starter)
        model.start()
        model.requestStart()
        model.confirmStart()
        XCTAssertFalse(model.isConfirmPresented)
        XCTAssertEqual(model.actionPhase, .starting)
        XCTAssertEqual(starter.startCount, 1)
        XCTAssertEqual(starter.lastSubject, "subject-9")
        XCTAssertTrue(model.isButtonDisabled)
        XCTAssertEqual(model.buttonLabel.key, "impersonation.button.starting")
    }

    func testStartedOutcomeSetsStartedAndCallsOnStarted() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let starter = InMemoryImpersonationStarter(autoResponds: false)
        var startedSubject: String?
        let model = makeModel(
            subject: "subject-42",
            provider: provider,
            starter: starter,
            onStarted: { startedSubject = $0 }
        )
        model.start()
        model.requestStart()
        model.confirmStart()
        starter.push(.started)
        XCTAssertEqual(model.actionPhase, .started)
        XCTAssertEqual(startedSubject, "subject-42")
    }

    func testFailedOutcomeSurfacesError() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let starter = InMemoryImpersonationStarter(outcome: .failed(message: "Reauth required"))
        let model = makeModel(provider: provider, starter: starter)
        model.start()
        model.requestStart()
        model.confirmStart()
        XCTAssertEqual(model.actionPhase, .failed(message: "Reauth required"))
    }

    func testStartOfflineRevertsAndFlagsOffline() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let starter = InMemoryImpersonationStarter(autoResponds: false)
        let model = makeModel(provider: provider, starter: starter)
        model.start()
        model.requestStart()
        model.confirmStart()
        starter.push(.offline(message: "No connection"))
        XCTAssertEqual(model.actionPhase, .idle)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertFalse(model.canStart)
    }

    func testCancelStartClosesDialog() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        model.requestStart()
        model.cancelStart()
        XCTAssertFalse(model.isConfirmPresented)
        XCTAssertEqual(model.actionPhase, .idle)
    }

    func testConfirmStartGuardedWhileStarting() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let starter = InMemoryImpersonationStarter(autoResponds: false)
        let model = makeModel(provider: provider, starter: starter)
        model.start()
        model.requestStart()
        model.confirmStart()
        model.confirmStart()
        XCTAssertEqual(starter.startCount, 1)
    }

    func testStatusFailedThenRetryRefreshes() {
        let provider = InMemoryImpersonationStatusProvider(
            initial: .failed(message: "503"),
            refreshed: .loaded(ImpersonationStatus(mode: .restricted))
        )
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        XCTAssertEqual(model.statusPhase, .failed(message: "503"))
        model.retryStatus()
        XCTAssertEqual(provider.refreshCount, 1)
        XCTAssertEqual(model.availability, .available)
    }

    func testOfflineKeepsCachedStatusVisible() {
        let provider = InMemoryImpersonationStatusProvider(autoEmits: false)
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter())
        model.start()
        provider.push(.loaded(ImpersonationStatus(mode: .restricted)))
        provider.push(.offline(message: "Network unavailable"))
        XCTAssertEqual(model.statusPhase, .loaded(ImpersonationStatus(mode: .restricted)))
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertFalse(model.canStart) // offline disables the network mutation
    }

    func testStaleAfterFreshnessWindow() {
        let clock = UserImpersonateButtonMutableClock(Date(timeIntervalSince1970: 1_000_000))
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let model = makeModel(
            provider: provider,
            starter: InMemoryImpersonationStarter(),
            now: { clock.now() },
            stalenessWindow: 60
        )
        model.start()
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.connection, .live)

        clock.current = Date(timeIntervalSince1970: 1_000_200)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.connection, .stale)
    }

    func testRetryStartReopensConfirmAfterFailure() {
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let starter = InMemoryImpersonationStarter(outcome: .failed(message: "boom"))
        let model = makeModel(provider: provider, starter: starter)
        model.start()
        model.requestStart()
        model.confirmStart()
        XCTAssertEqual(model.actionPhase, .failed(message: "boom"))
        model.retryStart()
        XCTAssertEqual(model.actionPhase, .idle)
        XCTAssertTrue(model.isConfirmPresented)
    }

    func testStartEmitsViewOpenedOnceAndLoadsOnce() {
        let spy = SpyImpersonateTelemetry()
        let provider = InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .restricted)))
        let model = makeModel(provider: provider, starter: InMemoryImpersonationStarter(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [UserImpersonateButtonSurface.slug])
        XCTAssertEqual(UserImpersonateButtonSurface.slug, "UserImpersonateButton")
        XCTAssertEqual(provider.loadCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyImpersonateTelemetry: UserImpersonateButtonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// A settable clock so the freshness window can be crossed deterministically.
private final class UserImpersonateButtonMutableClock: @unchecked Sendable {
    var current: Date
    init(_ start: Date) {
        current = start
    }

    func now() -> Date {
        current
    }
}
