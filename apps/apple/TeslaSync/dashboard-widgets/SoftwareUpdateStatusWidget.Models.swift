//
//  SoftwareUpdateStatusWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  Domain value types ported from the web source
//  (features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx): the cached input
//  (the vehicle `software_version` + the `vehicle-config/latest` update fields),
//  the derived update stage, the status-chip + progress-bar view-models, and the
//  merged projection the view renders. No SwiftUI / transport here — this is the
//  deterministic core iOS, iPadOS, macOS, and the web all agree on.
//
//  Naming note: the sibling `SoftwareUpdateHistoryWidget` already owns the
//  `SoftwareUpdate*` symbol space in this single app module (its `SoftwareUpdate`,
//  `SoftwareUpdateStatus`, `SoftwareUpdateProjection`, `SoftwareUpdateStatusChip`,
//  …). This surface therefore namespaces its types `SoftwareStatus*` so the two
//  widgets link side-by-side without duplicate-symbol collisions.
//

import Foundation

// MARK: - Cached input (web `state` + `configData`)

/// The cached snapshot the widget projects, mirroring the two web hooks it binds:
/// `useVehicleState` (the live `VehicleState.software_version`) and
/// `useVehicleConfigLatest` (the `vehicle-config/latest` software-update fields).
/// The production source fills this from the shared P1/S8 state holders;
/// previews/tests construct it directly so the adapter is deterministic.
///
/// A `nil` `SoftwareStatusInput` is the web "no vehicle state" branch
/// (`state` falsy ⇒ the "No software data" empty surface); a present value is the
/// content branch even when every update field is absent (⇒ "Up to date").
public struct SoftwareStatusInput: Sendable, Equatable {
    /// `state.software_version` — the firmware the car currently runs.
    public var softwareVersion: String?
    /// `configData.software_update_version` — the pending update's target version.
    public var updateVersion: String?
    /// `configData.software_update_download_pct` — 0…100 download progress.
    public var downloadPct: Double?
    /// `configData.software_update_install_pct` — 0…100 install progress.
    public var installPct: Double?
    /// `configData.software_update_expected_duration` — install estimate, minutes.
    public var expectedDurationMinutes: Double?
    /// `configData.software_update_scheduled_start` — pre-formatted schedule string.
    public var scheduledStart: String?

    public init(
        softwareVersion: String? = nil,
        updateVersion: String? = nil,
        downloadPct: Double? = nil,
        installPct: Double? = nil,
        expectedDurationMinutes: Double? = nil,
        scheduledStart: String? = nil
    ) {
        self.softwareVersion = softwareVersion
        self.updateVersion = updateVersion
        self.downloadPct = downloadPct
        self.installPct = installPct
        self.expectedDurationMinutes = expectedDurationMinutes
        self.scheduledStart = scheduledStart
    }
}

// MARK: - Update stage (web `updateStatus` useMemo)

/// The derived software-update stage — a faithful port of the web `updateStatus`
/// memo (`'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' |
/// 'installed'`). The SwiftUI tone/colour mapping lives in the view layer so this
/// stays Foundation-only.
public enum SoftwareStatusStage: String, Sendable, Equatable, CaseIterable {
    case upToDate
    case available
    case downloading
    case ready
    case installing
    case installed
}

// MARK: - Localizable reference (key + web English fallback)

/// A deferred string reference: the i18n key plus its web `t(key, default)`
/// English fallback. The adapter emits these (pure data) and the view resolves
/// them through the P1/S10 facade, so no English literal is baked into rendered
/// output and the projection stays testable without `NSLocalizedString`.
public struct SoftwareStatusText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }
}

// MARK: - Status chip (web `StatusBadgeSmall` → `<Badge variant dot>`)

/// The badge variant the web `StatusBadgeSmall` maps each stage to
/// (`success | info | warning | neutral`). Drives the chip tone in the view.
public enum SoftwareStatusBadgeVariant: String, Sendable, Equatable, CaseIterable {
    case success
    case info
    case warning
    case neutral
}

/// The status chip view-model (web `<Badge variant size="sm" dot>`): a localizable
/// label + its semantic variant (→ tone in the view).
public struct SoftwareStatusBadge: Sendable, Equatable {
    public var label: SoftwareStatusText
    public var variant: SoftwareStatusBadgeVariant

    public init(label: SoftwareStatusText, variant: SoftwareStatusBadgeVariant) {
        self.label = label
        self.variant = variant
    }
}

// MARK: - Progress bar (web `MetricBar`)

/// Which install-flow bar is showing (web's two `MetricBar` colours): the cyan
/// download bar or the violet install bar. The view maps the kind to a design
/// token so no raw hex lives in the rendered output.
public enum SoftwareStatusProgressKind: String, Sendable, Equatable {
    case downloading
    case installing
}

/// A labeled proportion bar (web `MetricBar`): which flow it represents, the fill
/// fraction (`0…1`, already clamped, web `Math.min(value / max, 1)`), the
/// pre-formatted percent readout (web `${pct}%`), and the localizable title.
public struct SoftwareStatusProgress: Sendable, Equatable {
    public var kind: SoftwareStatusProgressKind
    /// Fill fraction in `0...1` (web `Math.min((value / max) * 100, 100)` ÷ 100).
    public var fraction: Double
    /// Pre-formatted percent readout (web `${pct}%`), e.g. `"47%"`.
    public var percentText: String
    public var label: SoftwareStatusText

    public init(
        kind: SoftwareStatusProgressKind,
        fraction: Double,
        percentText: String,
        label: SoftwareStatusText
    ) {
        self.kind = kind
        self.fraction = fraction
        self.percentText = percentText
        self.label = label
    }
}

// MARK: - Projection (the merged view-model the view renders)

/// The fully-projected widget content — the single value the view switches over
/// (web compact headline + the current-version row + the update section with its
/// target version, progress bar, ready message, estimate, and schedule). Built
/// once by `SoftwareStatusProjectionBuilder` from the cached input.
public struct SoftwareStatusProjection: Sendable, Equatable {
    /// Whether a vehicle `state` resolved (web `state` truthiness). `false` is the
    /// resolved-but-empty "No software data" state.
    public var hasData: Bool
    /// Web `currentVersion = state?.software_version ?? '—'` with the display
    /// `{version || '—'}` fallback already applied (empty ⇒ `"—"`).
    public var currentVersion: String
    public var stage: SoftwareStatusStage
    /// The stage chip (web `StatusBadgeSmall`).
    public var statusBadge: SoftwareStatusBadge
    /// The pending update's target version (web `updateVersion`), narrowed to a
    /// non-empty string; `nil` ⇒ up to date, no update section.
    public var updateVersion: String?
    /// The download / install bar (web `MetricBar`); `nil` for every other stage.
    public var progress: SoftwareStatusProgress?
    /// Install estimate in minutes (web `expectedDuration`), present only when
    /// `> 0`. Rendered in the tall layout; kept for the a11y summary.
    public var expectedDurationMinutes: Double?
    /// Pre-formatted estimate readout (web `~${expectedDuration}`), e.g. `"~15"`.
    public var expectedDurationText: String?
    /// Scheduled-start string (web `scheduledStart`), narrowed to non-empty.
    public var scheduledStart: String?

    public init(
        hasData: Bool,
        currentVersion: String,
        stage: SoftwareStatusStage,
        statusBadge: SoftwareStatusBadge,
        updateVersion: String?,
        progress: SoftwareStatusProgress?,
        expectedDurationMinutes: Double?,
        expectedDurationText: String?,
        scheduledStart: String?
    ) {
        self.hasData = hasData
        self.currentVersion = currentVersion
        self.stage = stage
        self.statusBadge = statusBadge
        self.updateVersion = updateVersion
        self.progress = progress
        self.expectedDurationMinutes = expectedDurationMinutes
        self.expectedDurationText = expectedDurationText
        self.scheduledStart = scheduledStart
    }

    /// Whether the web "update section" renders (`updateVersion && stage !== 'up-to-date'`).
    /// `updateVersion` is non-nil iff the stage is not `.upToDate`, so this tracks it.
    public var showsUpdateSection: Bool {
        updateVersion != nil && stage != .upToDate
    }

    /// The resolved-but-empty projection (web `state` falsy ⇒ "No software data").
    public static let empty = SoftwareStatusProjection(
        hasData: false,
        currentVersion: "—",
        stage: .upToDate,
        statusBadge: SoftwareStatusBadge(
            label: SoftwareStatusText("widget.statusUpToDate", "Up to date"),
            variant: .success
        ),
        updateVersion: nil,
        progress: nil,
        expectedDurationMinutes: nil,
        expectedDurationText: nil,
        scheduledStart: nil
    )
}
