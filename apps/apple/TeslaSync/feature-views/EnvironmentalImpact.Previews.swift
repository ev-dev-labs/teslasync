//
//  EnvironmentalImpact.Previews.swift
//  TeslaSync — P4 feature view · 0112 · EnvironmentalImpact (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: loaded (live) /
//  loaded (stale) / loaded (offline) / a zero-figures edge case / loading /
//  empty / error. Previews use the bundle-free `.echo` localizer so the English
//  copy renders without the folded catalog, a fixed `en_US` locale so the
//  formatted figures are stable, and a no-op retry so they are side-effect-free.
//

#if DEBUG
    import SwiftUI

    private enum EnvironmentalImpactPreview {
        static let locale = Locale(identifier: "en_US")

        static let sample = EnvironmentalImpactData(
            co2SavedKg: 1284.6,
            treeEquiv: 21.4,
            gallonsEquiv: 146.2,
            savings: 1830
        )

        static let zero = EnvironmentalImpactData(
            co2SavedKg: 0,
            treeEquiv: 0,
            gallonsEquiv: 0,
            savings: 0
        )

        static func card(
            _ state: EnvironmentalImpactState,
            connection: EnvironmentalImpactConnection = .live
        ) -> some View {
            EnvironmentalImpact(
                state: state,
                connection: connection,
                localize: .echo,
                telemetry: OSLogEnvironmentalImpactTelemetry(),
                locale: locale
            )
        }
    }

    #Preview("Loaded · live / stale / offline") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                EnvironmentalImpactPreview.card(.loaded(EnvironmentalImpactPreview.sample))
                EnvironmentalImpactPreview.card(
                    .loaded(EnvironmentalImpactPreview.sample),
                    connection: .stale
                )
                EnvironmentalImpactPreview.card(
                    .loaded(EnvironmentalImpactPreview.sample),
                    connection: .offline
                )
                EnvironmentalImpactPreview.card(.loaded(EnvironmentalImpactPreview.zero))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Chrome · loading / empty / error") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                EnvironmentalImpactPreview.card(.loading)
                EnvironmentalImpactPreview.card(.empty)
                EnvironmentalImpactPreview.card(.error(message: nil))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }
#endif
