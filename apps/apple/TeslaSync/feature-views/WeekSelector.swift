//
//  WeekSelector.swift
//  TeslaSync — P4 feature view · 0079 · WeekSelector (Apple)
//
//  The composable Weekly Digest week selector — the SwiftUI parity of
//  features/analytics/components/weekly-digest/WeekSelector.tsx. A previous-week
//  button, the centered calendar + week-range label + `Current` badge, and a
//  next-week button (disabled on the current week), bound through
//  `WeekSelectorModel` (P1/S8). No networking lives here; the label is pure date
//  math (web `useMemo`) and the digest load status drives the loading / empty /
//  error / stale / offline chrome layered under the always-present bar. P1/S11
//  `view.opened` telemetry fires once on appear with slug "WeekSelector".
//

import SwiftUI

/// The composable Weekly Digest week selector — the SwiftUI parity of
/// `features/analytics/components/weekly-digest/WeekSelector.tsx`. Renders the
/// navigation bar in every state, never hiding it behind a null value, and
/// surfaces freshness (stale/offline) + the digest's loading/empty/error chrome
/// around it. The view binds through `WeekSelectorModel`; no networking lives here.
public struct WeekSelector: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "WeekSelector"

    @State private var model: WeekSelectorModel

    public init(model: WeekSelectorModel) {
        _model = State(initialValue: model)
    }

    /// The freshness banner shows only when the bound source is not live (a
    /// cached week is on screen to caption).
    private var showsConnectivityBanner: Bool {
        model.connection != .live
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if showsConnectivityBanner {
                    WeekSelectorConnectivityBanner(connection: model.connection)
                }
                WeekSelectorBar(
                    weekLabel: model.weekLabel,
                    isCurrentWeek: model.isCurrentWeek,
                    canGoToNextWeek: model.canGoToNextWeek,
                    onPrev: { model.goToPreviousWeek() },
                    onNext: { model.goToNextWeek() }
                )
                WeekSelectorStatusLine(phase: model.phase) { model.refresh() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}
