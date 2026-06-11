//
//  KpiOverviewCard.Projection.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  The pure projection from the input snapshot to the resolved, view-ready state, plus the
//  accessibility helpers — split from the model for the lint length budget. Everything here is
//  deterministic and resolves its copy through the injected `KpiOverviewResolve` seam (P1/S10), so the
//  rendered composition and every render branch is asserted without a view or a bundle. The web
//  `KpiOverviewCard` is a presentational shell that always renders the header + the KPI grid (with the
//  optional secondary / footer gated by `&&`); the native parity keeps that composition as the
//  `content` phase and layers the P4 leaf contract the web pure render has no concept of: a loading
//  skeleton, a friendly empty state when the grid has no tiles, an error tile with retry, and the
//  orthogonal freshness axis. The header always resolves so the shell never collapses to a blank box.
//

import Foundation

// MARK: - Resolved header (web `<ComparisonHeader>`)

/// The view-ready header — the title, the composed period strip (current + optional comparison), the
/// spoken period label, and the headline delta (only surfaced in the `content` phase, mirroring the
/// web page computing it from the fetched numbers).
public struct KpiOverviewResolvedHeader: Sendable, Equatable {
    public let title: String
    /// The period strip, e.g. "Last 30 days · vs prior 30 days" (web current + " · " + comparison).
    public let periodText: String
    /// The spoken period label (same text; a dedicated field keeps the view a pure projection.)
    public let periodAccessibilityLabel: String
    /// The headline delta + its spoken label, present only in `content`.
    public let delta: KpiOverviewDelta?
    public let deltaAccessibilityLabel: String?

    public init(
        title: String,
        periodText: String,
        periodAccessibilityLabel: String,
        delta: KpiOverviewDelta?,
        deltaAccessibilityLabel: String?
    ) {
        self.title = title
        self.periodText = periodText
        self.periodAccessibilityLabel = periodAccessibilityLabel
        self.delta = delta
        self.deltaAccessibilityLabel = deltaAccessibilityLabel
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the body region; the header always resolves so the
/// shell keeps its frame across every phase. For `content` the items / secondary / footer are carried
/// through; the other phases swap the body region for the leaf chrome.
public struct KpiOverviewResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch — the grid renders as skeleton tiles under the header.
        case loading
        /// Data resolved with no tiles — a friendly empty state (never a blank box).
        case empty
        /// Feed failure — an error tile with a retry affordance (web `QueryError` peer).
        case error(String)
        /// The web happy path — header + KPI grid + optional secondary + optional footer.
        case content
    }

    public let phase: Phase
    public let header: KpiOverviewResolvedHeader
    public let items: [KpiOverviewItem]
    public let secondary: String?
    public let footer: KpiOverviewCallout?
    public let connection: KpiOverviewConnection

    public init(
        phase: Phase,
        header: KpiOverviewResolvedHeader,
        items: [KpiOverviewItem],
        secondary: String?,
        footer: KpiOverviewCallout?,
        connection: KpiOverviewConnection
    ) {
        self.phase = phase
        self.header = header
        self.items = items
        self.secondary = secondary
        self.footer = footer
        self.connection = connection
    }

    /// `true` only in the `content` phase — a convenience for tests + previews.
    public var isContent: Bool {
        phase == .content
    }

    /// A header-only chrome state (loading / empty / error) — the body region renders leaf chrome and
    /// no tiles / secondary / footer are carried. Used before any host snapshot arrives.
    static func chrome(phase: Phase, connection: KpiOverviewConnection) -> KpiOverviewResolved {
        KpiOverviewResolved(
            phase: phase,
            header: KpiOverviewResolvedHeader(
                title: "",
                periodText: "",
                periodAccessibilityLabel: "",
                delta: nil,
                deltaAccessibilityLabel: nil
            ),
            items: [],
            secondary: nil,
            footer: nil,
            connection: connection
        )
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `KpiOverviewCard` body. Unit tested across the leaf contract (error > loading > empty > content),
/// the header composition (period strip with / without the comparison label, the headline delta gated
/// to `content`), and the secondary / footer pass-through.
public enum KpiOverviewProjection {
    public static func resolve(
        _ input: KpiOverviewInput,
        strings: KpiOverviewResolve = KpiOverviewStrings.string
    ) -> KpiOverviewResolved {
        let header = resolveHeader(input: input, isContent: contentEligible(input), strings: strings)

        // P4 contract: a feed failure surfaces at the leaf as `error`, ahead of any content.
        if let message = input.errorMessage, !message.isEmpty {
            return state(.error(message), header: header, input: input, carryContent: false)
        }
        // Initial fetch of the numbers (web parent loading) → skeleton grid under the header.
        if input.isLoading {
            return state(.loading, header: header, input: input, carryContent: false)
        }
        // Data resolved with no tiles → friendly empty state (never a blank box).
        guard !input.items.isEmpty else {
            return state(.empty, header: header, input: input, carryContent: false)
        }
        // Web happy path — header + KPI grid + optional secondary + optional footer.
        return state(.content, header: header, input: input, carryContent: true)
    }

    /// Whether the snapshot resolves to the `content` phase (so the headline delta is surfaced).
    private static func contentEligible(_ input: KpiOverviewInput) -> Bool {
        (input.errorMessage?.isEmpty ?? true) && !input.isLoading && !input.items.isEmpty
    }

    private static func state(
        _ phase: KpiOverviewResolved.Phase,
        header: KpiOverviewResolvedHeader,
        input: KpiOverviewInput,
        carryContent: Bool
    ) -> KpiOverviewResolved {
        KpiOverviewResolved(
            phase: phase,
            header: header,
            items: carryContent ? input.items : [],
            secondary: carryContent ? normalized(input.secondary) : nil,
            footer: carryContent ? input.footer : nil,
            connection: input.connection
        )
    }

    private static func resolveHeader(
        input: KpiOverviewInput,
        isContent: Bool,
        strings: KpiOverviewResolve
    ) -> KpiOverviewResolvedHeader {
        let header = input.header
        let period = periodStrip(current: header.currentLabel, comparison: header.comparisonLabel)
        let delta = isContent ? header.delta : nil
        let deltaLabel = delta.map { KpiOverviewAccessibility.deltaLabel($0, strings: strings) }
        return KpiOverviewResolvedHeader(
            title: header.title,
            periodText: period,
            periodAccessibilityLabel: period,
            delta: delta,
            deltaAccessibilityLabel: deltaLabel
        )
    }

    /// Composes the period strip — "current · comparison" when a comparison label is present, else just
    /// the current label (web renders the "·" separator + the comparison span only when supplied).
    static func periodStrip(current: String, comparison: String?) -> String {
        guard let comparison, !comparison.isEmpty else { return current }
        return "\(current) \(KpiOverviewMeta.periodSeparator) \(comparison)"
    }

    /// Trims a secondary line to `nil` when blank, so an empty string never renders an empty muted row
    /// (web gates the secondary block on a truthy value).
    private static func normalized(_ secondary: String?) -> String? {
        guard let secondary else { return nil }
        let trimmed = secondary.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : secondary
    }
}

// MARK: - Accessibility (labels)

/// Pure accessibility-label builders — kept here so the spoken copy is unit tested directly (the
/// "a11y label test") and the views stay declarative. All copy resolves through the injected facade.
public enum KpiOverviewAccessibility {
    /// One KPI tile read as a single phrase, e.g. "Drives, 4".
    public static func itemLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }

    /// A delta read with its direction, e.g. "Up 5%" / "Down 5%" / "No change". The good/bad meaning
    /// is conveyed by VoiceOver direction wording; colour is the visual-only channel.
    public static func deltaLabel(_ delta: KpiOverviewDelta, strings: KpiOverviewResolve) -> String {
        if delta.value == 0 {
            return strings("kpiOverview.delta.none", "No change")
        }
        let key = delta.value > 0 ? "kpiOverview.delta.up" : "kpiOverview.delta.down"
        let word = strings(key, delta.value > 0 ? "Up" : "Down")
        return "\(word) \(delta.formatted)"
    }

    /// The footer callout read with its severity, e.g. "Warning: 1 anomaly in this range".
    public static func calloutLabel(_ callout: KpiOverviewCallout, strings: KpiOverviewResolve) -> String {
        let toneKey = "kpiOverview.callout.\(callout.tone.rawValue)"
        let toneWord = strings(toneKey, callout.tone.rawValue.capitalized)
        return "\(toneWord): \(callout.message)"
    }
}
