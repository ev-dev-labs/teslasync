//
//  StatusHeader.Adapter.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  The testable projection core: the cached DLQ list summary (total count + per-entry
//  `replayable` flags + the server `replay_enabled` flag) → the three view-ready summary
//  cards the web source renders. Reproduces
//  web/src/features/admin/components/dlq-inspector/StatusHeader.tsx exactly:
//    • Total entries — `fmtInt(data.count)` + "in dead-letter queue".
//    • Replayable    — `fmtInt(entries.filter(e => e.replayable).length)` + "parsed with source topic".
//    • Replay mode   — `enabled ? "Enabled" : "Disabled"` + "DLQ_REPLAY_ENABLED env".
//  Plus the `!enabled` warning-banner gate. All pure + dependency-free so the projection can be
//  unit-tested without a store, a bundle, or a rendered view. The em-dash sentinel backs the
//  defensive no-data fallback so a card is never a blank box.
//

import Foundation

// MARK: - Render phase (loading / empty / error / content)

/// The mutually-exclusive render branches the surface switches over. The web `StatusHeader` is
/// presentational (its parent `useDLQList` query owns loading / error), so these branches model
/// the parent lifecycle around the same three-card summary the web renders. `empty` is the
/// resolved DLQ with `count == 0` (the healthy "nothing dead-lettered" state).
public enum StatusHeaderPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Card value (web `StatCard` `value`)

/// The pre-resolved value a summary card renders. `text` is rendered verbatim (the grouped
/// integer the count cards bake via `fmtInt`, or the em-dash sentinel); `localized` is resolved
/// through the P1/S10 facade at render time (the `Enabled` / `Disabled` replay-mode value), so
/// the pure projection holds no bundle dependency and stays unit-testable.
public enum StatusHeaderCardValue: Equatable, Sendable {
    case text(String)
    case localized(key: String, fallback: String)
}

// MARK: - Card projection (web `StatCard`)

/// One projected summary card (web `<StatCard label value icon sublabel />`). Carries the
/// localization keys for its label + sublabel (web `t(key, default)`), the resolved value, and
/// the SF Symbol mapped from the web lucide icon.
public struct StatusHeaderCardItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let sublabelKey: String
    public let sublabelFallback: String
    public let value: StatusHeaderCardValue
    public let systemImage: String

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        sublabelKey: String,
        sublabelFallback: String,
        value: StatusHeaderCardValue,
        systemImage: String
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.sublabelKey = sublabelKey
        self.sublabelFallback = sublabelFallback
        self.value = value
        self.systemImage = systemImage
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection rules shared by the model and the views. No store, no bundle, no rendered
/// view — only value-typed inputs/outputs. Builds the three cards in the exact order, with the
/// exact values, sublabels, and icons the web source renders, plus the `replay_enabled` →
/// warning-banner gate and the `entries.filter(replayable)` count.
public enum StatusHeaderProjection {
    /// The em-dash rendered for a card when there is no resolved data, so the summary never
    /// renders a blank box. In practice the resolved-but-empty state carries real zeros
    /// (`count == 0`); the em-dash is the defensive nil-input fallback.
    public static let emDash = "—"

    /// Web `(data?.entries ?? []).filter((e) => e.replayable).length` — the count of entries
    /// whose `replayable` flag is true.
    public static func replayableCount(in replayableFlags: [Bool]) -> Int {
        replayableFlags.count(where: { $0 })
    }

    /// Projects the cached DLQ summary into the three view-ready cards. A `nil` `input` yields
    /// the three cards with the em-dash sentinel (the defensive no-data fallback); a resolved
    /// input (including `totalCount == 0`) yields the grouped counts + the localized replay mode.
    public static func cards(
        from input: StatusHeaderInput?,
        locale: Locale = Locale(identifier: "en-US")
    ) -> [StatusHeaderCardItem] {
        StatusHeaderCardSpec.all.map { spec in
            StatusHeaderCardItem(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                sublabelKey: spec.sublabelKey,
                sublabelFallback: spec.sublabelFallback,
                value: spec.value(input, locale),
                systemImage: spec.systemImage
            )
        }
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (no value
    /// yet). A resolved payload renders `content` when the queue has entries, `empty` when
    /// `count == 0`. A failure with cached data stays content/empty (the chip/banner flag
    /// staleness); a failure with no cached data shows the retryable error.
    public static func resolvePhase(_ status: StatusHeaderLoadStatus, input: StatusHeaderInput?) -> StatusHeaderPhase {
        switch status {
        case .loading:
            guard let input else { return .loading }
            return phaseForResolved(input)
        case .loaded:
            guard let input else { return .empty }
            return phaseForResolved(input)
        case let .failed(message):
            guard let input else { return .error(message) }
            return phaseForResolved(input)
        }
    }

    /// Whether the `!loading && !enabled` warning banner is shown — the web
    /// `{!loading && !enabled && <AlertBanner … />}` gate. The banner shows for any resolved
    /// state (content or empty) where the server reports replay disabled.
    public static func showsDisabledBanner(phase: StatusHeaderPhase, input: StatusHeaderInput?) -> Bool {
        guard let input else { return false }
        switch phase {
        case .content, .empty:
            return !input.replayEnabled
        case .loading, .error:
            return false
        }
    }

    private static func phaseForResolved(_ input: StatusHeaderInput) -> StatusHeaderPhase {
        input.totalCount == 0 ? .empty : .content
    }
}

// MARK: - Card specs (web `StatCard` call order)

/// The static description of one summary card: its identity + presentation metadata, plus the
/// closure that derives its pre-resolved value from the bound input. Kept private to the
/// projection but exposed via `all` so the count/order is a single source of truth.
struct StatusHeaderCardSpec {
    let id: String
    let labelKey: String
    let labelFallback: String
    let sublabelKey: String
    let sublabelFallback: String
    let systemImage: String
    let value: @Sendable (StatusHeaderInput?, Locale) -> StatusHeaderCardValue

    /// The three cards in the exact order + with the exact value, icon, and sublabel the web
    /// source passes to each `<StatCard>` (Total entries, Replayable, Replay mode).
    static let all: [StatusHeaderCardSpec] = [
        StatusHeaderCardSpec(
            id: "total",
            labelKey: "admin.dlq.stats.total",
            labelFallback: "Total entries",
            sublabelKey: "admin.dlq.stats.totalSub",
            sublabelFallback: "in dead-letter queue",
            systemImage: "tray.full",
            value: { input, locale in
                guard let input else { return .text(StatusHeaderProjection.emDash) }
                return .text(StatusHeaderNumberFormat.fmtInt(input.totalCount, locale: locale))
            }
        ),
        StatusHeaderCardSpec(
            id: "replayable",
            labelKey: "admin.dlq.stats.replayable",
            labelFallback: "Replayable",
            sublabelKey: "admin.dlq.stats.replayableSub",
            sublabelFallback: "parsed with source topic",
            systemImage: "checkmark.shield",
            value: { input, locale in
                guard let input else { return .text(StatusHeaderProjection.emDash) }
                return .text(StatusHeaderNumberFormat.fmtInt(input.replayableCount, locale: locale))
            }
        ),
        StatusHeaderCardSpec(
            id: "replayMode",
            labelKey: "admin.dlq.stats.replayMode",
            labelFallback: "Replay mode",
            sublabelKey: "admin.dlq.stats.replayModeSub",
            sublabelFallback: "DLQ_REPLAY_ENABLED env",
            systemImage: "exclamationmark.octagon",
            value: { input, _ in
                guard let input else { return .text(StatusHeaderProjection.emDash) }
                return input.replayEnabled
                    ? .localized(key: "admin.dlq.stats.enabled", fallback: "Enabled")
                    : .localized(key: "admin.dlq.stats.disabled", fallback: "Disabled")
            }
        )
    ]
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for a summary card. Pure + public so the spoken content can be
/// unit-tested without rendering. The label + sublabel resolve through the injected localizer
/// (bundle-free in tests); the spoken order mirrors the web DOM (label, value, sublabel)
/// collapsed to a single element.
public enum StatusHeaderAccessibility {
    public static func cardSummary(
        _ item: StatusHeaderCardItem,
        localize: (String, String) -> String
    ) -> String {
        let label = localize(item.labelKey, item.labelFallback)
        let sublabel = localize(item.sublabelKey, item.sublabelFallback)
        let value = resolvedValue(item.value, localize: localize)
        return "\(label), \(value), \(sublabel)"
    }

    /// Resolves a card value to its spoken text — the verbatim string, or the localized
    /// `Enabled` / `Disabled` term.
    public static func resolvedValue(
        _ value: StatusHeaderCardValue,
        localize: (String, String) -> String
    ) -> String {
        switch value {
        case let .text(text):
            text
        case let .localized(key, fallback):
            localize(key, fallback)
        }
    }
}
