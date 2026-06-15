import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/TeslaRegionPage.tsx`
/// (route `/tesla-region`). The web page is a thin `PageContainer` wrapper — a page
/// title + subtitle — around the shared `<RegionSettings />` (web
/// `features/settings/components/RegionSettings.tsx`). This reproduces that 1:1: the
/// web `PageContainer` chrome (title + subtitle) above the embedded `RegionSettings`,
/// which owns all of the data, the header refresh action, and every load state
/// (loading / data / empty / error / stale / offline) through its `@Observable`
/// `RegionSettingsModel` (P1/S8). No networking lives here — exactly like the web page,
/// which has no state of its own.
///
/// Adaptive (ADR-002/006): a single leading-aligned column inside a `ScrollView` that
/// fills the regular-width macOS/iPad canvas and the compact iPhone width alike; the
/// embedded panel lays its own region / Fleet-API-URL grid out adaptively. All copy
/// resolves from `Localizable.xcstrings` with the web key names — `region.title` →
/// `translation.region.title`, `region.subtitle` → `translation.region.subtitle` — so
/// there are zero hardcoded literals. The region code + Fleet API URL are SI-free
/// strings from the API, so no unit conversion applies on this surface (the shared SI
/// converters, P1/S5, format at the display boundary where units exist).
public struct TeslaRegionPage: View {
    @State private var model: RegionSettingsModel

    public init(model: RegionSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                RegionSettings(model: model)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.region.title")
            Text("translation.region.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
    /// A representative populated snapshot reused across the previews — the shared
    /// `RegionSettingsModel` (P1/S8) the embedded panel binds through.
    @MainActor
    private func regionPreviewModel(_ input: RegionSettingsInput) -> RegionSettingsModel {
        RegionSettingsModel(source: InMemoryRegionSettingsSource(initial: input))
    }

    private let regionPreviewRecord = RegionRecord(
        region: "na",
        fleetAPIBaseURL: "https://fleet-api.prd.na.vn.cloud.tesla.com",
        fetchedAt: Date(timeIntervalSince1970: 1_775_000_000)
    )

    #Preview("Content") {
        TeslaRegionPage(
            model: regionPreviewModel(RegionSettingsInput(config: regionPreviewRecord, connection: .live))
        )
        .teslaSyncTheme()
    }

    #Preview("Empty (no region)") {
        TeslaRegionPage(
            model: regionPreviewModel(
                RegionSettingsInput(config: RegionRecord(region: nil, fleetAPIBaseURL: nil, fetchedAt: nil))
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Loading") {
        TeslaRegionPage(model: regionPreviewModel(RegionSettingsInput(isLoading: true)))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        TeslaRegionPage(
            model: regionPreviewModel(RegionSettingsInput(errorMessage: "Network request timed out"))
        )
        .teslaSyncTheme()
    }
#endif
