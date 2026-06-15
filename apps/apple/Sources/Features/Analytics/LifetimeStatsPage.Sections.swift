import SwiftUI

// The hero banner, the four headline stat cards, the shared section header, the responsive grid
// helper, and the loading skeleton for the Lifetime Stats surface (web `LifetimeStatsPage.tsx`:
// GlassPanel1 hero + the Total-Drives/Distance/Energy/Savings StatCards). The six roll-up panels
// live in `LifetimeStatsPage.Panels.swift` + `LifetimeStatsPage.Records.swift`. Every value formats
// from raw SI via `LifetimeStatsFormat` at this display boundary.

// MARK: - Shared section header (web `<h2>` glyph + title)

/// A panel header: a tinted SF Symbol followed by the localized panel title (web's
/// `<h2 className="… flex items-center gap-2"><Icon/>{title}</h2>`).
struct LifetimeSectionHeader: View {
    let systemImage: String
    let tone: TSTone
    let title: LocalizedStringKey

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            TSPanelTitle(title)
        }
    }
}

// MARK: - Hero (web GlassPanel1 — total distance banner)

/// The hero banner (web first `GlassPanel`, centered): a car glyph, the all-time distance with its
/// unit, the "driven across N drives" subtitle, and — when present — the Earth-comparison and
/// "Tracking since …" lines. Always renders (zeros when there is no data yet).
struct LifetimeHeroSection: View {
    let stats: LifetimeStats?
    let units: UnitPreferences

    private var distanceValue: String {
        guard let stats else { return LifetimeStatsFormat.number(0, decimals: 0) }
        return LifetimeStatsFormat.distanceValue(stats.totalDistanceM, units, decimals: 0)
    }

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                    Image(systemName: "car.fill")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    Text(verbatim: distanceValue)
                        .font(Font.TS.display)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    Text(verbatim: LifetimeStatsFormat.distanceUnit(units))
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Text(verbatim: LifetimeStatsFormat.heroSubtitle(drives: stats?.totalDrives ?? 0))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                if let stats, stats.showsEarthComparison {
                    Text(verbatim: "🌎 \(LifetimeStatsFormat.earthCompare(circumferences: stats.earthCircumferences))")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.accent)
                        .multilineTextAlignment(.center)
                }
                if let stats, stats.showsSince {
                    Text(verbatim: LifetimeStatsFormat.since(
                        firstDriveDate: stats.firstDriveDate,
                        ownershipDays: stats.ownershipDays
                    ))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.md)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Key stats grid (web Total-Drives / Total-Distance / Total-Energy / Total-Savings cards)

/// The four headline stat cards (web `StatCard` grid, 2-up compact / 4-up regular). Always renders
/// (zero fallbacks), mirroring the web `stats?.field ?? 0`.
struct LifetimeKeyStatsSection: View {
    let stats: LifetimeStats?
    let units: UnitPreferences
    let isCompact: Bool

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            LifetimeStatCard(
                label: "lifetime.totalDrives",
                value: LifetimeStatsFormat.integer(Double(stats?.totalDrives ?? 0)),
                systemImage: "car.fill",
                tone: .accent,
                sublabel: drivingHoursSublabel
            )
            LifetimeStatCard(
                label: "lifetime.totalDistance",
                value: LifetimeStatsFormat.distanceValue(stats?.totalDistanceM ?? 0, units, decimals: 0),
                unit: LifetimeStatsFormat.distanceUnit(units),
                systemImage: "gauge.with.dots.needle.bottom.50percent",
                tone: .accent
            )
            LifetimeStatCard(
                label: "lifetime.totalEnergy",
                value: LifetimeStatsFormat.energyKWhValue(stats?.totalEnergyWh ?? 0, decimals: 1),
                unit: "kWh",
                systemImage: "bolt.fill",
                tone: .warning,
                sublabel: sessionsSublabel
            )
            LifetimeStatCard(
                label: "lifetime.totalSavings",
                value: LifetimeStatsFormat.currency(stats?.totalSavings ?? 0, decimals: 0),
                systemImage: "dollarsign.circle.fill",
                tone: .success,
                sublabel: AnyView(Text("lifetime.vsGas"))
            )
        }
    }

    /// Web Total-Drives sublabel `${fmtNumber(total_driving_hours, 1)} hrs`.
    private var drivingHoursSublabel: AnyView {
        let hours = LifetimeStatsFormat.hoursValue(stats?.totalDrivingSeconds ?? 0)
        return AnyView(
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: hours)
                Text("lifetime.hours")
            }
        )
    }

    /// Web Total-Energy sublabel `${fmtInt(total_charge_sessions)} sessions`.
    private var sessionsSublabel: AnyView {
        let sessions = LifetimeStatsFormat.integer(Double(stats?.totalChargeSessions ?? 0))
        return AnyView(
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: sessions)
                Text("lifetime.sessions")
            }
        )
    }
}

/// One headline stat (web `StatCard`): a muted label + tinted icon, the value with an optional
/// unit suffix, and a supporting sublabel.
struct LifetimeStatCard: View {
    let label: LocalizedStringKey
    let value: String
    var unit: String?
    let systemImage: String
    var tone: TSTone = .accent
    var sublabel: AnyView?

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(label)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: value)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let unit {
                        Text(verbatim: unit)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                if let sublabel {
                    sublabel
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Grid helper

/// Builds a fixed N-column grid (web responsive `Grid cols={{ default: 1, md: 3 }}` collapsed to
/// one column on compact width). Used by the Environmental + Records panels.
enum LifetimeGrid {
    static func columns(_ count: Int) -> [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: max(count, 1))
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the hero block, the
/// four stat cards, then the six panel blocks under SwiftUI redaction (the manifest's
/// `loading → redacted(reason:)` requirement).
struct LifetimeStatsSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonBlock(height: 150)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surfaceGlass)
                        .frame(height: 96)
                }
            }
            ForEach(0 ..< 6, id: \.self) { _ in
                skeletonBlock(height: 160)
            }
        }
        .lifetimeRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("lifetime.title"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func lifetimeRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
