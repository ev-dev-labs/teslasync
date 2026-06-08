//
//  WhyEndedPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  The testable projection core for the Drive Detail "Why did this drive end?"
//  diagnostic panel — the SwiftUI parity of
//  features/driving/components/drive-detail/WhyEndedPanel.tsx. Everything here is
//  pure + Foundation-only (no store, no bundle, no rendered view) so the FSM-row /
//  signal-row projection, the `fsm: from → to` title composition, the i18next
//  `trigger: {{trigger}}` interpolation, the ISO-8601 timestamp parsing + absolute
//  formatting, the web `DataTable` pagination math, and the VoiceOver summaries are
//  all unit tested in isolation and proven by an executed host harness (gate log).
//
//  The view never decodes transport; the production source projects the shared
//  `useDriveWhyEnded` query `Resource<DriveDiagnosticResponse>` into these value
//  types (P1/S8) and the model turns them into the display projection.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The diagnostics surface slug shared by the view (`WhyEndedPanel.surfaceSlug`)
/// and the model's `view.opened` telemetry. Kept here, dependency-free, so the
/// model is testable without the SwiftUI view type.
public enum WhyEndedPanelSurface {
    public static let slug = "WhyEndedPanel"
}

// MARK: - Diagnostic window (web `DriveDiagnosticWindow`)

/// The diagnostic windows the server accepts (web `WINDOWS`, validated
/// server-side ∈ {30s, 60s, 5m, 15m} — anything else is 400). `CaseIterable`
/// preserves the web option order; `.s60` is the web default.
public enum DriveDiagnosticWindow: String, CaseIterable, Sendable, Equatable {
    case s30 = "30s"
    case s60 = "60s"
    case m5 = "5m"
    case m15 = "15m"

    /// The web default window (`useState<DriveDiagnosticWindow>('60s')`).
    public static let `default`: DriveDiagnosticWindow = .s60
}

// MARK: - Raw diagnostic records (web `DriveDiagnosticTransition` / `…Signal`)

/// One FSM transition record — the native mirror of the web
/// `DriveDiagnosticTransition` fields the panel reads (`id`, `ts`, `fsm_name`,
/// `from_state`, `to_state`, `trigger`). `details_json` is intentionally omitted:
/// the panel never renders it, so it is not carried across the seam.
public struct DriveDiagnosticTransitionData: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let timestampRaw: String
    public let fsmName: String
    public let fromState: String
    public let toState: String
    public let trigger: String

    public init(
        id: Int64,
        timestampRaw: String,
        fsmName: String,
        fromState: String,
        toState: String,
        trigger: String
    ) {
        self.id = id
        self.timestampRaw = timestampRaw
        self.fsmName = fsmName
        self.fromState = fromState
        self.toState = toState
        self.trigger = trigger
    }
}

/// One signal-window record — the native mirror of the web `DriveDiagnosticSignal`
/// (`ts`, `field`, `value`). `value` is the server pre-rendered display string
/// (`typed_value` via `renderTypedValue`), so the view shows it verbatim.
public struct DriveDiagnosticSignalData: Equatable, Sendable {
    public let timestampRaw: String
    public let field: String
    public let value: String

    public init(timestampRaw: String, field: String, value: String) {
        self.timestampRaw = timestampRaw
        self.field = field
        self.value = value
    }
}

// MARK: - Display rows (the projection the view renders)

/// A display-ready FSM transition row. `title` is the composed `fsm: from → to`
/// (web mono span); `triggerValue` is the raw trigger or the em-dash sentinel
/// (web `tx.trigger || '—'`); `timestampText` is the absolute, locale-aware time
/// (web `new Date(tx.ts).toLocaleString()`). `id` is the stable FSM transition id.
public struct WhyEndedTransitionRow: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let title: String
    public let triggerValue: String
    public let timestampText: String
    public let timestamp: Date?

    public init(
        id: Int64,
        title: String,
        triggerValue: String,
        timestampText: String,
        timestamp: Date?
    ) {
        self.id = id
        self.title = title
        self.triggerValue = triggerValue
        self.timestampText = timestampText
        self.timestamp = timestamp
    }
}

/// A display-ready signal row: the absolute timestamp, the field name, and the
/// pre-rendered value (both web mono). `id` mirrors the web `keyExtractor`
/// (`${ts}-${field}-${idx}`): `ts+field` is not unique on busy vehicles, so the
/// array index is spliced in to keep row identity stable.
public struct WhyEndedSignalRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let timestampText: String
    public let field: String
    public let value: String
    public let timestamp: Date?

    public init(
        id: String,
        timestampText: String,
        field: String,
        value: String,
        timestamp: Date?
    ) {
        self.id = id
        self.timestampText = timestampText
        self.field = field
        self.value = value
        self.timestamp = timestamp
    }
}

/// The unfiltered projection produced from a resolved diagnostic response: the
/// derived FSM-transition rows + the derived signal rows. The model renders the
/// transitions in a timeline and paginates the signals, mirroring the web shell.
public struct WhyEndedPanelProjection: Equatable, Sendable {
    public let transitions: [WhyEndedTransitionRow]
    public let signals: [WhyEndedSignalRow]

    public init(transitions: [WhyEndedTransitionRow], signals: [WhyEndedSignalRow]) {
        self.transitions = transitions
        self.signals = signals
    }

    /// Whether either feed has any row (keeps cached content visible behind a
    /// refresh / failure, so the spinner only shows on the cold initial load).
    public var hasData: Bool {
        !transitions.isEmpty || !signals.isEmpty
    }

    /// An empty projection (no transitions, no signals).
    public static let empty = WhyEndedPanelProjection(transitions: [], signals: [])
}

// MARK: - Formatting (web title compose + `{{trigger}}` + `<TimeStamp>`)

/// Pure formatting helpers mirroring the web display expressions. No SwiftUI, no
/// bundle — every helper is deterministic (locale / now injected) so the XCTest
/// suite and the executed host harness can prove parity without rendering.
public enum WhyEndedPanelFormat {
    /// The em-dash the web renders for an absent value (`?? '—'`, `|| '—'`).
    public static let emDash = "—"

    /// The arrow joining the FSM states (web `{from_state} → {to_state}`).
    public static let stateArrow = "→"

    /// Composes the timeline row title — the Swift port of the web
    /// `{tx.fsm_name}: {tx.from_state} → {tx.to_state}` mono span.
    public static func transitionTitle(fsmName: String, fromState: String, toState: String) -> String {
        "\(fsmName): \(fromState) \(stateArrow) \(toState)"
    }

    /// The trigger display value — web `tx.trigger || '—'`: a non-empty trigger
    /// verbatim, else the em-dash.
    public static func triggerValue(_ trigger: String) -> String {
        trigger.isEmpty ? emDash : trigger
    }

    /// Interpolates the i18next `trigger: {{trigger}}` template with the trigger
    /// display value, exactly as react-i18next substitutes `{{trigger}}`.
    public static func interpolateTrigger(template: String, trigger: String) -> String {
        template.replacingOccurrences(of: "{{trigger}}", with: triggerValue(trigger))
    }

    /// Parses an ISO-8601 timestamp (with or without fractional seconds),
    /// mirroring the web `new Date(ts)` / `Date.parse`. `nil` for blank/invalid.
    public static func parseTimestamp(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    /// Absolute, locale-aware "Apr 4, 2026, 2:30 AM" rendering for a row's time
    /// (web `<TimeStamp format="absolute">` / `Date.toLocaleString()`). A
    /// missing/unparseable timestamp renders the em-dash, never a blank cell.
    public static func absolute(from date: Date?, locale: Locale = .current) -> String {
        guard let date else { return emDash }
        return date.formatted(.dateTime.locale(locale).year().month().day().hour().minute())
    }
}

// MARK: - Builder (web `transitions.map` / `keyedSignals` projection)

/// Pure builders that turn resolved diagnostic records into display rows. Mirrors
/// the web `transitions.map((tx) => …)` timeline items and the `keyedSignals`
/// index-spliced `DataTable` rows.
public enum WhyEndedPanelBuilder {
    /// Projects one FSM transition into a timeline row (title + trigger + time).
    public static func transitionRow(
        from data: DriveDiagnosticTransitionData,
        locale: Locale = .current
    ) -> WhyEndedTransitionRow {
        let timestamp = WhyEndedPanelFormat.parseTimestamp(data.timestampRaw)
        return WhyEndedTransitionRow(
            id: data.id,
            title: WhyEndedPanelFormat.transitionTitle(
                fsmName: data.fsmName,
                fromState: data.fromState,
                toState: data.toState
            ),
            triggerValue: WhyEndedPanelFormat.triggerValue(data.trigger),
            timestampText: WhyEndedPanelFormat.absolute(from: timestamp, locale: locale),
            timestamp: timestamp
        )
    }

    /// Projects one signal record into a row, splicing the array `index` into the
    /// id so re-emitted `ts+field` pairs keep stable identity (web `keyExtractor`).
    public static func signalRow(
        from data: DriveDiagnosticSignalData,
        index: Int,
        locale: Locale = .current
    ) -> WhyEndedSignalRow {
        let timestamp = WhyEndedPanelFormat.parseTimestamp(data.timestampRaw)
        return WhyEndedSignalRow(
            id: "\(data.timestampRaw)-\(data.field)-\(index)",
            timestampText: WhyEndedPanelFormat.absolute(from: timestamp, locale: locale),
            field: data.field,
            value: data.value,
            timestamp: timestamp
        )
    }

    /// Builds the full projection from a resolved response's two feeds.
    public static func buildProjection(
        transitions: [DriveDiagnosticTransitionData],
        signals: [DriveDiagnosticSignalData],
        locale: Locale = .current
    ) -> WhyEndedPanelProjection {
        WhyEndedPanelProjection(
            transitions: transitions.map { transitionRow(from: $0, locale: locale) },
            signals: signals.enumerated().map { index, data in
                signalRow(from: data, index: index, locale: locale)
            }
        )
    }
}

// MARK: - Pagination (web `DataTable` pagination contract)

/// Pure pagination math for the signal table — the web `DataTable` pagination
/// (`defaultPageSize: 25`, `pageSizeOptions: [25, 50, 100]`). Page indices are
/// zero-based; out-of-range pages clamp so the slice is always valid.
public enum WhyEndedSignalPaging {
    /// Web `pagination.defaultPageSize`.
    public static let defaultPageSize = 25
    /// Web `pagination.pageSizeOptions`.
    public static let pageSizeOptions = [25, 50, 100]

    /// The number of pages for `total` rows at `pageSize` (≥ 1, so the footer
    /// always reads "1 of 1" rather than "1 of 0" for a non-empty single page).
    public static func pageCount(total: Int, pageSize: Int) -> Int {
        guard total > 0, pageSize > 0 else { return 1 }
        return Int((Double(total) / Double(pageSize)).rounded(.up))
    }

    /// Clamps a requested page index into `[0, pageCount - 1]`.
    public static func clamp(page: Int, total: Int, pageSize: Int) -> Int {
        let last = pageCount(total: total, pageSize: pageSize) - 1
        return min(max(page, 0), max(last, 0))
    }

    /// The slice of `rows` on `page` at `pageSize` (clamped; empty in → empty out).
    public static func page<Row>(_ rows: [Row], page: Int, pageSize: Int) -> [Row] {
        guard pageSize > 0, !rows.isEmpty else { return [] }
        let safePage = clamp(page: page, total: rows.count, pageSize: pageSize)
        let start = safePage * pageSize
        guard start < rows.count else { return [] }
        let end = min(start + pageSize, rows.count)
        return Array(rows[start ..< end])
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the panel's rows + counts. Pure + public so
/// the spoken content is asserted without rendering the view.
public enum WhyEndedPanelAccessibility {
    /// One FSM row's combined label: the composed title, the localized
    /// `trigger: …` subtitle, then the absolute timestamp.
    public static func transitionRowLabel(for row: WhyEndedTransitionRow, subtitle: String) -> String {
        [row.title, subtitle, row.timestampText].joined(separator: ", ")
    }

    /// One signal row's combined label, in column order: timestamp, field, value.
    public static func signalRowLabel(for row: WhyEndedSignalRow) -> String {
        [row.timestampText, row.field, row.value].joined(separator: ", ")
    }

    /// The signal table's spoken count summary (`format` is the localized
    /// "%lld signals" template).
    public static func signalCountSummary(_ count: Int, format: String) -> String {
        String(format: format, count)
    }
}
