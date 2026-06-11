//
//  ChargingTab.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  The composable "Charging" analytics tab — the SwiftUI parity of
//  features/analytics/components/analytics/ChargingTab.tsx. Renders every state from the web
//  source (loading / content / empty / error / stale / offline), the six summary cards (sessions /
//  energy / cost / avg power / avg duration / charge efficiency) and the three charts (charger-
//  types donut / start-battery distribution / hourly pattern), bound through `ChargingTabModel`
//  (P1/S8). No networking lives here; the freshness chip + banner reflect the bound source's live
//  state and every visible string resolves through the P1/S10 facade.
//
//  Scope: the web component also composes `<ChargingDetailSection data={data} />` below these
//  panels. That is a sibling feature-view surface with its own P4 prompt (0053, already shipped as
//  `ChargingDetailSection.*`) and its own i18n keys; this surface owns only the six summary cards +
//  three chart panels enumerated by this prompt's extracted titles/keys. The composition order is
//  preserved (cards → charts → detail section) so the sibling slots in below these panels at
//  integration time — matching the sibling DrivingTab precedent, which likewise omits its siblings.
//
//  Parity note: the web "empty" disposition is NOT a hidden surface — the six cards always render
//  (showing zeros / em dashes) and each chart renders its own per-series empty row. So a resolved-
//  but-empty payload is `.content`, never a blank box (covenant #4).
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension ChargingTabStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly localized) value is
    /// never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ChargingTab (the feature surface)

/// The composable Charging analytics tab — the SwiftUI parity of
/// `features/analytics/components/analytics/ChargingTab.tsx`, binding through `ChargingTabModel`
/// (P1/S8). No networking lives here.
public struct ChargingTab: View {
    @State private var model: ChargingTabModel

    public init(model: ChargingTabModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(ChargingTabStrings.text("analytics.charging.a11ySurface", "Charging analytics"))
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ChargingTabLoadingPanels()
        case let .error(message):
            ChargingTabErrorState(message: message) { model.refresh() }
        case .content:
            loadedContent
        }
    }
}

// MARK: - Header

private extension ChargingTab {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            ChargingTabFreshnessChip(connection: model.connection)
        }
    }

    @ViewBuilder var connectivityBanner: some View {
        if model.connection != .live {
            ChargingTabConnectivityBanner(connection: model.connection)
        }
    }
}

// MARK: - Content (web `FadeIn` → summary grid + three chart panels)

private extension ChargingTab {
    var loadedContent: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                freshnessHeader
                connectivityBanner
                ChargingTabSummaryGrid(
                    metrics: model.projection.summary,
                    localize: model.localize,
                    formatting: model.formatting
                )
                ChargingTabChargerTypesPanel(
                    slices: model.projection.chargerTypes,
                    localize: model.localize,
                    formatting: model.formatting
                )
                ChargingTabBatteryDistPanel(
                    bars: model.projection.batteryDist,
                    localize: model.localize
                )
                ChargingTabHourlyPanel(
                    points: model.projection.hourly,
                    scale: model.projection.hourlyScale,
                    localize: model.localize,
                    formatting: model.formatting
                )
            }
        }
    }
}
