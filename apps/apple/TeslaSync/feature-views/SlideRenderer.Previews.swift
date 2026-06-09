//
//  SlideRenderer.Previews.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  #if DEBUG previews — every slide kind of the web deck (so the dispatch + gradient parity is
//  visible), the keyed transition, the load / empty / error chrome, the stale + offline freshness,
//  and the generic child-body seam (a custom renderer in place of the built-in default). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum SlideRendererPreview {
        /// The web `SLIDE_DEFS` deck (type + gradient `bg` + field), reproduced verbatim so the native
        /// gradients + dispatch match the source.
        static func deck() -> [SlideDefinitionInput] {
            [
                SlideDefinitionInput(type: "title", background: "from-blue-900 via-indigo-900 to-slate-900"),
                SlideDefinitionInput(
                    type: "stat-hero", field: "distance",
                    background: "from-emerald-900 via-green-900 to-teal-900"
                ),
                SlideDefinitionInput(
                    type: "stat-chart", field: "drives",
                    background: "from-purple-900 via-violet-900 to-indigo-900"
                ),
                SlideDefinitionInput(
                    type: "drive-highlight", field: "longest",
                    background: "from-amber-900 via-orange-900 to-yellow-900"
                ),
                SlideDefinitionInput(
                    type: "stat-hero", field: "energy",
                    background: "from-cyan-900 via-sky-900 to-blue-900"
                ),
                SlideDefinitionInput(
                    type: "charging-breakdown",
                    background: "from-orange-900 via-red-900 to-pink-900"
                ),
                SlideDefinitionInput(type: "savings", background: "from-emerald-900 via-teal-900 to-cyan-900"),
                SlideDefinitionInput(type: "environment", background: "from-green-900 via-emerald-900 to-lime-900"),
                SlideDefinitionInput(type: "patterns", background: "from-indigo-900 via-blue-900 to-violet-900"),
                SlideDefinitionInput(
                    type: "drive-highlight", field: "efficient",
                    background: "from-teal-900 via-cyan-900 to-sky-900"
                ),
                SlideDefinitionInput(type: "comparisons", background: "from-pink-900 via-rose-900 to-fuchsia-900"),
                SlideDefinitionInput(type: "summary", background: "from-blue-900 via-indigo-900 to-purple-900")
            ]
        }

        static func recap() -> YearReviewRecap {
            YearReviewRecap(
                year: 2026,
                vehicleName: "Model 3 Performance",
                totalDrives: 342,
                totalDistanceKm: 18450,
                totalEnergyKwh: 3120,
                totalChargeSessions: 96,
                gasSavings: 2480,
                co2OffsetKg: 1450,
                superchargerPct: 62,
                dcFastPct: 18,
                acOtherPct: 20,
                avgChargeStartSoc: 34,
                mostActiveDayOfWeek: "Saturday",
                mostActiveHour: 17,
                avgDrivesPerWeek: 6.6,
                longestDrive: YearReviewRecapDrive(
                    driveID: 1,
                    date: "2026-08-14",
                    distanceKm: 612,
                    durationMin: 374,
                    startAddress: "San Francisco, CA",
                    endAddress: "Los Angeles, CA",
                    efficiencyWhKm: 168
                ),
                mostEfficientDrive: YearReviewRecapDrive(
                    driveID: 2,
                    date: "2026-04-02",
                    distanceKm: 84,
                    durationMin: 96,
                    startAddress: "Palo Alto, CA",
                    endAddress: "San Jose, CA",
                    efficiencyWhKm: 121
                ),
                comparisons: [
                    YearReviewRecapComparison(label: "Around the Earth", value: "0.46×", emoji: "🌍"),
                    YearReviewRecapComparison(label: "Trees planted", value: "66", emoji: "🌳"),
                    YearReviewRecapComparison(label: "Movies of driving", value: "51", emoji: "🎬"),
                    YearReviewRecapComparison(label: "Phones charged", value: "412k", emoji: "⚡")
                ]
            )
        }

        static func loadedUpdate(
            index: Int = 0,
            connection: SlideRendererConnection = .live
        ) -> SlideRendererUpdate {
            SlideRendererUpdate(
                status: .loaded,
                connection: connection,
                slides: deck(),
                index: index,
                data: recap(),
                localeIdentifier: "en_US",
                updatedAt: Date()
            )
        }

        static func model(_ update: SlideRendererUpdate) -> SlideRendererModel {
            let source = InMemorySlideRendererSource(initial: update)
            let model = SlideRendererModel(source: source)
            model.start()
            return model
        }

        /// The renderer wired to its built-in default body, for one deck index.
        static func surface(index: Int = 0, connection: SlideRendererConnection = .live) -> some View {
            SlideRenderer(model: model(loadedUpdate(index: index, connection: connection)))
                .frame(width: 390, height: 560)
                .padding(TSSpacing.lg)
                .background(Color.TS.bg)
        }

        /// The renderer wired to a chrome-only update (loading / empty / error).
        static func chrome(_ status: SlideRendererLoadStatus) -> some View {
            SlideRenderer(model: model(SlideRendererUpdate(status: status, slides: deck())))
                .frame(width: 390, height: 560)
                .padding(TSSpacing.lg)
                .background(Color.TS.bg)
        }
    }

    /// A custom slide body standing in for the parent's child-surface renderer — shows that the generic
    /// seam composes any view over the renderer's gradient + transition (the production app injects the
    /// real TitleSlide / StatHeroSlide / … here).
    private struct CustomSlideBodyPreview: View {
        let context: SlideRenderContext

        var body: some View {
            VStack(spacing: TSSpacing.sm) {
                Text(verbatim: context.kind.rawType)
                    .font(Font.TS.title)
                    .foregroundStyle(.white)
                Text(verbatim: context.recap.vehicleName)
                    .font(Font.TS.body)
                    .foregroundStyle(.white.opacity(0.8))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    #Preview("Deck · title") { SlideRendererPreview.surface(index: 0) }
    #Preview("Deck · stat-hero distance") { SlideRendererPreview.surface(index: 1) }
    #Preview("Deck · stat-chart") { SlideRendererPreview.surface(index: 2) }
    #Preview("Deck · drive-highlight longest") { SlideRendererPreview.surface(index: 3) }
    #Preview("Deck · stat-hero energy") { SlideRendererPreview.surface(index: 4) }
    #Preview("Deck · charging-breakdown") { SlideRendererPreview.surface(index: 5) }
    #Preview("Deck · savings") { SlideRendererPreview.surface(index: 6) }
    #Preview("Deck · environment") { SlideRendererPreview.surface(index: 7) }
    #Preview("Deck · patterns") { SlideRendererPreview.surface(index: 8) }
    #Preview("Deck · drive-highlight efficient") { SlideRendererPreview.surface(index: 9) }
    #Preview("Deck · comparisons") { SlideRendererPreview.surface(index: 10) }
    #Preview("Deck · summary") { SlideRendererPreview.surface(index: 11) }

    #Preview("Freshness · stale") { SlideRendererPreview.surface(index: 0, connection: .stale) }
    #Preview("Freshness · offline") { SlideRendererPreview.surface(index: 3, connection: .offline) }

    #Preview("Chrome · loading") { SlideRendererPreview.chrome(.loading) }
    #Preview("Chrome · empty") { SlideRendererPreview.chrome(.empty) }
    #Preview("Chrome · error") { SlideRendererPreview.chrome(.failed("Network unavailable")) }

    #Preview("Seam · custom child body") {
        SlideRenderer(model: SlideRendererPreview.model(SlideRendererPreview.loadedUpdate(index: 2))) { context in
            CustomSlideBodyPreview(context: context)
        }
        .frame(width: 390, height: 560)
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }
#endif
