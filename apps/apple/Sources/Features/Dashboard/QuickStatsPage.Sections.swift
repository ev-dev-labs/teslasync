import SwiftUI

// The Quick Stats building blocks (web `QuickStatsPage.tsx`): the vehicle header card
// (`GlassPanel1` — icon + name + "model · state", or the no-vehicle `EmptyState`), the four metric
// cards (Distance / Drives / Energy / Cost), the loading skeleton, and the footer ("Powered by
// TeslaSync · Open Dashboard"). The cards mirror the web `MetricCard` used WITHOUT an icon, so they
// render a muted label over a large primary value. Distance formats through the shared `Units`
// facade at the render boundary; energy is pinned to kWh and cost to currency exactly as the web
// hardcodes those labels — never a WKWebView, all SwiftUI-native.

// MARK: - Vehicle card (web `GlassPanel` → vehicle header or `EmptyState`)

/// The kiosk header card (web panel "GlassPanel1"): a tinted car glyph, the vehicle name (web
/// `display_name || 'Tesla'`), and the "model · connection" subtitle — or, when no vehicle resolves,
/// the localized no-vehicle `EmptyState` (web `!vehicle`). Never hidden; always shows one or the
/// other so the region is never blank.
struct QuickStatsPageVehicleCard: View {
    let vehicle: QuickStatsPageVehicle?
    let state: QuickStatsPageVehicleState?

    var body: some View {
        TSGlassPanel {
            if let vehicle {
                populated(vehicle)
            } else {
                TSEmptyState(title: "quickStats.noVehicle", systemImage: "car.fill")
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func populated(_ vehicle: QuickStatsPageVehicle) -> some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: "car.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .frame(width: 40, height: 40)
                .background(Color.TS.accent.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                nameText(vehicle)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: subtitle(vehicle))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// Web `vehicle.display_name || t('quickStats.defaultName')`.
    @ViewBuilder
    private func nameText(_ vehicle: QuickStatsPageVehicle) -> some View {
        if let name = vehicle.resolvedName {
            Text(verbatim: name)
        } else {
            Text("quickStats.defaultName")
        }
    }

    /// Web `${vehicle.model} · ${stateData?.state?.state ?? 'offline'}` — model + connection token,
    /// both rendered verbatim (data values, not UI prose).
    private func subtitle(_ vehicle: QuickStatsPageVehicle) -> String {
        let connection = state?.displayState ?? QuickStatsPageVehicleState.offlineSentinel
        return "\(vehicle.model) · \(connection)"
    }
}

// MARK: - Metric card (web `MetricCard` used without an icon — label + value)

/// One headline metric (web `MetricCard`): a muted label over a large primary value. The label is a
/// `Text` so the distance card's interpolated `{{unit}} Driven` and the localized Drives / Energy /
/// Cost labels compose the same way; the value is caller-formatted at the display boundary.
struct QuickStatsPageMetricCard: View {
    let label: Text
    let value: String

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                label
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                TSMetricValue(value)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Metric grid (web 4 MetricCards in `grid-cols-1 sm:grid-cols-2`)

/// The four headline metric cards (web manifest panels: unit-Driven / Drives / kWh-Used /
/// Total-Cost), reflowing 1↔2 columns like the web `grid-cols-1 sm:grid-cols-2`. Each value formats
/// at the render boundary: distance via the shared SI `Units` facade in the user's unit, energy as
/// kWh, cost as currency, drives as a bare count.
struct QuickStatsPageMetricGrid: View {
    let summary: QuickStatsPageSummary
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            QuickStatsPageMetricCard(
                label: Text(verbatim: distanceDrivenLabel),
                value: QuickStatsPageFormat.distanceDriven(summary.totalDistanceM, units)
            )
            QuickStatsPageMetricCard(
                label: Text("quickStats.drives"),
                value: QuickStatsPageFormat.drives(summary.totalDrives)
            )
            QuickStatsPageMetricCard(
                label: Text("quickStats.energy"),
                value: QuickStatsPageFormat.energyKWh(summary.totalEnergyWh)
            )
            QuickStatsPageMetricCard(
                label: Text("quickStats.cost"),
                value: QuickStatsPageFormat.currency(summary.totalCost)
            )
        }
    }

    /// Web `t('quickStats.distance', '{{unit}} Driven', { unit: unitPrefs.distance })` — the catalog
    /// template with the user's distance unit interpolated in (the i18next `{{unit}}` faithfully
    /// reproduced, like the sibling APIKeys `{{name}}` substitution).
    private var distanceDrivenLabel: String {
        String(localized: "quickStats.distance").replacingOccurrences(of: "{{unit}}", with: units.distance)
    }
}

// MARK: - Footer (web `{footer} · <Link>{openDashboard}</Link>`)

/// The kiosk footer (web `<p>… · <Link to="/">…</Link></p>`): the muted "Powered by TeslaSync"
/// caption and an accent "Open Dashboard" link wired to the shell.
struct QuickStatsPageFooter: View {
    let onOpenDashboard: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text("quickStats.footer")
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: "·")
                .foregroundStyle(Color.TS.textMuted)
            Button(action: onOpenDashboard) {
                Text("quickStats.openDashboard")
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
        }
        .font(Font.TS.caption)
        .multilineTextAlignment(.center)
    }
}

// MARK: - Loading skeleton (web `PageContainer loading` Skeleton)

/// Mirrors the kiosk layout while the vehicle list + summary load (web `loading` → `Skeleton`): the
/// header card block over a 2-column grid of stat-card skeletons, built from the shared shimmer
/// primitives (the manifest's `loading` state).
struct QuickStatsPageSkeleton: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            TSGlassPanel {
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 40, height: 40, cornerRadius: TSRadius.pill)
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        TSSkeleton(width: 130, height: 16)
                        TSSkeleton(width: 90, height: 10)
                    }
                    Spacer(minLength: 0)
                }
            }
            TSStatGridSkeleton(count: 4)
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text("quickStats.title"))
    }
}
