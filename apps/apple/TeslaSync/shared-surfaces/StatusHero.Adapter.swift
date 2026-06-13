//
//  StatusHero.Adapter.swift
//  TeslaSync — P4 shared surface · 0199 · StatusHero (Apple)
//
//  The Foundation-only core for the large at-a-glance status card — the SwiftUI parity of
//  components/status/StatusHero.tsx. This file owns the surface identity (the diagnostics slug), the
//  status axis (``HeroStatus`` — the verbatim port of the web `HeroStatus` union), the props value type
//  (``StatusHeroInput``), the view-ready ``StatusHeroProjection``, and the pure ``StatusHeroProjector``
//  that resolves the headline (web `headline ?? cfg.defaultHeadline`), gates the live chip behind the
//  subline, picks the per-status glyph, and composes the VoiceOver label. No SwiftUI and no @Observable,
//  so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<StatusHero>` is a PURE presentational component. It maps a handful of
//  props — a status, an optional headline override, an optional subline, a `live` flag, and an optional
//  `cta` — onto an icon medallion + headline + subline + optional action button, with no fetch, no
//  React-Query cache, and no Promise. It therefore has NO loading, error, stale, or offline branch:
//  there is nothing to fetch, fail, age, or lose connectivity to (a host that owns such data passes the
//  resolved `status` in — `unknown` is the web's own "no answer yet" tier). Inventing such chrome would
//  fabricate states the source does not have, so this surface reproduces ONLY the source's REAL
//  branches, exactly as the sibling presentational primitives HealthRow (0197), InlineCallout (0124),
//  Accordion (0203), Delta (0081), and MetricCard (0095) did. The real, prop-driven branches are:
//    • status — healthy / degraded / unhealthy / unknown / maintenance (drives glyph, tint, glow).
//    • headline — the per-status default, or a caller override (web `headline ?? cfg.defaultHeadline`).
//    • subline present / absent — the web `{subline && …}` region; its absence ALSO hides the live chip,
//      because the web nests the live chip inside the subline block.
//    • live — the "Live" chip, shown only when a subline is present (web nesting, reproduced exactly).
//    • cta — an optional trailing action button with its own loading state (web `cta.loading`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum StatusHeroSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "StatusHero"
}

// MARK: - HeroStatus (web `HeroStatus` union)

/// The instance-health status — the verbatim port of the web `HeroStatus`
/// (`'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'`). It drives the medallion glyph,
/// the headline / ring / glow tint (mapped to the shared, theme-aware semantic tone tokens in
/// StatusHero.Views.swift, where the web used fixed Tailwind `*-400/500` hues), and the per-status
/// default headline. The raw values are byte-identical to the web union so a parity table can round-trip
/// them.
public enum HeroStatus: String, Sendable, Equatable, CaseIterable {
    /// All systems operational (web `healthy` → green / `CheckCircle`).
    case healthy
    /// Degraded performance (web `degraded` → amber / `AlertTriangle`).
    case degraded
    /// Service outage (web `unhealthy` → red / `XCircle`).
    case unhealthy
    /// Status unknown (web `unknown` → zinc / `HelpCircle`).
    case unknown
    /// Scheduled maintenance (web `maintenance` → blue / `Wrench`).
    case maintenance

    /// The medallion SF Symbol — the native peer of the web lucide glyph per status (`CheckCircle` →
    /// `checkmark.circle.fill`, `AlertTriangle` → `exclamationmark.triangle.fill`, `XCircle` →
    /// `xmark.circle.fill`, `HelpCircle` → `questionmark.circle.fill`, `Wrench` →
    /// `wrench.adjustable.fill`). Filled variants are used so the glyph reads at the medallion's size,
    /// the same visual weight the web's lucide icons carry inside the tinted ring.
    public var iconSystemName: String {
        switch self {
        case .healthy: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .unhealthy: "xmark.circle.fill"
        case .unknown: "questionmark.circle.fill"
        case .maintenance: "wrench.adjustable.fill"
        }
    }
}

// MARK: - StatusHeroInput (web props, closure-free)

/// The component's props — the native peer of `StatusHeroProps`, minus the `cta.onClick` closure (held
/// by the state-holder so the value stays `Equatable`). A value type so the view, the state-holder, and
/// the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply
/// when a reused hero rebinds (e.g. a new status, or a CTA toggling its loading flag).
public struct StatusHeroInput: Sendable, Equatable {
    /// The instance-health status (web `status`).
    public let status: HeroStatus
    /// An optional headline override (web `headline?`); `nil` falls back to the per-status default.
    public let headlineOverride: String?
    /// The optional sub-line beneath the headline (web `subline`); `nil` / empty hides the whole region
    /// AND the nested live chip.
    public let subline: String?
    /// Whether the "Live" chip shows (web `live`); only visible when a ``subline`` is present.
    public let isLive: Bool
    /// The optional CTA label (web `cta?.label`); `nil` renders no action button.
    public let ctaLabel: String?
    /// Whether the CTA is in its loading state (web `cta.loading`); spins the button and disables it.
    public let ctaIsLoading: Bool
    /// An optional stable identifier for in-page anchoring / UI-test targeting (web `id`).
    public let anchorID: String?

    public init(
        status: HeroStatus,
        headlineOverride: String? = nil,
        subline: String? = nil,
        isLive: Bool = false,
        ctaLabel: String? = nil,
        ctaIsLoading: Bool = false,
        anchorID: String? = nil
    ) {
        self.status = status
        self.headlineOverride = headlineOverride
        self.subline = subline
        self.isLive = isLive
        self.ctaLabel = ctaLabel
        self.ctaIsLoading = ctaIsLoading
        self.anchorID = anchorID
    }
}

// MARK: - StatusHeroProjection (view-ready)

/// The resolved, view-ready card — everything the SwiftUI body needs as a pure function of the props (no
/// networking, no derivation in the view). `headline` is the web `heading = headline ?? defaultHeadline`;
/// `subline` is the normalized (non-empty) sub-line, `nil` when the web `{subline && …}` region is
/// hidden; `showsLive` is the web `{subline && live && …}` nesting; `showsCTA` is the web `{cta && …}`;
/// `accessibilityLabel` is the composed VoiceOver line (the spoken peer of the web `role="status"`
/// region, which a sighted user reads from the colour + glyph + heading).
public struct StatusHeroProjection: Sendable, Equatable {
    /// The status driving the glyph, tint, and glow (web `status`).
    public let status: HeroStatus
    /// The medallion SF Symbol (web `cfg.icon`).
    public let iconSystemName: String
    /// The resolved headline (web `heading`).
    public let headline: String
    /// The normalized sub-line, or `nil` when the region is hidden (web `subline` truthiness).
    public let subline: String?
    /// Whether the "Live" chip renders (web `subline && live`).
    public let showsLive: Bool
    /// The CTA label, or `nil` when no action button renders (web `cta`).
    public let ctaLabel: String?
    /// Whether the CTA is in its loading state (web `cta.loading`).
    public let ctaIsLoading: Bool
    /// An optional stable identifier for in-page anchoring / UI-test targeting (web `id`).
    public let anchorID: String?
    /// The composed VoiceOver label for the status region.
    public let accessibilityLabel: String

    /// Whether the sub-line region renders (web `{subline && …}`).
    public var showsSubline: Bool {
        subline != nil
    }

    /// Whether the trailing action button renders (web `{cta && …}`).
    public var showsCTA: Bool {
        ctaLabel != nil
    }

    public init(
        status: HeroStatus,
        iconSystemName: String,
        headline: String,
        subline: String?,
        showsLive: Bool,
        ctaLabel: String?,
        ctaIsLoading: Bool,
        anchorID: String?,
        accessibilityLabel: String
    ) {
        self.status = status
        self.iconSystemName = iconSystemName
        self.headline = headline
        self.subline = subline
        self.showsLive = showsLive
        self.ctaLabel = ctaLabel
        self.ctaIsLoading = ctaIsLoading
        self.anchorID = anchorID
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - StatusHeroProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no
/// fetch, no clock) plus two injected resolvers (the P1/S10 facade — the per-status default headline and
/// the localized "Live" word) and derives the rendered card. Unit tested across every status, the
/// headline override, the subline-gated live chip, the CTA, and the composed VoiceOver label.
public enum StatusHeroProjector {
    /// Resolves the whole card. `defaultHeadline` resolves the localized per-status headline (web
    /// `cfg.defaultHeadline`); `liveLabel` resolves the localized "Live" word used in the VoiceOver
    /// label. Both are injected so the projector stays Foundation-only + facade-agnostic for tests.
    public static func resolve(
        _ input: StatusHeroInput,
        defaultHeadline: (HeroStatus) -> String,
        liveLabel: String
    ) -> StatusHeroProjection {
        let headline = resolvedHeadline(input, defaultHeadline: defaultHeadline)
        let subline = normalizedSubline(input.subline)
        let showsLive = input.isLive && subline != nil
        return StatusHeroProjection(
            status: input.status,
            iconSystemName: input.status.iconSystemName,
            headline: headline,
            subline: subline,
            showsLive: showsLive,
            ctaLabel: input.ctaLabel,
            ctaIsLoading: input.ctaIsLoading,
            anchorID: input.anchorID,
            accessibilityLabel: accessibilityLabel(
                headline: headline,
                subline: subline,
                liveLabel: showsLive ? liveLabel : nil
            )
        )
    }

    /// Resolves the headline — the verbatim port of the web `heading = headline ?? cfg.defaultHeadline`:
    /// a caller override wins, otherwise the per-status default. The override is taken as-is (matching
    /// the web `??`), trimmed only to reject a whitespace-only override that would render a blank title.
    public static func resolvedHeadline(
        _ input: StatusHeroInput,
        defaultHeadline: (HeroStatus) -> String
    ) -> String {
        guard let override = input.headlineOverride,
              !override.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return defaultHeadline(input.status)
        }
        return override
    }

    /// Normalizes the sub-line — the native peer of the web `{subline && …}` truthiness: a `nil` or
    /// whitespace-only sub-line collapses to `nil` so the region (and the nested live chip) hide.
    public static func normalizedSubline(_ subline: String?) -> String? {
        guard let subline,
              !subline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return nil
        }
        return subline
    }

    /// Composes the VoiceOver label as "{headline}" (plus ", {subline}" and ", {live}" when present) —
    /// the accessible parity of the web `role="status"` region, which a sighted user reads from the
    /// heading text, the colour-encoded status, and the glyph. The medallion glyph is decorative (web
    /// `aria-hidden`), so the status is conveyed by the heading words VoiceOver already reads.
    static func accessibilityLabel(headline: String, subline: String?, liveLabel: String?) -> String {
        var label = headline
        if let subline, !subline.isEmpty {
            label += ", \(subline)"
        }
        if let liveLabel, !liveLabel.isEmpty {
            label += ", \(liveLabel)"
        }
        return label
    }
}
