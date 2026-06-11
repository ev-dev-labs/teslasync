//
//  SourceLayerBadge.Projection.swift
//  TeslaSync — P4 shared surface · 0105 · SourceLayerBadge (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web render (a tinted glyph + tooltip chosen from `source` + `ageMs`) wrapped in the P4 leaf
//  contract (loading / unavailable chrome around the resolved badge, plus the offline decoration).
//  The view is a pure function of this value; every branch is unit tested.
//

import Foundation

// MARK: - Source inputs (P1/S8 — the source feed + its fetch lifecycle)

/// One coalesced snapshot of the surface's inputs — the fetch lifecycle state, the raw source string
/// (the web `source` prop), the optional age in milliseconds (the web `ageMs` prop), and the P4
/// connectivity bit. The view binds the model over this; the resolved readout is a pure function of
/// it plus the static config.
public struct SourceLayerBadgeInput: Sendable, Equatable {
    public var status: SourceLayerBadgeFetchStatus
    public var source: String?
    public var ageMs: Double?
    public var offline: Bool

    public init(
        status: SourceLayerBadgeFetchStatus = .loading,
        source: String? = nil,
        ageMs: Double? = nil,
        offline: Bool = false
    ) {
        self.status = status
        self.source = source
        self.ageMs = ageMs
        self.offline = offline
    }
}

// MARK: - Static configuration (web non-data props)

/// The static presentation config — the web props that are not data. `showLabel` widens the badge's
/// minimum footprint (the web `showLabel ? 'min-w-[2.5rem]' : 'min-w-[1.5rem]'`); it defaults to the
/// web default (the narrow glyph).
public struct SourceLayerBadgeConfig: Sendable, Equatable {
    public var showLabel: Bool

    public init(showLabel: Bool = false) {
        self.showLabel = showLabel
    }

    public static let `default` = SourceLayerBadgeConfig()
}

// MARK: - Resolved view-state (web render output + P4 leaf contract)

/// The resolved badge readout — the layer, its localized glyph, its description, the optional age
/// label, and the composed tooltip (web `title`). Everything the chip needs to render with no further
/// string work.
public struct SourceLayerBadgeReadout: Sendable, Equatable {
    public let layer: SourceLayerBadgeKind
    public let label: String
    public let description: String
    public let ageText: String?
    public let tooltip: String

    public init(
        layer: SourceLayerBadgeKind,
        label: String,
        description: String,
        ageText: String?,
        tooltip: String
    ) {
        self.layer = layer
        self.label = label
        self.description = description
        self.ageText = ageText
        self.tooltip = tooltip
    }
}

/// The resolved, view-ready state — `phase` selects the rendered body while `offline` decorates the
/// ready badge with the connectivity marker (the cached value stays visible).
public struct SourceLayerBadgeResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Source feed still resolving (web parent has no value yet) → neutral skeleton chip.
        case loading
        /// Source feed failed → a neutral retry chip (the `QueryError` peer).
        case unavailable
        /// Feed resolved → the tinted glyph + tooltip (the unknown layer is the empty readout).
        case ready(SourceLayerBadgeReadout)
    }

    public let phase: Phase
    public let offline: Bool

    public init(phase: Phase, offline: Bool) {
        self.phase = phase
        self.offline = offline
    }

    /// The resolved layer when presenting a readout, else `nil` — a convenience the model uses to
    /// detect the transition into the `stale` layer that arms the one-shot auto-refresh.
    public var readyLayer: SourceLayerBadgeKind? {
        if case let .ready(readout) = phase { return readout.layer }
        return nil
    }
}

// MARK: - Projection (input + config + strings → resolved)

/// Pure projection from the input snapshot to the resolved view-state. The fetch status decides the
/// phase; when resolved, the source string decides the layer (the verbatim web `STYLE` lookup), the
/// `ageMs` decides the optional age label (the web `formatAge`), and the two compose the tooltip (the
/// web `desc (age: …)`). The offline bit rides through unchanged for the ready decoration.
public enum SourceLayerBadgeProjection {
    public static func resolve(
        _ input: SourceLayerBadgeInput,
        config _: SourceLayerBadgeConfig,
        strings: SourceLayerBadgeResolve
    ) -> SourceLayerBadgeResolved {
        let phase: SourceLayerBadgeResolved.Phase = switch input.status {
        case .loading:
            .loading
        case .failed:
            .unavailable
        case .resolved:
            .ready(readout(for: input, strings: strings))
        }
        return SourceLayerBadgeResolved(phase: phase, offline: input.offline)
    }

    private static func readout(
        for input: SourceLayerBadgeInput,
        strings: SourceLayerBadgeResolve
    ) -> SourceLayerBadgeReadout {
        let layer = SourceLayerBadgeKind(source: input.source)
        let description = layer.description(strings)
        let ageText = SourceLayerBadgeAgeFormatter.label(ms: input.ageMs, strings: strings)
        let tooltip = SourceLayerBadgeTooltipBuilder.tooltip(
            description: description,
            ageText: ageText,
            ageLabel: strings("sourceLayer.age", "age")
        )
        return SourceLayerBadgeReadout(
            layer: layer,
            label: layer.label(strings),
            description: description,
            ageText: ageText,
            tooltip: tooltip
        )
    }
}
