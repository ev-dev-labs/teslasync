import SwiftUI

// The remaining panels for the Battery Health surface: the capacity-&-range new-vs-now panel
// (web GlassPanel19–23), the quick-links grid (web GlassPanel26), the recommendations panel
// (web GlassPanel27), and the loading skeleton (web `BatteryHealthSkeleton`). SI kilometres
// convert through the shared `Units` facade at this boundary; each panel renders its own
// empty state. The metric bars / summary cards / thermal / insights live in
// `BatteryHealthPage.Sections.swift`.

// MARK: - Capacity & range: new vs now (web GlassPanel19–23)

/// The new-vs-now panel (web GlassPanel19–23): the capacity-when-new / capacity-now (with the
/// lost-capacity delta) and range-when-new / range-now (with the lost-range delta) tiles. SI
/// kilometres convert at this boundary.
struct BatteryHealthNewVsNowSection: View {
    let data: BatteryHealthNewVsNow
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    private func km(_ value: Double) -> String {
        BatteryHealthFormat.integer((Units.convertDistance(value * 1000, units)).rounded())
    }

    private var rangeNew: String {
        data.rangeNewKm.map { "\(km($0)) \(units.distance)" } ?? BatteryHealthFormat.emptyValue
    }

    private var rangeNow: String {
        data.rangeNowKm.map { "\(km($0)) \(units.distance)" } ?? BatteryHealthFormat.emptyValue
    }

    private var rangeLost: String? {
        data.lostRangeKm.map { "-\(km($0)) \(units.distance) \(String(localized: "battery.newVsNow.lost"))" }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "waveform.path.ecg")
                        .foregroundStyle(TSChartPalette.color(at: 4))
                        .accessibilityHidden(true)
                    TSSectionTitle("battery.newVsNow.title")
                }
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    BatteryHealthNewVsNowCard(
                        label: "battery.newVsNow.capNew",
                        value: BatteryHealthFormat.kilowattHours(data.capNewKwh)
                    )
                    BatteryHealthNewVsNowCard(
                        label: "battery.newVsNow.capNow",
                        value: BatteryHealthFormat.kilowattHours(data.capNowKwh),
                        delta: "-\(BatteryHealthFormat.kilowattHours(data.lostCapacityKwh))",
                        valueColorIndex: 4
                    )
                    BatteryHealthNewVsNowCard(label: "battery.newVsNow.rangeNew", value: rangeNew)
                    BatteryHealthNewVsNowCard(
                        label: "battery.newVsNow.rangeNow",
                        value: rangeNow,
                        delta: rangeLost,
                        valueColorIndex: 2
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One new-vs-now tile (web inner `GlassPanel`): an uppercase label, a large value, and an
/// optional loss delta.
struct BatteryHealthNewVsNowCard: View {
    let label: LocalizedStringKey
    let value: String
    var delta: String?
    var valueColorIndex: Int?

    private var valueColor: Color {
        valueColorIndex.map { TSChartPalette.color(at: $0) } ?? Color.TS.textPrimary
    }

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.xs) {
                TSCaption(label)
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(valueColor)
                if let delta {
                    Text(verbatim: delta)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                }
            }
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Quick links (web GlassPanel26 — 6 navigation buttons)

/// One quick-link target (web `QUICK_LINKS` entry): the destination route + its label key.
struct BatteryHealthQuickLink: Identifiable {
    let id: String
    let route: AppRoute
    let label: LocalizedStringKey
}

/// The quick-links panel (web GlassPanel26): a grid of outline buttons to the related battery
/// surfaces. Each navigates to its real native route (web `/battery-cells`, `/battery-degradation`,
/// `/sleep-efficiency` map directly; `energy-flow` / `projected-range` / `vampire-drain` route to
/// their closest landed native hub so no button is a dead end — ADR-011).
struct BatteryHealthQuickLinksSection: View {
    let onNavigate: (AppRoute) -> Void

    private let columns = [GridItem(.adaptive(minimum: 170), spacing: TSSpacing.md)]

    private let links: [BatteryHealthQuickLink] = [
        BatteryHealthQuickLink(id: "cells", route: .batteryCells, label: "battery.links.cells"),
        BatteryHealthQuickLink(id: "degradation", route: .batteryDegradation, label: "battery.links.degradation"),
        BatteryHealthQuickLink(id: "energyFlow", route: .energy, label: "battery.links.energyFlow"),
        BatteryHealthQuickLink(id: "projectedRange", route: .energy, label: "battery.links.projectedRange"),
        BatteryHealthQuickLink(id: "vampireDrain", route: .sleepEfficiency, label: "battery.links.vampireDrain"),
        BatteryHealthQuickLink(id: "sleepEfficiency", route: .sleepEfficiency, label: "battery.links.sleepEfficiency")
    ]

    var body: some View {
        TSGlassPanel {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(links) { link in
                    TSButton(variant: .secondary, action: { onNavigate(link.route) }, label: {
                        HStack {
                            Text(link.label)
                            Spacer(minLength: TSSpacing.sm)
                            Image(systemName: "arrow.right")
                        }
                        .frame(maxWidth: .infinity)
                    })
                    .accessibilityLabel(Text(link.label))
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Recommendations (web GlassPanel27 — badge + tip list)

/// The recommendations panel (web GlassPanel27): a success badge over a bulleted list of the
/// derived longevity tips.
struct BatteryHealthRecommendationsSection: View {
    let tipKeys: [String]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSBadge("battery.recommendations.title", tone: .success)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(tipKeys, id: \.self) { key in
                        HStack(alignment: .top, spacing: TSSpacing.sm) {
                            Image(systemName: "lightbulb.fill")
                                .foregroundStyle(Color.TS.statusSuccess)
                                .accessibilityHidden(true)
                            Text(LocalizedStringKey(key))
                                .font(Font.TS.bodySm)
                                .foregroundStyle(Color.TS.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading skeleton (web BatteryHealthSkeleton)

/// Mirrors the page layout while the source loads (web `BatteryHealthSkeleton`): the hero, the
/// metric grids, the trend chart blocks, and the section panels, all under SwiftUI redaction
/// (the manifest's `loading → redacted`).
struct BatteryHealthSkeleton: View {
    private var reasons: RedactionReasons { .placeholder } // parity:allow redaction API, not a stub

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            block(height: 200)
            grid(count: 3, height: 96)
            grid(count: 6, height: 110)
            block(height: 280)
            block(height: 220)
            block(height: 240)
        }
        .redacted(reason: reasons)
        .accessibilityElement()
        .accessibilityLabel(Text("battery.title"))
    }

    private func grid(count: Int, height: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: height)
            }
        }
    }

    private func block(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}
