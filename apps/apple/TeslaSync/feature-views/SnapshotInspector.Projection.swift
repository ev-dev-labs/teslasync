//
//  SnapshotInspector.Projection.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The pure render-decision core for the snapshot inspector — the faithful port of the
//  `SnapshotInspector.tsx` render body: the resolved row/content shapes, the `rows`
//  `useMemo`, the `copyPayload`, the duration cell, the `formatRelative` outside-window
//  message, and the top-level phase resolution (every web conditional branch widened into
//  an explicit phase so no state is ever a blank box). Foundation-only + unit-tested.
//

import Foundation

// MARK: - Resolved render inputs (web props)

/// The data the surface renders from — the native parity of the web `SnapshotInspector`
/// props (minus the load/connection envelope, which the model carries separately).
public struct SnapshotInspectorInput: Sendable, Equatable {
    public let fsmType: String
    public let transition: SnapshotTransition?
    public let snapshot: SnapshotSignalSet?
    public let previousSnapshot: SnapshotSignalSet?
    public let lastTransition: SnapshotTransition?
    public let inWindowCount: Int

    public init(
        fsmType: String,
        transition: SnapshotTransition? = nil,
        snapshot: SnapshotSignalSet? = nil,
        previousSnapshot: SnapshotSignalSet? = nil,
        lastTransition: SnapshotTransition? = nil,
        inWindowCount: Int = 0
    ) {
        self.fsmType = fsmType
        self.transition = transition
        self.snapshot = snapshot
        self.previousSnapshot = previousSnapshot
        self.lastTransition = lastTransition
        self.inWindowCount = inWindowCount
    }
}

/// One resolved signal row — the native parity of the web `rows` entry. `previousDisplay`
/// is the formatted prior value (when a previous snapshot carried this signal), surfaced as
/// the struck-through diff line in diff mode.
public struct SnapshotInspectorSignalRow: Sendable, Equatable, Identifiable {
    public let name: String
    public let valueDisplay: String
    public let source: SignalSourceLayer?
    public let ageMs: Double?
    public let changed: Bool
    public let previousDisplay: String?

    public var id: String {
        name
    }

    public init(
        name: String,
        valueDisplay: String,
        source: SignalSourceLayer?,
        ageMs: Double?,
        changed: Bool,
        previousDisplay: String?
    ) {
        self.name = name
        self.valueDisplay = valueDisplay
        self.source = source
        self.ageMs = ageMs
        self.changed = changed
        self.previousDisplay = previousDisplay
    }
}

/// The fully-resolved inputs the snapshot detail renders — the native parity of the web
/// render when a `transition` is selected.
public struct SnapshotInspectorContent: Sendable, Equatable {
    public let fsmType: String
    public let fromState: String
    public let toState: String
    public let triggerText: String
    public let durationText: String
    public let copyPayload: String
    public let rows: [SnapshotInspectorSignalRow]

    public init(
        fsmType: String,
        fromState: String,
        toState: String,
        triggerText: String,
        durationText: String,
        copyPayload: String,
        rows: [SnapshotInspectorSignalRow]
    ) {
        self.fsmType = fsmType
        self.fromState = fromState
        self.toState = toState
        self.triggerText = triggerText
        self.durationText = durationText
        self.copyPayload = copyPayload
        self.rows = rows
    }
}

/// The bound source's load status for the inspector data (web parent `useQuery` loading /
/// resolved / failure, folded with the web `loading` prop).
public enum SnapshotInspectorLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// What the surface renders at the top level. The web has four outcomes (loading, the
/// outside-window empty, the no-selection empty, and the populated snapshot); the Apple
/// surface adds the explicit error envelope so a fetch failure is never a blank box.
public enum SnapshotInspectorPhase: Sendable, Equatable {
    case loading
    case snapshot(SnapshotInspectorContent)
    case outsideWindow(relative: String)
    case noSelection
    case error(String)
}

// MARK: - Relative time (web `formatRelative`)

/// Formats an ISO timestamp as a coarse "time ago" — the faithful port of the web
/// `formatRelative`: "just now" under a minute, then m / h / d, each floored; an absent or
/// unparseable timestamp yields "—" and anything a week or older falls back to a medium
/// date. The magnitudes interpolate into P1/S10 templates so no literal lives here.
public enum SnapshotRelativeTime {
    public static func relative(
        fromISO iso: String?,
        now: Date,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        guard let iso, let date = parse(iso) else {
            return localize("debugger.inspector.dash", "—")
        }
        let seconds = Int(now.timeIntervalSince(date).rounded(.down))
        if seconds < 60 { return localize("debugger.inspector.justNow", "just now") }
        let minutes = seconds / 60
        if minutes < 60 { return token("debugger.inspector.minutesAgo", "{{n}}m ago", minutes, localize) }
        let hours = minutes / 60
        if hours < 24 { return token("debugger.inspector.hoursAgo", "{{n}}h ago", hours, localize) }
        let days = hours / 24
        if days < 7 { return token("debugger.inspector.daysAgo", "{{n}}d ago", days, localize) }
        return mediumDate(date, locale: locale)
    }

    static func parse(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }

    private static func mediumDate(_ date: Date, locale: Locale) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func token(
        _ key: String,
        _ fallback: String,
        _ magnitude: Int,
        _ localize: (String, String) -> String
    ) -> String {
        localize(key, fallback).replacingOccurrences(of: "{{n}}", with: String(magnitude))
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source's load status + the inspector input
/// to the top-level render phase + the resolved snapshot detail.
public enum SnapshotInspectorProjection {
    /// Resolves the render phase. A selected transition always renders the snapshot detail
    /// (web shows it regardless of the loading prop); otherwise loading shows first, a
    /// failure with no selection shows the error envelope, and a resolved selection-less
    /// state shows the outside-window jump affordance (web `inWindowCount === 0 &&
    /// lastTransition`) or the plain "select a transition" empty.
    public static func resolvePhase(
        status: SnapshotInspectorLoadStatus,
        input: SnapshotInspectorInput,
        now: Date,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> SnapshotInspectorPhase {
        if let transition = input.transition {
            return .snapshot(
                content(
                    fsmType: input.fsmType,
                    transition: transition,
                    snapshot: input.snapshot,
                    previousSnapshot: input.previousSnapshot,
                    localize: localize,
                    locale: locale
                )
            )
        }
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded:
            if input.inWindowCount == 0, let last = input.lastTransition {
                let relative = SnapshotRelativeTime.relative(
                    fromISO: last.ts, now: now, localize: localize, locale: locale
                )
                return .outsideWindow(relative: relative)
            }
            return .noSelection
        }
    }

    /// Builds the resolved snapshot detail for a selected transition (web render body).
    public static func content(
        fsmType: String,
        transition: SnapshotTransition,
        snapshot: SnapshotSignalSet?,
        previousSnapshot: SnapshotSignalSet?,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> SnapshotInspectorContent {
        SnapshotInspectorContent(
            fsmType: fsmType,
            fromState: transition.fromState,
            toState: transition.toState,
            triggerText: transition.trigger.isEmpty ? "—" : transition.trigger,
            durationText: durationText(ms: transition.durationInStateMs, localize: localize, locale: locale),
            copyPayload: copyPayload(transition: transition, snapshot: snapshot),
            rows: rows(snapshot: snapshot, previousSnapshot: previousSnapshot)
        )
    }

    /// Builds the sorted signal rows (web `rows` `useMemo`): one row per signal, the diff
    /// flag set when a previous snapshot carried a different canonical value, sorted by name
    /// (web `localeCompare`).
    public static func rows(
        snapshot: SnapshotSignalSet?,
        previousSnapshot: SnapshotSignalSet?
    ) -> [SnapshotInspectorSignalRow] {
        guard let snapshot else { return [] }
        let previous = previousSnapshot?.signals ?? [:]
        let hasPrevious = previousSnapshot != nil
        return snapshot.signals
            .map { name, entry -> SnapshotInspectorSignalRow in
                let previousEntry = previous[name]
                let changed = hasPrevious
                    && SnapshotValue.canonical(previousEntry?.value) != SnapshotValue.canonical(entry.value)
                return SnapshotInspectorSignalRow(
                    name: name,
                    valueDisplay: entry.value.display,
                    source: entry.source,
                    ageMs: entry.ageMs,
                    changed: changed,
                    previousDisplay: previousEntry.map(\.value.display)
                )
            }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    /// The duration cell (web `${fmtInt(duration_in_state_ms) ?? '—'} ms`): the grouped
    /// integer (or "—" when absent) followed by the "ms" unit, kept as a P1/S10 template.
    public static func durationText(
        ms: Double?,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let valuePart: String = if let ms, ms.isFinite {
            groupedInt(ms, locale: locale)
        } else {
            "—"
        }
        return localize("debugger.inspector.durationUnit", "{{value}} ms")
            .replacingOccurrences(of: "{{value}}", with: valuePart)
    }

    /// The copy payload (web `JSON.stringify({ transition, snapshot: signals, at }, null, 2)`),
    /// or empty when there is no transition or snapshot to copy. Signal keys are emitted in
    /// sorted order (matching the rendered row order) for a deterministic, faithful dump.
    public static func copyPayload(
        transition: SnapshotTransition?,
        snapshot: SnapshotSignalSet?
    ) -> String {
        guard let transition, let snapshot else { return "" }
        var top: [SnapshotMember] = [
            SnapshotMember("transition", transition.jsonValue),
            SnapshotMember("snapshot", signalsObject(snapshot.signals))
        ]
        if let at = snapshot.at {
            top.append(SnapshotMember("at", .string(at)))
        }
        return SnapshotValue.object(top).prettyJSON
    }

    static func signalsObject(_ signals: [String: SnapshotSignalEntry]) -> SnapshotValue {
        let members = signals.keys.sorted().compactMap { key -> SnapshotMember? in
            guard let entry = signals[key] else { return nil }
            return SnapshotMember(key, entry.jsonValue)
        }
        return .object(members)
    }

    /// Web `fmtInt` (= `fmtNumber(v, 0)`): a locale-grouped integer.
    static func groupedInt(_ value: Double, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.locale = locale
        return formatter.string(from: NSNumber(value: value)) ?? String(Int64(value.rounded()))
    }
}

// MARK: - Accessibility (VoiceOver)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so
/// the labels are testable without a bundle.
public enum SnapshotInspectorAccessibility {
    /// The snapshot detail's summary label — "Transition snapshot, {from} to {to}".
    public static func detailLabel(
        from: String,
        to: String,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("debugger.inspector.title", "Transition snapshot")
        let toWord = localize("debugger.inspector.a11y.to", "to")
        return "\(title), \(from) \(toWord) \(to)"
    }

    /// One signal row's VoiceOver label — "{name}, {value}", plus the source-layer
    /// description when present so the colour-coded badge is also spoken.
    public static func rowLabel(
        _ row: SnapshotInspectorSignalRow,
        localize: (String, String) -> String
    ) -> String {
        var label = "\(row.name), \(row.valueDisplay)"
        if let source = row.source {
            label += ", \(localize(source.descriptionKey, source.descriptionFallback))"
        }
        return label
    }
}
