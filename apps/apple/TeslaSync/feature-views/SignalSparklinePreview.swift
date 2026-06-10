//
//  SignalSparklinePreview.swift
//  TeslaSync — P4 feature view · 0271 · SignalSparklinePreview (Apple)
//
//  The last-hour mini-trend for one signal — the SwiftUI parity of
//  features/telemetry/components/SignalSparklinePreview.tsx. A compact inline surface
//  meant to sit in a `SignalCategoryTree` leaf's trailing slot: it switches over the
//  bound model's phase so every web branch renders — the `!enabled` gate (nothing),
//  the non-numeric `(kind)` chip, the loading skeleton, the "—" no-samples fallback,
//  and the Sparkline — plus the native error / stale / offline envelope. Binds through
//  `SignalSparklineModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The last-hour signal mini-trend — the SwiftUI parity of the web
/// `SignalSparklinePreview`, binding through `SignalSparklineModel` (P1/S8).
public struct SignalSparklinePreview: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SignalSparklineSurface.slug

    @State private var model: SignalSparklineModel

    public init(model: SignalSparklineModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// The phase branch, in the web source's evaluation order, widened with the native
    /// error envelope so no state is hidden. The `disabled` gate renders a zero-size
    /// clear surface (the web `!enabled` `return null`) while keeping the view host —
    /// and the once-only `view.opened` lifecycle — alive for when the parent enables
    /// the leaf.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .disabled:
            Color.clear
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        case let .nonNumeric(token):
            SignalSparklineKindChip(token: token, accessibilityText: model.accessibilitySummary)
        case .loading:
            SignalSparklineLoadingBox(
                width: CGFloat(model.width),
                height: CGFloat(model.height),
                accessibilityText: model.accessibilitySummary
            )
        case .empty:
            SignalSparklineEmptyDash(connection: model.connection, accessibilityText: model.accessibilitySummary)
        case .error:
            SignalSparklineErrorView { model.refresh() }
        case .content:
            SignalSparklineTrendView(
                values: model.values,
                colorIndex: model.colorIndex,
                width: CGFloat(model.width),
                connection: model.connection,
                accessibilityText: model.accessibilitySummary
            )
        }
    }
}
