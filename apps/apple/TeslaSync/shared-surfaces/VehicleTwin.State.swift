//
//  VehicleTwin.State.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The value-typed view-state for the VehicleTwin shared surface: the i18n facade (P1/S10), the P4
//  leaf connectivity + load axes, the render size (web `VehicleTwinSize`), the coalesced input
//  snapshot (the web `VehicleTwinProps` + `useVehiclePaint` inputs), and the resolved, fully-localized
//  view-state (the legend rows + content + phase). Pure value types — no SwiftUI, no networking — so
//  the projection + model stay unit-testable in isolation.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "VehicleTwin" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time. In test / preview bundles (where the table is absent)
/// `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum VehicleTwinStrings {
    public static let table = "VehicleTwin"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a positional-format key and substitutes the argument. The template is localized
    /// first, so translators control word order around the substituted value.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Connectivity (P4 leaf freshness axis, ADR-013)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip +
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum VehicleTwinConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Load status (mirrors the shared `LoadableState` cases)

/// The load lifecycle for the bound twin data, mirroring the shared `LoadableState` the production
/// source projects from `Resource<T>`. `loaded` with no vehicle in scope collapses to the empty
/// state; a failure with a cached vehicle keeps the twin visible behind the refresh affordance.
public enum VehicleTwinLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

// MARK: - Render size (web `VehicleTwinSize` `SIZE_MAP`)

/// The illustration scale — the native peer of the web `VehicleTwinSize` (`'sm' | 'md' | 'lg'`). The
/// `maxWidth` mirrors the web `SIZE_MAP`; `renderSize` maps onto the module renderer's two-step scale.
public enum VehicleTwinSize: String, Sendable, Equatable, CaseIterable {
    case small
    case medium
    case large

    /// Outer max width in points (web `SIZE_MAP` `{ sm: 300, md: 440, lg: 560 }`).
    public var maxWidth: Double {
        switch self {
        case .small: 300
        case .medium: 440
        case .large: 560
        }
    }

    /// The module renderer's coarse scale (`VehicleTwinView` accepts `.sm` / `.md`).
    public var renderSize: TwinRenderSize {
        self == .small ? .sm : .md
    }
}

// MARK: - Input snapshot (web props: VehicleTwinState + useVehiclePaint inputs)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web `VehicleTwinProps`
/// (the merged `VehicleTwinState`, the `vehicleId` / `exteriorColor` that feed `useVehiclePaint`, the
/// optional resolved paint `override`, and the `size` / `driveIn` / `interactive` render flags) plus
/// the P4 leaf load + connectivity axes. The view never fetches; the source pushes updated snapshots.
public struct VehicleTwinInput: Sendable, Equatable {
    public var loadStatus: VehicleTwinLoadStatus
    public var connection: VehicleTwinConnection
    public var state: VehicleTwinState
    public var vehicleID: Int?
    public var exteriorColor: String?
    public var paintOverride: VehicleTwinPaintID?
    public var size: VehicleTwinSize
    public var driveIn: Bool
    public var interactive: Bool
    public var updatedAt: Date?

    public init(
        loadStatus: VehicleTwinLoadStatus = .loaded,
        connection: VehicleTwinConnection = .live,
        state: VehicleTwinState = .empty,
        vehicleID: Int? = nil,
        exteriorColor: String? = nil,
        paintOverride: VehicleTwinPaintID? = nil,
        size: VehicleTwinSize = .medium,
        driveIn: Bool = false,
        interactive: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.loadStatus = loadStatus
        self.connection = connection
        self.state = state
        self.vehicleID = vehicleID
        self.exteriorColor = exteriorColor
        self.paintOverride = paintOverride
        self.size = size
        self.driveIn = driveIn
        self.interactive = interactive
        self.updatedAt = updatedAt
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// A semantic tone for a legend chip, mapped to the design tokens at the view boundary so the chips
/// keep status meaning consistent across paints (web `C` state-indicator intent).
public enum VehicleTwinTone: String, Sendable, Equatable {
    case neutral
    case info
    case success
    case warning
    case danger
}

/// One localized status-legend row — the always-visible, accessible native peer of the web hover
/// tooltips (`InteractiveHotspot` / `<title>`), so every subsystem's state is named, never hidden.
public struct VehicleTwinLegendItem: Sendable, Equatable, Identifiable {
    /// Stable subsystem identity (also the chip's ordering key).
    public enum Kind: String, Sendable, CaseIterable {
        case lock
        case doors
        case windows
        case frunkTrunk
        case charge
        case lights
        case turnSignal
        case sentry
        case seat
        case motion
    }

    public var id: Kind {
        kind
    }

    public let kind: Kind
    public let label: String
    public let value: String
    public let tone: VehicleTwinTone
    public let systemImage: String

    public init(kind: Kind, label: String, value: String, tone: VehicleTwinTone, systemImage: String) {
        self.kind = kind
        self.label = label
        self.value = value
        self.tone = tone
        self.systemImage = systemImage
    }
}

/// One per-region detail row — the native peer of a single web hover tooltip (`label: value`, e.g.
/// "Front driver window: Open"). Shown in the detail list when the surface is `interactive`.
public struct VehicleTwinRegionRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

/// The fully-resolved "content" view-state — every string already localized and every flag derived,
/// so the view is a pure function of this value. Carries the merged twin state for the illustration,
/// the resolved paint (web `useVehiclePaint`), the localized legend + VoiceOver summary, and the
/// last-updated caption.
public struct VehicleTwinContent: Sendable, Equatable {
    public let title: String
    public let figureAccessibilityLabel: String
    public let accessibilityHint: String
    public let state: VehicleTwinState
    public let paint: VehicleTwinPaintOption
    public let paintAccessibilityLabel: String
    public let size: VehicleTwinSize
    public let driveIn: Bool
    public let interactive: Bool
    public let legend: [VehicleTwinLegendItem]
    public let regions: [VehicleTwinRegionRow]
    public let stateSummary: String
    public let updatedText: String

    public init(
        title: String,
        figureAccessibilityLabel: String,
        accessibilityHint: String,
        state: VehicleTwinState,
        paint: VehicleTwinPaintOption,
        paintAccessibilityLabel: String,
        size: VehicleTwinSize,
        driveIn: Bool,
        interactive: Bool,
        legend: [VehicleTwinLegendItem],
        regions: [VehicleTwinRegionRow],
        stateSummary: String,
        updatedText: String
    ) {
        self.title = title
        self.figureAccessibilityLabel = figureAccessibilityLabel
        self.accessibilityHint = accessibilityHint
        self.state = state
        self.paint = paint
        self.paintAccessibilityLabel = paintAccessibilityLabel
        self.size = size
        self.driveIn = driveIn
        self.interactive = interactive
        self.legend = legend
        self.regions = regions
        self.stateSummary = stateSummary
        self.updatedText = updatedText
    }
}

/// The resolved view-state — `phase` selects the body, `content` carries the localized twin when a
/// vehicle is in scope.
public struct VehicleTwinResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch with no cached vehicle → skeleton chrome.
        case loading
        /// Resolved with no vehicle in scope → friendly empty state.
        case empty
        /// Initial fetch failed with no cached vehicle → retryable error.
        case error(String)
        /// A vehicle is in scope → the twin + legend.
        case content
    }

    public let phase: Phase
    public let content: VehicleTwinContent?

    public init(phase: Phase, content: VehicleTwinContent? = nil) {
        self.phase = phase
        self.content = content
    }
}
