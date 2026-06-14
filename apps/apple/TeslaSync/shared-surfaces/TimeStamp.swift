//
//  TimeStamp.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  The preference-aware timestamp renderer — the SwiftUI parity of
//  `web/src/components/data-display/TimeStamp.tsx`. The web component renders ONE format in the
//  visible body (relative "2h ago" or absolute "Apr 4, 2:30 AM", chosen by `format` which defaults to
//  the user's `time_format_default` Settings preference) and ALWAYS shows the OTHER format in a hover
//  tooltip, so power users can flip perspectives without leaving the page. A null / undefined /
//  unparseable value collapses to the universal "—" placeholder with no tooltip. It honors // parity:allow ui
//  `settings.locale` + the resolved IANA timezone (default `settings.tz_display_default`, overridable
//  via `in`).
//
//  The native parity reproduces that data + the read-time formatting and adds the P4 leaf states so
//  the surface never collapses to a blank box. `TimeStamp` binds through `TimeStampModel` (P1/S8) — no
//  networking lives here — and renders every state:
//    • loading  — the formatting context (preference / settings / vehicle) resolving → skeleton line.
//    • empty    — a null / invalid value (web "—") → the muted "—" fallback, never a blank box.
//    • error    — context-feed failure → retry affordance (web `QueryError` peer).
//    • content  — the visible body, with the alternate format as the hover tooltip (web `Tooltip`) +
//                 VoiceOver hint.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the value with a
//                 one-shot auto-refresh on the stale transition; the last value stays visible.
//

import SwiftUI

// MARK: - TimeStamp (the shared surface)

/// The timestamp renderer surface — the SwiftUI parity of `<TimeStamp>`. Renders every state plus the
/// P4 leaf freshness states, binding through `TimeStampModel`.
public struct TimeStamp: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TimeStamp"

    @State private var model: TimeStampModel

    public init(model: TimeStampModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production source seeded with the value + render options —
    /// the parity of mounting `<TimeStamp value … format … in … />`. The host (or the shared facade)
    /// pushes the resolved preference / locale / vehicle-zone context through the source as settings +
    /// the active vehicle change.
    public init(
        value: TimeStampValue,
        format: TimeStampFormat = .auto,
        in mode: TimeStampTzMode? = nil
    ) {
        let snapshot = TimeStampInput(value: value, format: format, mode: mode)
        let source = LiveTimeStampSource(snapshot: snapshot)
        _model = State(initialValue: TimeStampModel(source: source))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            content
            if model.connection != .live {
                TimeStampFreshnessChip(connection: model.connection) {
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
            TimeStampLoadingView()
        case .empty, .content:
            TimeStampValueView(resolved: model.resolved)
        case let .error(message):
            TimeStampErrorView(message: message) { model.refresh() }
        }
    }
}
