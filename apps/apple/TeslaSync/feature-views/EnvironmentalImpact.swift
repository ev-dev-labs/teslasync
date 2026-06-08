//
//  EnvironmentalImpact.swift
//  TeslaSync — P4 feature view · 0112 · EnvironmentalImpact (Apple)
//
//  The SwiftUI parity of
//  web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx — a
//  presentational card that paints the CO₂-saved / tree-years / gallons /
//  metric-tons / dollars-saved figures derived from the charging cost analysis,
//  inside a green-glowing glass panel. It owns no data and performs no I/O (web
//  parity): the parent cost-analysis surface maps the shared S8 charging holder
//  into `EnvironmentalImpactData` and supplies the freshness. On appear it emits
//  the P1/S11 `view.opened` diagnostics event.
//
//  Every P4 state renders: `loading` (skeleton chrome), `empty` (the web "No
//  data" branch as a friendly empty state), `error` (message + retry), and
//  `loaded` (the full card, with the cached figures kept visible and the live
//  connection downgraded to a stale/offline chip when the freshness says so). No
//  surface is ever hidden behind a null check.
//

import SwiftUI

public struct EnvironmentalImpact: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        EnvironmentalImpactSurface.slug
    }

    private let state: EnvironmentalImpactState
    private let connection: EnvironmentalImpactConnection
    private let localize: EnvironmentalImpactLocalizer
    private let telemetry: any EnvironmentalImpactTelemetry
    private let locale: Locale
    private let onRetry: () -> Void

    /// Designated initialiser (explicit state — used by the load/empty/error
    /// callers and the previews/tests).
    public init(
        state: EnvironmentalImpactState,
        connection: EnvironmentalImpactConnection = .live,
        localize: EnvironmentalImpactLocalizer = .bundle,
        telemetry: any EnvironmentalImpactTelemetry = OSLogEnvironmentalImpactTelemetry(),
        locale: Locale = .current,
        onRetry: @escaping () -> Void = {}
    ) {
        self.state = state
        self.connection = connection
        self.localize = localize
        self.telemetry = telemetry
        self.locale = locale
        self.onRetry = onRetry
    }

    /// Web-parity convenience: the card for the resolved cost-analysis aggregate
    /// (web prop `coreStats: CoreStats | null`). A value renders the figures; its
    /// absence renders the "No data" empty branch.
    public init(
        coreStats: EnvironmentalImpactData?,
        connection: EnvironmentalImpactConnection = .live,
        localize: EnvironmentalImpactLocalizer = .bundle,
        telemetry: any EnvironmentalImpactTelemetry = OSLogEnvironmentalImpactTelemetry(),
        locale: Locale = .current,
        onRetry: @escaping () -> Void = {}
    ) {
        self.init(
            state: EnvironmentalImpactProjection.state(from: coreStats),
            connection: connection,
            localize: localize,
            telemetry: telemetry,
            locale: locale,
            onRetry: onRetry
        )
    }

    public var body: some View {
        content
            .task { EnvironmentalImpactSurface.reportOpen(to: telemetry) }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            loadingCard
        case .empty:
            emptyCard
        case let .error(message):
            errorCard(message)
        case let .loaded(data):
            loadedCard(data)
        }
    }

    // MARK: Loaded card (web card body)

    private func loadedCard(_ data: EnvironmentalImpactData) -> some View {
        let chip = EnvironmentalFreshnessChip.project(connection)
        let primary = EnvironmentalImpactProjection.primaryStats(data, locale: locale)
        let secondary = EnvironmentalImpactProjection.secondaryStats(data, locale: locale)
        let description = EnvironmentalImpactDescription.build(data, locale: locale, localize: localize)
        return TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                EnvironmentalImpactHeader(chip: chip, localize: localize)
                LazyVGrid(columns: twoColumns, spacing: TSSpacing.md) {
                    ForEach(primary) { stat in
                        EnvironmentalPrimaryTile(stat: stat, localize: localize)
                    }
                }
                EnvironmentalImpactDescriptionView(description: description)
                LazyVGrid(columns: threeColumns, spacing: TSSpacing.sm) {
                    ForEach(secondary) { stat in
                        EnvironmentalSecondaryStatView(stat: stat, localize: localize)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(greenGlow)
    }

    /// Web `glow="green"` — a soft success-tinted border on the glass panel.
    private var greenGlow: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .strokeBorder(Color.TS.statusSuccess.opacity(0.2), lineWidth: 1)
    }

    // MARK: Load / empty / error chrome (every state renders)

    private var loadingCard: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                EnvironmentalImpactHeader(chip: nil, localize: localize)
                LazyVGrid(columns: twoColumns, spacing: TSSpacing.md) {
                    TSSkeleton(height: 84, cornerRadius: TSRadius.md)
                    TSSkeleton(height: 84, cornerRadius: TSRadius.md)
                }
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                LazyVGrid(columns: threeColumns, spacing: TSSpacing.sm) {
                    TSSkeleton(height: 40, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 40, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 40, cornerRadius: TSRadius.sm)
                }
            }
        }
        .accessibilityLabel(Text(verbatim: localize.string(
            "costAnalysis.environment.loading",
            "Loading environmental impact…"
        )))
    }

    private var emptyCard: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                EnvironmentalImpactHeader(chip: nil, localize: localize)
                TSEmptyState(
                    title: LocalizedStringKey("costAnalysis.environment.noData"),
                    message: LocalizedStringKey("costAnalysis.environment.empty.message"),
                    systemImage: "leaf"
                )
                .frame(maxWidth: .infinity)
                .frame(minHeight: 128)
            }
        }
    }

    private func errorCard(_ message: String?) -> some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                EnvironmentalImpactHeader(chip: nil, localize: localize)
                TSErrorDisplay(
                    title: LocalizedStringKey("costAnalysis.environment.error.title"),
                    message: message.map { LocalizedStringKey($0) }
                        ?? LocalizedStringKey("costAnalysis.environment.error.message"),
                    onRetry: onRetry
                )
            }
        }
    }

    // MARK: Grid columns

    private var twoColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)
    }

    private var threeColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 3)
    }
}
