//
//  GasPriceAutoPollPage.swift
//  TeslaSync — P4 page · P7 · page:admin/GasPriceAutoPoll (Apple)
//
//  Native SwiftUI / HIG parity of web/src/features/admin/pages/GasPriceAutoPollPage.tsx
//  (route `/gas-price`). The web page is a thin `PageContainer` wrapper — a title +
//  subtitle header (`t('gas.title')` / `t('gas.subtitle')`, the manifest's two parity
//  strings) hosting the shared `<GasPriceSettings />` surface. This view reproduces that
//  faithfully: the page-chrome header (web `PageContainer`) above the hosted
//  `GasPriceSettings` surface, both bound through `GasPriceAutoPollPageModel`. Adaptive
//  across macOS (regular) and iOS (compact/regular) — the hosted surface lays out its own
//  responsive grid; the page just frames it (ADR-002/006). The hosted surface owns every
//  data state (loading / empty / error) through its own seam, so no region renders blank.
//

import SwiftUI

// MARK: - GasPriceAutoPollPage (the page surface)

/// The Gas Price Auto-Poll page — the SwiftUI parity of `GasPriceAutoPollPage.tsx`. Frames
/// the hosted `GasPriceSettings` surface with the web `PageContainer` title + subtitle,
/// binding through `GasPriceAutoPollPageModel`.
public struct GasPriceAutoPollPage: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = GasPriceAutoPollPageModel.surfaceSlug

    @State private var model: GasPriceAutoPollPageModel

    public init(model: GasPriceAutoPollPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                GasPriceSettings(model: model.settings)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Header (web `PageContainer` title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle(GasPriceAutoPollText.verbatim(model.title))
            Text(verbatim: model.subtitle)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - i18n SwiftUI bridge (already-resolved string → verbatim LocalizedStringKey)

/// Bridges a model-resolved `String` into the `LocalizedStringKey` the shared typography
/// components expect, rendering it verbatim (no second table lookup) — so the two parity
/// strings flow from the bound `@Observable` model into `LocalizedStringKey`-typed
/// parameters without any hardcoded literal.
enum GasPriceAutoPollText {
    static func verbatim(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }
}

// MARK: - Previews

#if DEBUG
    @MainActor
    private func gasPricePreviewModel(_ input: GasPriceSettingsInput) -> GasPriceAutoPollPageModel {
        let source = InMemoryGasPriceSettingsSource(initial: input)
        let settings = GasPriceSettingsModel(
            source: source,
            formatting: GasPriceFormatting(currencySymbol: "$", gasUnit: "gallon", decimals: 2)
        )
        return GasPriceAutoPollPageModel(settings: settings)
    }

    #Preview("Gas Price Auto-Poll — Running") {
        GasPriceAutoPollPage(model: gasPricePreviewModel(GasPriceSettingsInput(status: GasPriceRecord(
            enabled: true,
            pollInterval: .weekly,
            currentPrice: 3.45,
            lastPollTime: Date(timeIntervalSince1970: 1_775_000_000)
        ))))
        .teslaSyncTheme()
    }

    #Preview("Gas Price Auto-Poll — Stopped") {
        GasPriceAutoPollPage(model: gasPricePreviewModel(GasPriceSettingsInput(status: GasPriceRecord(
            enabled: false,
            pollInterval: .daily,
            currentPrice: 0,
            lastPollTime: nil
        ))))
        .teslaSyncTheme()
    }

    #Preview("Gas Price Auto-Poll — Loading") {
        GasPriceAutoPollPage(model: gasPricePreviewModel(GasPriceSettingsInput(isLoading: true)))
            .teslaSyncTheme()
    }
#endif
