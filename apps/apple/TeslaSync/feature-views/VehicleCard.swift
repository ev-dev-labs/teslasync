//
//  VehicleCard.swift
//  TeslaSync — P4 feature view · 0302 · VehicleCard (Apple)
//
//  The SwiftUI parity of web/src/features/vehicles/components/VehicleCard.tsx — a
//  single fleet vehicle row inside a glass panel: the cyan→purple→green accent
//  strip, the `TeslaCarViz` body, the name + status block, the live stats
//  (battery ring + range, interior temperature, odometer, charging power, and the
//  locked / sentry markers), and the trailing actions (View details / Remove
//  vehicle). It binds through `VehicleCardModel` (P1/S8) and performs no I/O; on
//  appear it emits the P1/S11 `view.opened` diagnostics event.
//
//  Every P4 state renders: `loading` (skeleton chrome), `empty` (friendly empty
//  card), `error` (message + retry), and `content` (the full card) — with the
//  live stream's stale/offline freshness surfaced as a chip over the cached card.
//  No surface is ever hidden behind a null check.
//

import SwiftUI

public struct VehicleCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        VehicleCardSurface.slug
    }

    @State private var model: VehicleCardModel
    private let actions: VehicleCardActions
    private let localize: VehicleCardLocalizer

    public init(
        model: VehicleCardModel,
        actions: VehicleCardActions,
        localize: VehicleCardLocalizer = .bundle
    ) {
        _model = State(initialValue: model)
        self.actions = actions
        self.localize = localize
    }

    public var body: some View {
        TSFadeIn(delay: 0.04) {
            card
                .overlay(alignment: .top) {
                    VehicleCardGradientStrip()
                        .clipShape(
                            .rect(topLeadingRadius: TSRadius.lg, topTrailingRadius: TSRadius.lg)
                        )
                }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var card: some View {
        switch model.phase {
        case .loading:
            loadingCard
        case .empty:
            emptyCard
        case let .error(message):
            errorCard(message)
        case .content:
            contentCard
        }
    }

    // MARK: Content (the loaded card body)

    @ViewBuilder
    private var contentCard: some View {
        if let data = model.data, let vehicle = model.vehicle {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    if let chip = VehicleCardFreshnessChip.project(model.connection) {
                        HStack {
                            Spacer(minLength: 0)
                            VehicleCardFreshnessChipView(chip: chip, localize: localize)
                        }
                    }
                    HStack(alignment: .top, spacing: TSSpacing.md) {
                        VehicleCardCarViz(data: data, localize: localize)
                        VStack(alignment: .leading, spacing: TSSpacing.md) {
                            VehicleCardInfoHeader(
                                data: data,
                                localize: localize,
                                onViewDetails: actions.onViewDetails
                            )
                            statsArea(for: data)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        VehicleCardActionsColumn(
                            data: data,
                            vehicle: vehicle,
                            localize: localize,
                            actions: actions
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .contain)
        }
    }

    /// The stats row when a live snapshot exists, or the awaiting-state line when
    /// the vehicle has resolved but no live telemetry has arrived yet — the section
    /// is always shown, never hidden behind a null check.
    @ViewBuilder
    private func statsArea(for data: VehicleCardData) -> some View {
        if let live = data.live {
            VehicleCardStatsRow(live: live, localize: localize)
        } else {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "antenna.radiowaves.left.and.right.slash")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: localize.string("card.awaitingState", "Awaiting live telemetry"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .accessibilityElement(children: .combine)
        }
    }

    // MARK: Load / empty / error chrome (every state renders)

    private var loadingCard: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSSkeleton(width: 64, height: 48, cornerRadius: TSRadius.md)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 180, height: 16)
                    TSSkeleton(width: 240, height: 12)
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(width: 80, height: 32, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 60, height: 32, cornerRadius: TSRadius.sm)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityLabel(Text(verbatim: localize.string("card.loading", "Loading vehicle…")))
    }

    private var emptyCard: some View {
        TSGlassPanel {
            TSEmptyState(
                title: LocalizedStringKey("card.empty.title"),
                message: LocalizedStringKey("card.empty.message"),
                systemImage: "car"
            )
            .frame(maxWidth: .infinity)
        }
    }

    private func errorCard(_ message: String?) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: LocalizedStringKey("card.error.title"),
                message: message.map { LocalizedStringKey($0) } ?? LocalizedStringKey("card.error.message"),
                onRetry: actions.onRetry
            )
        }
    }
}
