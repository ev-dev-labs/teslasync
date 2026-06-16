import SwiftUI

// The remaining impact slides (web `PatternsSlide` + `ComparisonsSlide`). Patterns converts its
// distance/efficiency at the boundary; comparisons render server-provided fun-fact strings verbatim.

// MARK: - Patterns (web `PatternsSlide`)

/// Driving patterns: 📊, the heading, the favorite-day + peak-hour cards, and a three-up mini-stat
/// row (drives/week, distance/drive, efficiency).
struct YearReviewPatternsSlide: View {
    let review: YearReview
    let units: UnitPreferences

    var body: some View {
        YearReviewSlideContainer {
            YearReviewEmoji(value: "📊", size: 48)
            Text("yearReview.drivingPatterns")
                .font(Font.TS.title)
                .foregroundStyle(.white.opacity(0.7))
            YearReviewInfoCard(
                icon: "calendar",
                iconTint: Color.tsHex(0x818CF8),
                title: "yearReview.favoriteDay",
                value: favoriteDay
            )
            YearReviewInfoCard(
                icon: "clock",
                iconTint: Color.tsHex(0x38BDF8),
                title: "yearReview.peakHour",
                value: peakHour
            )
            statRow
        }
    }

    private var peakHour: String {
        YearReviewStoryFormat.hourLabel(review.mostActiveHour)
    }

    /// Web `data.most_active_day_of_week || '—'`.
    private var favoriteDay: String {
        review.mostActiveDayOfWeek.isEmpty ? YearReviewStoryFormat.emptyValue : review.mostActiveDayOfWeek
    }

    private var statRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            YearReviewMiniStat(
                value: YearReviewStoryFormat.number(review.avgDrivesPerWeek, decimals: 1),
                label: Text("yearReview.drivesWeek")
            )
            YearReviewMiniStat(
                value: YearReviewStoryFormat.distanceInt(review.avgDistancePerDriveM, units),
                label: Text(verbatim: distancePerDriveLabel)
            )
            YearReviewMiniStat(
                value: avgEfficiencyDisplay,
                label: Text(verbatim: efficiencyLabel)
            )
        }
        .frame(maxWidth: 360)
    }

    /// Web `t('yearReview.distancePerDrive', { unit })` → "{{unit}}/drive avg".
    private var distancePerDriveLabel: String {
        String(format: String(localized: "yearReview.distancePerDrive"), units.distance)
    }

    /// Web `${efficiencyUnit} ${t('yearReview.avg')}`.
    private var efficiencyLabel: String {
        "\(YearReviewStoryFormat.efficiencyUnit(units)) \(YearReviewStoryFormat.localized("yearReview.avg"))"
    }

    /// Web `Math.round(avgEffDisplay)` — the average efficiency converted to the display unit.
    private var avgEfficiencyDisplay: String {
        YearReviewStoryFormat.integer(YearReviewStoryFormat.efficiencyValue(review.avgEfficiencyWhKm, units))
    }
}

/// An icon + title + value info card (web patterns day/hour cards).
struct YearReviewInfoCard: View {
    let icon: String
    let iconTint: Color
    let title: LocalizedStringKey
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: icon).font(.system(size: 28)).foregroundStyle(iconTint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Font.TS.caption).foregroundStyle(.white.opacity(0.5))
                Text(verbatim: value).font(Font.TS.section).fontWeight(.bold).foregroundStyle(.white)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 320)
        .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// A small centered value + label stat (web patterns bottom row).
struct YearReviewMiniStat: View {
    let value: String
    let label: Text

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            label
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.5))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Comparisons (web `ComparisonsSlide`)

/// "Fun facts" grid: the heading and a two-column grid of emoji/label/value cards (web fun-fact
/// cards). The values are server-generated strings rendered verbatim.
struct YearReviewComparisonsSlide: View {
    let comparisons: [YearReviewComparison]

    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]

    var body: some View {
        YearReviewSlideContainer {
            Text("yearReview.funFacts")
                .font(Font.TS.title)
                .foregroundStyle(.white.opacity(0.7))
            LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
                ForEach(comparisons) { item in
                    YearReviewFunFactCard(item: item)
                }
            }
            .frame(maxWidth: 420)
        }
    }
}

/// One fun-fact card: emoji, label, value (web grid cell).
struct YearReviewFunFactCard: View {
    let item: YearReviewComparison

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: item.emoji).font(.system(size: 28))
            Text(verbatim: item.label)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.white.opacity(0.9))
            Text(verbatim: item.value)
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
