//
//  UpdateAvailableCallout.Tests.swift
//  TeslaSync — P4 feature view · 0259 · UpdateAvailableCallout (Apple)
//
//  Host-free unit coverage for the UpdateAvailableCallout surface:
//    • Projection — the web parent `hasUpdate` mount gate (loading/up-to-date/failed →
//      distinct withdrawn reasons; update_available → presented) and the three leaf
//      fragments (heading version, body "you're running" prefix, last-checked suffix),
//      each pinned 1:1 against the web JSX conditionals.
//    • Adapter — the `useDateFormat().formatDateTime` port, the release-notes URL, the
//      `{{name}}` interpolation, the promoted copy keys, and the VoiceOver summary.
//    • State holder — the model wiring + the P1/S11 `view.opened` telemetry deferred to the
//      first PRESENTED apply (the web emits no DOM until `hasUpdate`).
//    • Per-state projection bundle — the host-free stand-in for a per-state snapshot.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no host: the model is
//  driven by InMemoryUpdateAvailableSource and the projection is exercised directly.
//

import XCTest
@testable import TeslaSync

/// Localizer that returns the English fallback, so resolution tests are locale-independent.
private let fallbackLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// A deterministic instant for the formatter assertions: 2025-01-15T12:00:00Z.
private let fixedDate = Date(timeIntervalSince1970: 1_736_942_400)
private let posix = Locale(identifier: "en_US_POSIX")
private let utc = TimeZone(identifier: "UTC") ?? .current

// MARK: - Projection: the web `hasUpdate` gate

final class UpdateAvailableProjectionTests: XCTestCase {
    private func resolve(
        _ loadState: UpdateCheckLoadState,
        connection: UpdateConnection = .live
    ) -> UpdateAvailablePhase {
        UpdateAvailableProjection.resolve(
            loadState: loadState, connection: connection, locale: posix, timeZone: utc
        )
    }

    func testLoadingIsAwaitingCheck() {
        XCTAssertEqual(resolve(.loading).idleReason, .awaitingCheck)
        XCTAssertEqual(resolve(.idle).idleReason, .awaitingCheck)
        XCTAssertFalse(resolve(.loading).isPresented)
    }

    func testFailedIsCheckUnavailable() {
        XCTAssertEqual(resolve(.failed).idleReason, .checkUnavailable)
        XCTAssertFalse(resolve(.failed).isPresented)
    }

    func testUpToDateWhenUpdateNotAvailable() {
        let phase = resolve(.loaded(UpdateCheckSnapshot(
            current: "1.2.0", latest: "1.2.0", updateAvailable: false
        )))
        XCTAssertEqual(phase.idleReason, .upToDate)
        XCTAssertFalse(phase.isPresented)
    }

    func testPresentedWhenUpdateAvailable() {
        let phase = resolve(.loaded(UpdateCheckSnapshot(
            current: "1.0.0", latest: "1.2.0", updateAvailable: true, checkedAt: fixedDate
        )))
        XCTAssertTrue(phase.isPresented)
        XCTAssertNotNil(phase.content)
    }

    // MARK: The three web fragments

    func testHeadingIncludesLatestVersion() {
        let content = resolve(.loaded(UpdateCheckSnapshot(latest: "1.2.0", updateAvailable: true))).content
        let heading = content?.heading.resolved(fallbackLocalize)
        XCTAssertEqual(heading, "Update available — v1.2.0")
    }

    func testHeadingOmitsVersionWhenLatestMissing() {
        let content = resolve(.loaded(UpdateCheckSnapshot(latest: nil, updateAvailable: true))).content
        XCTAssertEqual(content?.heading.resolved(fallbackLocalize), "Update available")
    }

    func testHeadingOmitsVersionWhenLatestEmpty() {
        let content = resolve(.loaded(UpdateCheckSnapshot(latest: "", updateAvailable: true))).content
        XCTAssertEqual(content?.heading.resolved(fallbackLocalize), "Update available")
    }

    func testBodyIncludesCurrentPrefix() {
        let content = resolve(.loaded(UpdateCheckSnapshot(
            current: "1.0.0", latest: "1.2.0", updateAvailable: true
        ))).content
        let body = content?.body.resolved(fallbackLocalize)
        XCTAssertEqual(
            body,
            "You're running v1.0.0. Review the release notes before upgrading your deployment."
        )
    }

    func testBodyOmitsCurrentPrefixWhenMissing() {
        let content = resolve(.loaded(UpdateCheckSnapshot(
            current: nil, latest: "1.2.0", updateAvailable: true
        ))).content
        XCTAssertEqual(
            content?.body.resolved(fallbackLocalize),
            "Review the release notes before upgrading your deployment."
        )
    }

    func testLastCheckedPresentWhenCheckedAtSet() {
        let content = resolve(.loaded(UpdateCheckSnapshot(
            latest: "1.2.0", updateAvailable: true, checkedAt: fixedDate
        ))).content
        let lastChecked = content?.lastChecked?.resolved(fallbackLocalize)
        XCTAssertNotNil(lastChecked)
        XCTAssertTrue(lastChecked?.contains("Last checked") ?? false)
        XCTAssertTrue(lastChecked?.contains("2025") ?? false)
        XCTAssertFalse(lastChecked?.contains("{{") ?? true)
    }

    func testLastCheckedNilWhenCheckedAtMissing() {
        let content = resolve(.loaded(UpdateCheckSnapshot(
            latest: "1.2.0", updateAvailable: true, checkedAt: nil
        ))).content
        XCTAssertNotNil(content)
        XCTAssertNil(content?.lastChecked)
    }

    func testPresentedCarriesReleaseNotesURLAndCTA() {
        let content = resolve(.loaded(UpdateCheckSnapshot(latest: "1.2.0", updateAvailable: true))).content
        XCTAssertEqual(
            content?.releaseNotesURL?.absoluteString,
            "https://github.com/ev-dev-labs/teslasync/releases/latest"
        )
        XCTAssertEqual(content?.cta.resolved(fallbackLocalize), "View notes")
    }

    func testConnectionPassesThroughToContent() {
        let live = resolve(.loaded(UpdateCheckSnapshot(latest: "1.2.0", updateAvailable: true)), connection: .live)
        let stale = resolve(.loaded(UpdateCheckSnapshot(latest: "1.2.0", updateAvailable: true)), connection: .stale)
        let offline = resolve(
            .loaded(UpdateCheckSnapshot(latest: "1.2.0", updateAvailable: true)), connection: .offline
        )
        XCTAssertEqual(live.content?.connection, .live)
        XCTAssertEqual(stale.content?.connection, .stale)
        XCTAssertEqual(offline.content?.connection, .offline)
    }
}

// MARK: - Adapter: formatter, URL, interpolation, copy, accessibility

final class UpdateAvailableAdapterTests: XCTestCase {
    func testDateTimeFormatsMediumShort() {
        let formatted = UpdateAvailableFormat.dateTime(fixedDate, locale: posix, timeZone: utc)
        XCTAssertNotEqual(formatted, UpdateAvailableFormat.dash)
        XCTAssertTrue(formatted.contains("2025"))
        XCTAssertTrue(formatted.contains("Jan"))
        XCTAssertTrue(formatted.contains("15"))
    }

    func testDateTimeNilReturnsDash() {
        XCTAssertEqual(UpdateAvailableFormat.dateTime(nil, locale: posix, timeZone: utc), "—")
    }

    func testReleaseNotesURLMatchesWebHref() {
        XCTAssertEqual(
            UpdateAvailableProjection.releaseNotesURL?.absoluteString,
            "https://github.com/ev-dev-labs/teslasync/releases/latest"
        )
    }

    func testInterpolationSubstitutesTokens() {
        XCTAssertEqual(UAInterpolate.apply("v{{version}}", ["version": "1.2.0"]), "v1.2.0")
    }

    func testInterpolationNoArgsReturnsTemplate() {
        XCTAssertEqual(UAInterpolate.apply("Update available", [:]), "Update available")
    }

    func testInterpolationLeavesUnknownTokens() {
        XCTAssertEqual(UAInterpolate.apply("{{a}}-{{b}}", ["a": "x"]), "x-{{b}}")
    }

    func testCopyHeadingWithVersionResolves() {
        XCTAssertEqual(
            UpdateAvailableCopy.headingWithVersion("9.9.9").resolved(fallbackLocalize),
            "Update available — v9.9.9"
        )
    }

    func testCopyLastCheckedResolves() {
        XCTAssertEqual(
            UpdateAvailableCopy.lastChecked("Jan 15, 2025").resolved(fallbackLocalize),
            "Last checked Jan 15, 2025"
        )
    }

    func testFreshnessNoteOnlyForStaleAndOffline() {
        XCTAssertNil(UpdateAvailableCopy.freshnessNote(for: .live))
        XCTAssertEqual(
            UpdateAvailableCopy.freshnessNote(for: .stale)?.resolved(fallbackLocalize),
            "This result may be out of date"
        )
        XCTAssertEqual(
            UpdateAvailableCopy.freshnessNote(for: .offline)?.resolved(fallbackLocalize),
            "Offline — showing the last check"
        )
    }

    func testAccessibilitySummaryJoinsParts() {
        let heading = "Update available — v1.2.0"
        let body = "You're running v1.0.0. Review the release notes before upgrading your deployment."
        let summary = UpdateAvailableAccessibility.summary(
            heading: heading,
            body: body,
            freshnessNote: nil
        )
        XCTAssertEqual(summary, "\(heading). \(body)")
    }

    func testAccessibilitySummaryAppendsFreshnessNote() {
        let summary = UpdateAvailableAccessibility.summary(
            heading: "Update available",
            body: "Review the release notes before upgrading your deployment.",
            freshnessNote: "Offline — showing the last check"
        )
        XCTAssertTrue(summary.hasSuffix("Offline — showing the last check"))
    }
}

// MARK: - State holder + deferred telemetry (P1/S8 + P1/S11)

@MainActor
final class UpdateAvailableModelTests: XCTestCase {
    private func makeModel(
        _ initial: UpdateAvailableInput?,
        telemetry: any UpdateAvailableTelemetry = SpyUpdateAvailableTelemetry()
    ) -> (UpdateAvailableModel, InMemoryUpdateAvailableSource) {
        let source = InMemoryUpdateAvailableSource(initial: initial)
        let model = UpdateAvailableModel(source: source, telemetry: telemetry, locale: posix, timeZone: utc)
        return (model, source)
    }

    func testStartAppliesInitialPresentedAndStartsOnce() {
        let (model, source) = makeModel(.loaded(current: "1.0.0", latest: "1.2.0", checkedAt: fixedDate))
        model.start()
        model.start()
        XCTAssertTrue(model.phase.isPresented)
        XCTAssertEqual(source.startCount, 1)
    }

    func testTelemetryEmittedOnFirstPresentedOnly() {
        let spy = SpyUpdateAvailableTelemetry()
        let (model, source) = makeModel(UpdateAvailableInput(loadState: .loading), telemetry: spy)
        model.start()
        XCTAssertTrue(spy.surfaces.isEmpty, "no impression while withdrawn (web emits no DOM)")

        source.push(.loaded(current: "1.0.0", latest: "1.2.0"))
        XCTAssertEqual(spy.surfaces, [UpdateAvailableCalloutSurface.slug])

        source.push(.loaded(current: "1.0.0", latest: "1.3.0"))
        XCTAssertEqual(spy.surfaces, [UpdateAvailableCalloutSurface.slug], "impression is one-shot")
    }

    func testWithdrawnReasonsNeverEmitTelemetry() {
        let spy = SpyUpdateAvailableTelemetry()
        let (model, source) = makeModel(nil, telemetry: spy)
        model.start()
        source.push(UpdateAvailableInput(loadState: .loading))
        source.push(UpdateAvailableInput(loadState: .failed))
        source.push(.loaded(updateAvailable: false))
        XCTAssertTrue(spy.surfaces.isEmpty)
        XCTAssertEqual(model.phase.idleReason, .upToDate)
    }

    func testPushUpdatesPhaseThroughTheGate() {
        let (model, source) = makeModel(UpdateAvailableInput(loadState: .loading))
        model.start()
        XCTAssertEqual(model.phase.idleReason, .awaitingCheck)

        source.push(.loaded(current: "1.0.0", latest: "1.2.0", checkedAt: fixedDate, connection: .stale))
        XCTAssertTrue(model.phase.isPresented)
        XCTAssertEqual(model.phase.content?.connection, .stale)

        source.push(.loaded(updateAvailable: false))
        XCTAssertEqual(model.phase.idleReason, .upToDate)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(.loaded(latest: "1.2.0"))
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(UpdateAvailableCalloutSurface.slug, "UpdateAvailableCallout")
        XCTAssertEqual(UpdateAvailableCallout.surfaceSlug, UpdateAvailableCalloutSurface.slug)
    }
}

// MARK: - Per-state projection bundle (host-free stand-in for a per-state snapshot)

final class UpdateAvailableProjectionBundleTests: XCTestCase {
    /// The full projected contract for one render state — what the view binds to.
    private struct Projection: Equatable {
        let presented: Bool
        let idleReason: UpdateAvailableIdleReason?
        let heading: String?
        let body: String?
        let lastChecked: String?
        let connection: UpdateConnection?
    }

    private func projection(_ loadState: UpdateCheckLoadState, _ connection: UpdateConnection = .live) -> Projection {
        let phase = UpdateAvailableProjection.resolve(
            loadState: loadState, connection: connection, locale: posix, timeZone: utc
        )
        let content = phase.content
        return Projection(
            presented: phase.isPresented,
            idleReason: phase.idleReason,
            heading: content?.heading.resolved(fallbackLocalize),
            body: content?.body.resolved(fallbackLocalize),
            lastChecked: content?.lastChecked?.resolved(fallbackLocalize),
            connection: content?.connection
        )
    }

    func testLoadingStateProjection() {
        XCTAssertEqual(
            projection(.loading),
            Projection(
                presented: false, idleReason: .awaitingCheck,
                heading: nil, body: nil, lastChecked: nil, connection: nil
            )
        )
    }

    func testFailedStateProjection() {
        XCTAssertEqual(projection(.failed).idleReason, .checkUnavailable)
    }

    func testUpToDateStateProjection() {
        XCTAssertEqual(
            projection(.loaded(UpdateCheckSnapshot(updateAvailable: false))).idleReason,
            .upToDate
        )
    }

    func testPresentedFullStateProjection() {
        let full = projection(.loaded(UpdateCheckSnapshot(
            current: "1.0.0", latest: "1.2.0", updateAvailable: true, checkedAt: fixedDate
        )))
        XCTAssertTrue(full.presented)
        XCTAssertEqual(full.heading, "Update available — v1.2.0")
        XCTAssertEqual(full.body, "You're running v1.0.0. Review the release notes before upgrading your deployment.")
        XCTAssertNotNil(full.lastChecked)
        XCTAssertEqual(full.connection, .live)
    }

    func testPresentedMinimalStateProjection() {
        let minimal = projection(.loaded(UpdateCheckSnapshot(latest: "1.2.0", updateAvailable: true)))
        XCTAssertEqual(minimal.heading, "Update available — v1.2.0")
        XCTAssertEqual(minimal.body, "Review the release notes before upgrading your deployment.")
        XCTAssertNil(minimal.lastChecked)
    }

    func testPresentedOfflineStateProjection() {
        let offline = projection(
            .loaded(UpdateCheckSnapshot(latest: "1.2.0", updateAvailable: true, checkedAt: fixedDate)),
            .offline
        )
        XCTAssertEqual(offline.connection, .offline)
        XCTAssertTrue(offline.presented)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted without an
/// `os_log` round-trip. Single-threaded test usage only.
private final class SpyUpdateAvailableTelemetry: UpdateAvailableTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
