//
//  TeslaFeatureFlagsPage.swift
//  TeslaSync — P4 page · P7 · page:admin/TeslaFeatureFlags (Apple)
//
//  Native SwiftUI / HIG parity of web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx
//  (route `/tesla-features`). The web page is a thin `PageContainer` wrapper — a title +
//  subtitle header (`t('featureConfig.title')` / `t('featureConfig.subtitle')`, the
//  manifest's two parity strings) hosting the shared `<FeatureToggles />` surface. This
//  view reproduces that faithfully: the page-chrome header (web `PageContainer`) above the
//  hosted `FeatureToggles` surface, both bound through `TeslaFeatureFlagsPageModel`.
//  Adaptive across macOS (regular) and iOS (compact/regular) — the hosted surface lays out
//  its own responsive grid; the page just frames it (ADR-002/006). The hosted surface owns
//  every data state (loading / empty / error / stale / offline) through its own seam, so no
//  region renders blank (ADR-011).
//

import SwiftUI

// MARK: - TeslaFeatureFlagsPage (the page surface)

/// The Tesla Feature Flags page — the SwiftUI parity of `TeslaFeatureFlagsPage.tsx`.
/// Frames the hosted `FeatureToggles` surface with the web `PageContainer` title +
/// subtitle, binding through `TeslaFeatureFlagsPageModel`.
public struct TeslaFeatureFlagsPage: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TeslaFeatureFlagsPageModel.surfaceSlug

    @State private var model: TeslaFeatureFlagsPageModel

    public init(model: TeslaFeatureFlagsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                FeatureToggles(model: model.toggles)
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
            TSPageTitle(TeslaFeatureFlagsText.verbatim(model.title))
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
enum TeslaFeatureFlagsText {
    static func verbatim(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }
}

// MARK: - Previews

#if DEBUG
    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTeslaFeatureFlagsTelemetry: TeslaFeatureFlagsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op toast sink so the hosted surface's previews don't surface toasts.
    private struct SilentTeslaFeatureFlagsToast: FeatureTogglesToast {
        func success(message _: String) {}
        func error(message _: String, detail _: String?) {}
    }

    @MainActor
    private func teslaFeatureFlagsPreviewModel(_ update: FeatureTogglesUpdate) -> TeslaFeatureFlagsPageModel {
        let toggles = FeatureTogglesModel(
            source: InMemoryFeatureTogglesSource(initial: update),
            toast: SilentTeslaFeatureFlagsToast()
        )
        return TeslaFeatureFlagsPageModel(toggles: toggles, telemetry: SilentTeslaFeatureFlagsTelemetry())
    }

    private enum TeslaFeatureFlagsPreviewData {
        static let config: [String: FeatureConfigValue] = [
            "BIDIRECTIONAL_CHARGING": .object(["enabled": .bool(false)]),
            "ENDPOINTS": .object([
                "enabled": .bool(true),
                "VEHICLE_DATA": .string("api/1/vehicles/{id}/vehicle_data"),
                "max_calls": .number(200)
            ]),
            "MOBILE_ACCESS": .bool(true),
            "SCHEDULED_CHARGING": .number(0),
            "REGION": .string("NA")
        ]

        static var fetchedAt: Date {
            Date(timeIntervalSince1970: 1_775_000_000)
        }
    }

    #Preview("Tesla Feature Flags — Content") {
        TeslaFeatureFlagsPage(model: teslaFeatureFlagsPreviewModel(
            FeatureTogglesUpdate(
                status: .loaded,
                config: TeslaFeatureFlagsPreviewData.config,
                fetchedAt: TeslaFeatureFlagsPreviewData.fetchedAt
            )
        ))
        .teslaSyncTheme()
    }

    #Preview("Tesla Feature Flags — Empty") {
        TeslaFeatureFlagsPage(model: teslaFeatureFlagsPreviewModel(
            FeatureTogglesUpdate(status: .empty, config: [:])
        ))
        .teslaSyncTheme()
    }

    #Preview("Tesla Feature Flags — Loading") {
        TeslaFeatureFlagsPage(model: teslaFeatureFlagsPreviewModel(
            FeatureTogglesUpdate(status: .loading)
        ))
        .teslaSyncTheme()
    }
#endif
