//
//  SafetyPageModel.swift
//  TeslaSync — P4 page · P7 · settings/Safety (Apple) — State holder
//
//  The `@Observable` state holder behind `SafetyPage`, the native parity of
//  web/src/features/settings/pages/SafetyPage.tsx (route `/settings/safety`).
//
//  The web page renders the deterministic, AI-OFF-safe listing of every
//  safety-related TeslaSync setting from `useSettings()`. There is no networking
//  here (ADR-004): the per-install values arrive through an injected
//  `SafetySettingsDataSource` seam — the production app drops the shared settings
//  store into it, while previews/tests inject doubles. The row metadata
//  (`SafetySettingKind`) mirrors the web `SAFETY_ROWS` list and the AI tool's
//  `projectSafetySettingsEnvelope` projection, so the off-mode static-help surface
//  lists exactly the settings Helix would explain on-mode.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Settings snapshot (web `useSettings()` safety subset)

/// The safety-related slice of the user settings the listing reads, mirroring the
/// web `Settings` shape field-for-field. Times stay as `HH:MM` strings exactly as the
/// web stores them; everything is formatted at the SwiftUI display boundary.
struct SafetySettingsSnapshot: Equatable {
    var quietHoursEnabled: Bool
    var quietHoursStart: String?
    var quietHoursEnd: String?
    var alertDigestMode: String
    var criticalFlashEnabled: Bool
    var tabBadgeEnabled: Bool
    var apiSuspended: Bool

    /// The web `DEFAULT_SETTINGS` safety subset (web/src/hooks/useSettings.ts) — the
    /// values the listing shows until the per-install store resolves.
    static let defaults = SafetySettingsSnapshot(
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        alertDigestMode: "instant",
        criticalFlashEnabled: true,
        tabBadgeEnabled: true,
        apiSuspended: false
    )
}

// MARK: - Data-source seam (web `useSettings()` — ADR-004, no networking in the view)

/// Supplies the safety settings snapshot the listing renders. The production
/// implementation binds the shared settings store; previews/tests inject doubles.
protocol SafetySettingsDataSource: Sendable {
    func load() async throws -> SafetySettingsSnapshot
}

/// Page/preview default until the shared settings store is injected at composition
/// time. Seeded from the web `DEFAULT_SETTINGS` so the listing renders meaningful
/// current values out of the box (mirrors the sibling pages' sample seams).
struct SampleSafetySettingsDataSource: SafetySettingsDataSource {
    var snapshot: SafetySettingsSnapshot = .defaults

    func load() async throws -> SafetySettingsSnapshot {
        snapshot
    }
}

// MARK: - Page state

/// The listing's render state. `.loading` is the transient before the local snapshot
/// resolves; `.success` carries the values. The deterministic listing has no empty or
/// error surface (web `useSettings()` always yields defaults), so it never blanks.
enum SafetyPageState: Equatable {
    case loading
    case success(SafetySettingsSnapshot)
}

// MARK: - Page model

/// The `@Observable` model the page binds to (ADR-004 — no networking in the view).
/// Owns the listing state and exposes the static row metadata; reads the per-install
/// values through the injected `SafetySettingsDataSource` seam.
@MainActor
@Observable
final class SafetyPageModel {
    private(set) var state: SafetyPageState = .loading

    @ObservationIgnored private let dataSource: any SafetySettingsDataSource

    init(dataSource: any SafetySettingsDataSource = SampleSafetySettingsDataSource()) {
        self.dataSource = dataSource
    }

    /// The resolved settings (web `DEFAULT_SETTINGS` until the first successful load).
    var settings: SafetySettingsSnapshot {
        if case let .success(snapshot) = state { return snapshot }
        return .defaults
    }

    /// The deterministic, AI-OFF-safe listing rows (web `SAFETY_ROWS`, fixed order).
    var rows: [SafetySettingKind] {
        SafetySettingKind.allCases
    }

    /// Loads the snapshot and resolves `.success` (web `useSettings()` query).
    func load() async {
        await fetchAndApply()
    }

    /// Re-reads the snapshot without flipping back to `.loading` (pull-to-refresh).
    func refresh() async {
        await fetchAndApply()
    }

    private func fetchAndApply() async {
        do {
            state = try await .success(dataSource.load())
        } catch {
            // The deterministic listing always renders: on the (local) source failing,
            // fall back to the web DEFAULT_SETTINGS so the panel is never blank.
            state = .success(.defaults)
        }
    }
}

// MARK: - Safety setting rows (web `SAFETY_ROWS`)

/// One row in the deterministic listing. Ordered to mirror the web `SAFETY_ROWS` /
/// `projectSafetySettingsEnvelope` projection; the SET must stay identical so the
/// off-mode static-help surface lists everything Helix would explain on-mode. Each
/// case's `rawValue` equals the web i18n key segment, so the localized title/detail
/// keys derive 1:1 from it.
enum SafetySettingKind: String, CaseIterable, Identifiable {
    case quietHoursEnabled
    case quietHoursStart
    case quietHoursEnd
    case alertDigestMode
    case criticalFlashEnabled
    case tabBadgeEnabled
    case apiSuspended

    var id: String {
        rawValue
    }

    /// Localized row title — web `safetySettings.rows.<key>.title`.
    var titleKey: LocalizedStringKey {
        LocalizedStringKey("translation.safetySettings.rows." + rawValue + ".title")
    }

    /// Localized plain-English explanation — web `safetySettings.rows.<key>.description`.
    var detailKey: LocalizedStringKey {
        LocalizedStringKey("translation.safetySettings.rows." + rawValue + ".description")
    }

    /// The documentation anchor (web `docsAnchor`), preserved verbatim as the link target.
    var docsAnchor: String {
        switch self {
        case .quietHoursEnabled, .quietHoursStart, .quietHoursEnd:
            "/docs/notifications/quiet-hours.md"
        case .alertDigestMode:
            "/docs/notifications/digest.md"
        case .criticalFlashEnabled, .tabBadgeEnabled:
            "/docs/notifications/tab-signalling.md"
        case .apiSuspended:
            "/docs/operations/api-suspended.md"
        }
    }

    /// The docs anchor as a `URL` for the row's `Link` (web relative `<a href>`).
    var docsURL: URL {
        URL(string: docsAnchor) ?? URL(filePath: docsAnchor)
    }

    /// The current value rendered in the row badge (web `renderValue`).
    func value(in settings: SafetySettingsSnapshot) -> SafetyValue {
        switch self {
        case .quietHoursEnabled: Self.onOff(settings.quietHoursEnabled)
        case .quietHoursStart: .text(settings.quietHoursStart ?? Self.emDash)
        case .quietHoursEnd: .text(settings.quietHoursEnd ?? Self.emDash)
        case .alertDigestMode: Self.digest(settings.alertDigestMode)
        case .criticalFlashEnabled: Self.onOff(settings.criticalFlashEnabled)
        case .tabBadgeEnabled: Self.onOff(settings.tabBadgeEnabled)
        case .apiSuspended: Self.suspension(settings.apiSuspended)
        }
    }

    private static let emDash = "—"

    private static func onOff(_ flag: Bool) -> SafetyValue {
        .localized(flag ? "translation.common.on" : "translation.common.off")
    }

    private static func suspension(_ flag: Bool) -> SafetyValue {
        .localized(flag ? "translation.safetySettings.value.suspended" : "translation.common.active")
    }

    private static func digest(_ mode: String) -> SafetyValue {
        switch mode {
        case "hourly": .localized("translation.safetySettings.value.digestHourly")
        case "daily": .localized("translation.safetySettings.value.digestDaily")
        default: .localized("translation.safetySettings.value.digestInstant")
        }
    }
}

// MARK: - Row value

/// A row's current value: either a localized token (On/Off/Active/Suspended/digest
/// mode) or verbatim data (a `HH:MM` time or the em-dash fallback).
enum SafetyValue: Equatable {
    case localized(LocalizedStringKey)
    case text(String)
}
