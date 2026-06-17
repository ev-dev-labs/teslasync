import SwiftUI

// Presentational building blocks for the Weekly Digest sections — the SwiftUI parity of the web
// `HighlightCard` / `MiniStat` / `BatteryPill` / `StatCard` and the section headers. Self-contained on
// the design system (TSGlassPanel / TSCard / TSIconBox / tokens); values arrive pre-formatted from
// `WeeklyDigestFormat`, so they render verbatim.

// MARK: - Accent (web `HighlightCard` `color` prop → token tone)

/// The per-metric color identity of a hero card (web `HighlightCard` `color`: cyan / green / purple /
/// amber), mapped onto the design-system tones so it tracks light/dark + increased contrast.
enum WeeklyDigestAccent {
    case cyan
    case green
    case purple
    case amber

    var tone: TSTone {
        switch self {
        case .cyan: .accent
        case .green: .success
        case .purple: .info
        case .amber: .warning
        }
    }
}

// MARK: - Trend chip (web `HighlightCard` / `StatCard` trend)

/// An up/down trend chip (web `change.positive ? <TrendingUp/> : <TrendingDown/>` + value). `positive`
/// — not the arithmetic sign — drives both the arrow and the good/bad color, exactly as the web does,
/// so "lower is better" metrics read correctly.
struct WeeklyDigestTrendChip: View {
    let trend: DigestTrend

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: trend.positive ? "arrow.up.right" : "arrow.down.right")
                .font(.caption2)
            Text(verbatim: trend.value)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(trend.positive ? Color.TS.statusSuccess : Color.TS.statusDanger)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Highlight card (web `HighlightCard`)

/// One hero summary card (web `HighlightCard`): an accent-tinted icon + label, a large value, an
/// optional trend chip, and an optional subtitle.
struct WeeklyDigestHighlightCard: View {
    let systemImage: String
    let labelKey: LocalizedStringKey
    let value: String
    var trend: DigestTrend?
    var subtitle: String?
    let accent: WeeklyDigestAccent

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: systemImage)
                        .foregroundStyle(accent.tone.color)
                    Text(labelKey)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Text(verbatim: value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                if let trend {
                    WeeklyDigestTrendChip(trend: trend)
                }
                if let subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Mini stat (web `MiniStat`)

/// A compact labeled stat (web `MiniStat`): an icon, a caption label, and a value. The icon tone
/// defaults to muted but can carry semantic color (web passes a colored trend icon for "Efficiency
/// Change").
struct WeeklyDigestMiniStat: View {
    let systemImage: String
    let labelKey: LocalizedStringKey
    let value: String
    var iconTone: TSTone?

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: systemImage)
                    .foregroundStyle(iconTone?.color ?? Color.TS.textMuted)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(labelKey)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: value)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .monospacedDigit()
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Battery pill (web `BatteryPill`)

/// A battery percentage pill (web `BatteryPill`): a level-colored battery icon, a label + percentage,
/// and a proportional fill bar. Color thresholds mirror web `STATUS_COLORS` (≥60 good, ≥30 warning,
/// else critical).
struct WeeklyDigestBatteryPill: View {
    let level: Int
    let labelKey: LocalizedStringKey

    private var tone: Color {
        if level >= 60 { return Color.TS.statusSuccess }
        if level >= 30 { return Color.TS.statusWarning }
        return Color.TS.statusDanger
    }

    private var fraction: CGFloat {
        CGFloat(min(max(level, 0), 100)) / 100
    }

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "battery.100")
                    .foregroundStyle(tone)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(labelKey)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: "\(WeeklyDigestFormat.int(Double(level)))%")
                        .font(Font.TS.bodySm)
                        .fontWeight(.bold)
                        .foregroundStyle(tone)
                        .monospacedDigit()
                }
                Spacer(minLength: TSSpacing.sm)
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.TS.border.opacity(0.3))
                    Capsule().fill(tone).frame(width: 64 * fraction)
                }
                .frame(width: 64, height: 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(verbatim: "\(level)%"))
    }
}

// MARK: - Stat card (web week-over-week `StatCard`)

/// A week-over-week stat card (web `StatCard`): label + tinted icon, a value with an optional unit,
/// and a trend chip.
struct WeeklyDigestStatCard: View {
    let labelKey: LocalizedStringKey
    let value: String
    var unit: String?
    let systemImage: String
    var trend: DigestTrend?

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    Text(labelKey)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: .accent)
                }
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: value)
                        .font(Font.TS.title)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .monospacedDigit()
                    if let unit {
                        Text(verbatim: unit)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                }
                if let trend {
                    WeeklyDigestTrendChip(trend: trend)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section header (web section title with a tinted icon)

/// A section title with a leading tinted icon (web `<span className="flex … text-lg font-bold">{icon}
/// {title}</span>`).
struct WeeklyDigestSectionHeader: View {
    let systemImage: String
    let tone: TSTone
    let titleKey: LocalizedStringKey
    var trailing: AnyView?

    init(systemImage: String, tone: TSTone, titleKey: LocalizedStringKey, trailing: AnyView? = nil) {
        self.systemImage = systemImage
        self.tone = tone
        self.titleKey = titleKey
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.color)
            Text(titleKey)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
            if let trailing {
                trailing
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
