//
//  StatusBar.SegmentModels.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The resolved, view-ready value types for each of the bar's six segments — the native peers of what the
//  web segment components compute per render. The view reads these and draws; it never recomputes a tone, a
//  label, or a fallback. Every type is `Sendable` + `Equatable` so the projection can skip a no-op publish
//  and the tests can assert exact shapes. SwiftUI-free: chrome (SF Symbols, tokens) is resolved here only as
//  vendor-neutral data (a symbol name string, a `StatusBarTone`); the actual colors/fonts come from P1/S9 in
//  the view.
//

import Foundation

// MARK: - Connection (web ConnectionSegment · useApiHealth)

/// The resolved API-connection segment — web `ConnectionSegment`. Pairs a tone with an SF Symbol (color is
/// never the sole encoder), carries the "API" short label, the localized state word, the latency chip, and
/// the offline suffix.
public struct StatusBarConnectionVM: Sendable, Equatable {
    public let tone: StatusBarTone
    public let symbol: String
    public let shortLabel: String
    public let stateLabel: String
    public let latencyText: String?
    public let showsLatency: Bool
    public let offlineSuffix: String?
    public let tooltip: String
    public let accessibilityLabel: String
    public let route: String
    /// `true` when the backend is unreachable (web `offline`) — drives the container error / retry chip.
    public let isError: Bool

    public init(
        tone: StatusBarTone,
        symbol: String,
        shortLabel: String,
        stateLabel: String,
        latencyText: String?,
        showsLatency: Bool,
        offlineSuffix: String?,
        tooltip: String,
        accessibilityLabel: String,
        route: String,
        isError: Bool
    ) {
        self.tone = tone
        self.symbol = symbol
        self.shortLabel = shortLabel
        self.stateLabel = stateLabel
        self.latencyText = latencyText
        self.showsLatency = showsLatency
        self.offlineSuffix = offlineSuffix
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.route = route
        self.isError = isError
    }
}

// MARK: - Live telemetry (web LiveTelemetrySegment · useLiveConnection)

/// The resolved live-telemetry segment — web `LiveTelemetrySegment`. The glyph spins while reconnecting
/// (Reduce-Motion-aware in the view); the age chip shows only while connected.
public struct StatusBarLiveVM: Sendable, Equatable {
    public let tone: StatusBarTone
    public let symbol: String
    public let spins: Bool
    public let shortLabel: String
    public let ageText: String?
    public let tooltip: String
    public let accessibilityLabel: String
    public let route: String
    /// `true` when the stream is open but past the freshness window — drives the stale chip + auto-refresh.
    public let isStale: Bool

    public init(
        tone: StatusBarTone,
        symbol: String,
        spins: Bool,
        shortLabel: String,
        ageText: String?,
        tooltip: String,
        accessibilityLabel: String,
        route: String,
        isStale: Bool
    ) {
        self.tone = tone
        self.symbol = symbol
        self.spins = spins
        self.shortLabel = shortLabel
        self.ageText = ageText
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.route = route
        self.isStale = isStale
    }
}

// MARK: - Active vehicle (web ActiveVehicleSegment · useSelectedVehicle + useVehicleState)

/// How the active-vehicle segment presents — web hides it at 0 cars, shows a static chip at 1, and a
/// popover switcher at 2+.
public enum StatusBarVehicleMode: String, Sendable, Equatable {
    case hidden, staticChip, switcher
}

/// One row in the vehicle switcher popover — web `<button role="option">`.
public struct StatusBarVehicleOption: Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let model: String?
    public let isSelected: Bool

    public init(id: Int, name: String, model: String?, isSelected: Bool) {
        self.id = id
        self.name = name
        self.model = model
        self.isSelected = isSelected
    }
}

/// The resolved active-vehicle segment — web `ActiveVehicleSegment`.
public struct StatusBarVehicleVM: Sendable, Equatable {
    public let mode: StatusBarVehicleMode
    public let label: String
    public let subLabel: String?
    public let metricsText: String?
    public let tooltip: String
    public let accessibilityLabel: String
    public let switchAccessibilityLabel: String
    public let listAccessibilityLabel: String
    public let options: [StatusBarVehicleOption]

    public init(
        mode: StatusBarVehicleMode,
        label: String,
        subLabel: String?,
        metricsText: String?,
        tooltip: String,
        accessibilityLabel: String,
        switchAccessibilityLabel: String,
        listAccessibilityLabel: String,
        options: [StatusBarVehicleOption]
    ) {
        self.mode = mode
        self.label = label
        self.subLabel = subLabel
        self.metricsText = metricsText
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.switchAccessibilityLabel = switchAccessibilityLabel
        self.listAccessibilityLabel = listAccessibilityLabel
        self.options = options
    }
}

// MARK: - Background work (web BackgroundWorkSegment · useBackgroundJobs)

/// One running job row in the background-work popover — web per-job entry.
public struct StatusBarJobRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: StatusBarJobKind
    public let label: String
    public let detail: String?

    public init(id: String, kind: StatusBarJobKind, label: String, detail: String?) {
        self.id = id
        self.kind = kind
        self.label = label
        self.detail = detail
    }
}

/// The resolved background-work segment — web `BackgroundWorkSegment`. Hidden while idle (web `return null`).
public struct StatusBarBackgroundVM: Sendable, Equatable {
    public let isVisible: Bool
    public let summary: String
    public let tooltip: String
    public let accessibilityLabel: String
    public let heading: String
    public let jobs: [StatusBarJobRow]

    public init(
        isVisible: Bool,
        summary: String,
        tooltip: String,
        accessibilityLabel: String,
        heading: String,
        jobs: [StatusBarJobRow]
    ) {
        self.isVisible = isVisible
        self.summary = summary
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.heading = heading
        self.jobs = jobs
    }
}

// MARK: - Help (web HelpSegment)

/// One help affordance's copy — tooltip + VoiceOver label + the (xl-only) inline label.
public struct StatusBarHelpAction: Sendable, Equatable {
    public let tooltip: String
    public let accessibilityLabel: String
    public let label: String

    public init(tooltip: String, accessibilityLabel: String, label: String) {
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.label = label
    }
}

/// The resolved help segment — web `HelpSegment` (shortcuts / take-a-tour / report-bug).
public struct StatusBarHelpVM: Sendable, Equatable {
    public let shortcuts: StatusBarHelpAction
    public let shortcutKeyCap: String
    public let tour: StatusBarHelpAction
    public let feedback: StatusBarHelpAction

    public init(
        shortcuts: StatusBarHelpAction,
        shortcutKeyCap: String,
        tour: StatusBarHelpAction,
        feedback: StatusBarHelpAction
    ) {
        self.shortcuts = shortcuts
        self.shortcutKeyCap = shortcutKeyCap
        self.tour = tour
        self.feedback = feedback
    }
}

// MARK: - Version (web VersionSegment + About modal)

/// A key/value row in the About-this-build sheet — web `<dt>`/`<dd>` pair.
public struct StatusBarKV: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let monospaced: Bool

    public init(id: String, label: String, value: String, monospaced: Bool) {
        self.id = id
        self.label = label
        self.value = value
        self.monospaced = monospaced
    }
}

/// The "newer release available" banner inside the About sheet — web `updateAvailable && <div>`.
public struct StatusBarUpdateBanner: Sendable, Equatable {
    public let title: String
    public let message: String?

    public init(title: String, message: String?) {
        self.title = title
        self.message = message
    }
}

/// The About-this-build sheet — web `<Modal>` body (provenance rows + the update banner + the actions).
public struct StatusBarVersionSheet: Sendable, Equatable {
    public let title: String
    public let rows: [StatusBarKV]
    public let updateBanner: StatusBarUpdateBanner?
    public let whatsNewLabel: String
    public let releaseNotesLabel: String
    public let closeLabel: String
    public let hasUnseenChangelog: Bool

    public init(
        title: String,
        rows: [StatusBarKV],
        updateBanner: StatusBarUpdateBanner?,
        whatsNewLabel: String,
        releaseNotesLabel: String,
        closeLabel: String,
        hasUnseenChangelog: Bool
    ) {
        self.title = title
        self.rows = rows
        self.updateBanner = updateBanner
        self.whatsNewLabel = whatsNewLabel
        self.releaseNotesLabel = releaseNotesLabel
        self.closeLabel = closeLabel
        self.hasUnseenChangelog = hasUnseenChangelog
    }
}

/// The resolved version segment — web `VersionSegment`. Carries the version label, the optional SHA chip,
/// the update / unseen-changelog dots, and the fully-resolved About sheet.
public struct StatusBarVersionVM: Sendable, Equatable {
    public let label: String
    public let shaText: String?
    public let updateAvailable: Bool
    public let hasUnseenChangelog: Bool
    public let tooltip: String
    public let accessibilityLabel: String
    public let sheet: StatusBarVersionSheet

    public init(
        label: String,
        shaText: String?,
        updateAvailable: Bool,
        hasUnseenChangelog: Bool,
        tooltip: String,
        accessibilityLabel: String,
        sheet: StatusBarVersionSheet
    ) {
        self.label = label
        self.shaText = shaText
        self.updateAvailable = updateAvailable
        self.hasUnseenChangelog = hasUnseenChangelog
        self.tooltip = tooltip
        self.accessibilityLabel = accessibilityLabel
        self.sheet = sheet
    }
}
