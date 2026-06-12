//
//  StatusBar.ProjectionTests.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  Projection coverage — the verbatim port of every per-render decision the web `StatusBar.tsx` + its six
//  segments make: each segment's tone / icon / labels / fallbacks, and the container's visibility, density,
//  offline / stale / error / empty / loading branches. Pure (no model, no SwiftUI) — each assertion reads
//  the resolved presentation directly. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

final class StatusBarProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)
    private let localize: StatusBarLocalize = { _, fallback in fallback }

    private func resolve(_ input: StatusBarInput) -> StatusBarPresentation {
        StatusBarProjection.resolve(input: input, localize: localize)
    }

    // MARK: Connection

    func testConnectionOkShowsLatencyAndTooltip() {
        let vm = resolve(StatusBarInput(apiHealth: .ok, latencyMs: 42)).connection
        XCTAssertEqual(vm.tone, .positive)
        XCTAssertEqual(vm.stateLabel, "Online")
        XCTAssertEqual(vm.latencyText, "42ms")
        XCTAssertTrue(vm.showsLatency)
        XCTAssertEqual(vm.tooltip, "API connection · Online · 42ms")
        XCTAssertEqual(vm.accessibilityLabel, "API connection status: Online (42ms)")
        XCTAssertFalse(vm.isError)
    }

    func testConnectionOfflineHasErrorAndSuffixNoLatency() {
        let vm = resolve(StatusBarInput(apiHealth: .offline, latencyMs: 42)).connection
        XCTAssertEqual(vm.tone, .critical)
        XCTAssertTrue(vm.isError)
        XCTAssertEqual(vm.offlineSuffix, "Offline")
        XCTAssertFalse(vm.showsLatency)
        XCTAssertEqual(vm.tooltip, "API connection · Offline")
    }

    func testConnectionIconOnlyHidesLatencyChip() {
        let vm = resolve(StatusBarInput(compact: true, apiHealth: .ok, latencyMs: 42)).connection
        XCTAssertFalse(vm.showsLatency)
        XCTAssertEqual(vm.latencyText, "42ms", "the value is still resolved for the tooltip")
    }

    func testConnectionUnknownIsNeutral() {
        let vm = resolve(StatusBarInput(apiHealth: .unknown)).connection
        XCTAssertEqual(vm.tone, .neutral)
        XCTAssertEqual(vm.stateLabel, "Connecting…")
    }

    // MARK: Live telemetry

    func testLiveConnectedShowsAgeAndTooltip() {
        let input = StatusBarInput(liveStatus: .connected, lastMessageAt: now.addingTimeInterval(-5), now: now)
        let vm = resolve(input).live
        XCTAssertEqual(vm.tone, .positive)
        XCTAssertEqual(vm.ageText, "5s")
        XCTAssertEqual(vm.tooltip, "Live telemetry stream · Last message 5s ago")
        XCTAssertFalse(vm.spins)
    }

    func testLiveReconnectingSpins() {
        let vm = resolve(StatusBarInput(liveStatus: .reconnecting)).live
        XCTAssertTrue(vm.spins)
        XCTAssertEqual(vm.tone, .caution)
        XCTAssertEqual(vm.tooltip, "Live telemetry stream · Reconnecting")
    }

    func testLiveStaleFlags() {
        let vm = resolve(StatusBarInput(liveStatus: .stale)).live
        XCTAssertTrue(vm.isStale)
        XCTAssertEqual(vm.tone, .caution)
    }

    func testLiveIconOnlyHidesAge() {
        let input = StatusBarInput(
            compact: true,
            liveStatus: .connected,
            lastMessageAt: now.addingTimeInterval(-5),
            now: now
        )
        XCTAssertNil(resolve(input).live.ageText)
    }

    // MARK: Active vehicle

    func testVehicleHiddenAtZero() {
        XCTAssertEqual(resolve(StatusBarInput(vehicles: [])).vehicle.mode, .hidden)
    }

    func testVehicleStaticChipAtOne() {
        let input = StatusBarInput(
            vehicles: [StatusBarVehicleRef(id: 1, displayName: "Garage", model: "Model 3")],
            selectedVehicleID: 1
        )
        XCTAssertEqual(resolve(input).vehicle.mode, .staticChip)
        XCTAssertEqual(resolve(input).vehicle.label, "Garage")
    }

    func testVehicleSwitcherAndMetrics() {
        let input = StatusBarInput(
            vehicles: [
                StatusBarVehicleRef(id: 1, displayName: "A", model: "Model 3"),
                StatusBarVehicleRef(id: 2, displayName: "B", model: "Model Y")
            ],
            selectedVehicleID: 1,
            batteryLevel: 82,
            ratedRangeMeters: 386_240,
            hasVehicleState: true,
            distanceUnit: .km
        )
        let vm = resolve(input).vehicle
        XCTAssertEqual(vm.mode, .switcher)
        XCTAssertEqual(vm.metricsText, "82% · 386 km")
        XCTAssertEqual(vm.options.count, 2)
        XCTAssertEqual(vm.options.first?.isSelected, true)
    }

    func testVehicleNoneLabelWhenUnselected() {
        let input = StatusBarInput(vehicles: [StatusBarVehicleRef(id: 1)], selectedVehicleID: nil)
        XCTAssertEqual(resolve(input).vehicle.label, "No vehicle")
    }

    // MARK: Background work

    func testBackgroundHiddenWhenIdle() {
        XCTAssertFalse(resolve(StatusBarInput(jobs: [])).background.isVisible)
    }

    func testBackgroundSingularAndPlural() {
        let one = resolve(StatusBarInput(jobs: [StatusBarJob(id: "a", kind: .export, label: "X")])).background
        XCTAssertTrue(one.isVisible)
        XCTAssertEqual(one.summary, "1 task")
        let many = resolve(StatusBarInput(jobs: [
            StatusBarJob(id: "a", kind: .export, label: "X"),
            StatusBarJob(id: "b", kind: .mutation, label: "Y"),
            StatusBarJob(id: "c", kind: .custom, label: "Z")
        ])).background
        XCTAssertEqual(many.summary, "3 tasks")
        XCTAssertEqual(many.jobs.count, 3)
    }

    // MARK: Version

    func testVersionLabelShaAndSheetRows() {
        let info = StatusBarVersionInfo(
            appVersion: "1.8.2", sha: "a1b2c3d", chartVersion: "1.8.0",
            goVersion: "go1.25", os: "linux", arch: "arm64", uptimeSeconds: 93600
        )
        let vm = resolve(StatusBarInput(version: info, hasUnseenChangelog: true, newChangelogEntries: 2)).version
        XCTAssertEqual(vm.label, "v1.8.2")
        XCTAssertEqual(vm.shaText, "a1b2c3d")
        XCTAssertEqual(vm.sheet.rows.count, 6)
        XCTAssertTrue(vm.tooltip.contains("up 1d 2h"))
        XCTAssertTrue(vm.tooltip.contains("2 new release(s)"))
    }

    func testVersionIconOnlyHidesShaAndDevSheetRows() {
        let dev = StatusBarVersionInfo(appVersion: "dev", sha: "dev")
        let vm = resolve(StatusBarInput(compact: true, version: dev)).version
        XCTAssertEqual(vm.label, "vdev")
        XCTAssertNil(vm.shaText)
        XCTAssertEqual(vm.sheet.rows.count, 2, "only app version + commit when chart/go/platform/uptime absent")
    }

    func testVersionUpdateBanner() {
        let input = StatusBarInput(
            version: StatusBarVersionInfo(appVersion: "1.8.2", sha: "abc"),
            updateCheck: StatusBarUpdateCheck(updateAvailable: true, latest: "1.9.0", message: "Fixes.")
        )
        let banner = resolve(input).version.sheet.updateBanner
        XCTAssertEqual(banner?.title, "A newer release is available: v1.9.0")
        XCTAssertEqual(banner?.message, "Fixes.")
    }

    // MARK: Container

    func testHiddenWhenDisabled() {
        XCTAssertTrue(resolve(StatusBarInput(prefs: StatusBarPrefs(enabled: false))).isHidden)
    }

    func testIconOnlyResolution() {
        XCTAssertTrue(resolve(StatusBarInput(compact: true)).iconOnly)
        XCTAssertTrue(resolve(StatusBarInput(prefs: StatusBarPrefs(iconOnly: true))).iconOnly)
        XCTAssertTrue(resolve(StatusBarInput(isNarrow: true)).iconOnly)
        XCTAssertFalse(resolve(StatusBarInput()).iconOnly)
    }

    func testOfflineStaleErrorFlags() {
        XCTAssertTrue(resolve(StatusBarInput(connectivity: .offline)).isOffline)
        XCTAssertTrue(resolve(StatusBarInput(liveStatus: .stale)).isStale)
        XCTAssertTrue(resolve(StatusBarInput(connectivity: .online, apiHealth: .offline)).isError)
        XCTAssertFalse(
            resolve(StatusBarInput(connectivity: .offline, apiHealth: .offline)).isError,
            "connectivity offline supersedes the backend-error chip"
        )
    }

    func testEmptyAndLoadingAndAria() {
        XCTAssertTrue(resolve(StatusBarInput(phase: .ready, vehicles: [], jobs: [])).isEmpty)
        XCTAssertFalse(resolve(StatusBarInput(phase: .loading, vehicles: [], jobs: [])).isEmpty)
        XCTAssertEqual(resolve(StatusBarInput(phase: .loading)).phase, .loading)
        XCTAssertEqual(resolve(StatusBarInput()).accessibilityLabel, "Application status")
    }
}
