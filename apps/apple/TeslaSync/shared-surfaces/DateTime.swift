//
//  DateTime.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  The locale- + timezone-aware datetime renderer — the SwiftUI parity of
//  `web/src/components/data-display/format/DateTime.tsx`. The web component renders a timestamp in one
//  of five variants (full / date / time / relative / short), optionally in a chosen timezone (`in`)
//  with a trailing zone abbreviation (`showTz`), hovering the canonical ISO string; a null / invalid
//  value collapses to "—". It has two paths: the hook-free `PureDateTime` (browser locale + zone, for
//  table-heavy pages) and the provider-aware `DateTimeWithTz` that reads `useSettings()` +
//  `useTimezone()` (→ `useSelectedVehicle()` + `useSettings()`) to resolve the IANA zone + locale.
//
//  The native parity reproduces both paths and adds the P4 leaf states so the surface never collapses
//  to a blank box. `DateTime` is the provider path: it binds through `DateTimeModel` (P1/S8) — no
//  networking lives here — and renders every state:
//    • loading  — the formatting context (settings / vehicle) resolving → skeleton value line.
//    • empty    — a null / invalid value (web "—") → the muted "—" fallback, never a blank box.
//    • error    — context-feed failure → retry affordance (web `QueryError` peer).
//    • content  — the formatted value (+ optional zone abbreviation), with the canonical ISO instant
//                 as pointer help / VoiceOver hint (the web hover `title`).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the value with a
//                 one-shot auto-refresh on the stale transition; the last value stays visible.
//  `PureDateTimeView` is the hook-free path: device locale + zone, content / "—" only.
//

import SwiftUI

// MARK: - DateTime (provider path — the shared surface)

/// The datetime renderer surface — the SwiftUI parity of `<DateTimeWithTz>`. Renders every state plus
/// the P4 leaf freshness states, binding through `DateTimeModel`.
public struct DateTime: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DateTime"

    @State private var model: DateTimeModel

    public init(model: DateTimeModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production source seeded with the value + render options —
    /// the parity of mounting `<DateTime value … in … showTz />`. The host (or the shared facade)
    /// pushes the resolved locale / vehicle-zone context through the source as settings + the active
    /// vehicle change.
    public init(
        value: DateTimeValue,
        variant: DateTimeVariant = .full,
        in mode: TimeZoneMode? = nil,
        showTimeZone: Bool = false
    ) {
        let snapshot = DateTimeInput(value: value, variant: variant, mode: mode, showTimeZone: showTimeZone)
        let source = LiveDateTimeSource(snapshot: snapshot)
        _model = State(initialValue: DateTimeModel(source: source))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            content
            if model.connection != .live {
                DateTimeFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DateTimeLoadingView()
        case .empty, .content:
            DateTimeValueView(resolved: model.resolved)
        case let .error(message):
            DateTimeErrorView(message: message) { model.refresh() }
        }
    }
}

// MARK: - PureDateTimeView (web `PureDateTime` — hook-free path)

/// The hook-free renderer — the SwiftUI parity of the web `PureDateTime`. Uses the device locale +
/// zone, renders the formatted value or the muted "—" fallback, and has no loading / error /
/// freshness states because it subscribes to no feed (web parity: `PureDateTime` reads no hooks). Use
/// it on table-heavy pages where the provider-bound `DateTime` would be unnecessary overhead.
public struct PureDateTimeView: View {
    private let value: DateTimeValue
    private let variant: DateTimeVariant

    public init(value: DateTimeValue, variant: DateTimeVariant = .full) {
        self.value = value
        self.variant = variant
    }

    public var body: some View {
        DateTimeValueView(
            resolved: DateTimeProjection.pure(value: value, variant: variant, locale: Locale.current.identifier)
        )
    }
}
