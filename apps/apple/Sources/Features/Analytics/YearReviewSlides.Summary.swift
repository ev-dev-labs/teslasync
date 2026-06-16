import SwiftUI

// The closing summary slide (web `SummarySlide`): a screenshot-friendly recap card with the year,
// the vehicle, five headline stats, an optional savings line, and a share prompt. Distance + energy
// convert at the boundary; everything else renders verbatim.

/// The closing slide: the recap card plus the "screenshot to share" prompt.
struct YearReviewSummarySlide: View {
    let review: YearReview
    let units: UnitPreferences

    var body: some View {
        YearReviewSlideContainer {
            YearReviewSummaryCard(review: review, units: units)
            Text("yearReview.screenshot")
                .font(Font.TS.caption)
                .foregroundStyle(.white.opacity(0.5))
        }
    }
}

/// The recap card itself (web 16:9 gradient card).
struct YearReviewSummaryCard: View {
    let review: YearReview
    let units: UnitPreferences

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(Array(statItems.enumerated()), id: \.offset) { _, item in
                    YearReviewSummaryRow(icon: item.icon, value: item.value, label: item.label)
                }
            }
            if review.gasSavings > 0 {
                savings
            }
            Text(verbatim: "TeslaSync • \(YearReviewStoryFormat.localized("yearReview.title"))")
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.4))
        }
        .multilineTextAlignment(.leading)
        .padding(TSSpacing.xl)
        .frame(maxWidth: 360)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1)
        )
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: String(review.year)).font(Font.TS.title).fontWeight(.bold).foregroundStyle(.white)
                Text("yearReview.title").font(Font.TS.caption).foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: TSSpacing.md)
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: review.vehicle.displayName)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(.white)
                Text(verbatim: review.vehicle.model).font(.system(size: 10)).foregroundStyle(.white.opacity(0.5))
            }
        }
    }

    /// Web `t('yearReview.savedSummary', { amount: round(gas_savings) })` → "Saved ${{amount}} vs. gas".
    private var savings: some View {
        Text(verbatim: "💰 " + String(
            format: String(localized: "yearReview.savedSummary"),
            Int(review.gasSavings.rounded())
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.tsHex(0x34D399))
        .padding(.top, TSSpacing.xs)
    }

    /// The five recap rows (web `stats` array): drives, distance, energy, charges, CO₂.
    private var statItems: [YearReviewSummaryStat] {
        [
            YearReviewSummaryStat(
                icon: "car.fill",
                value: YearReviewStoryFormat.integer(Double(review.totalDrives)),
                label: Text("yearReview.totalDrives")
            ),
            YearReviewSummaryStat(
                icon: "car.fill",
                value: YearReviewStoryFormat.distanceInt(review.totalDistanceM, units),
                label: Text(verbatim: units.distance)
            ),
            YearReviewSummaryStat(
                icon: "bolt.fill",
                value: YearReviewStoryFormat.integer(YearReviewStoryFormat.energyKWhValue(review.totalEnergyWh)),
                label: Text("yearReview.energyKwh")
            ),
            YearReviewSummaryStat(
                icon: "powerplug.fill",
                value: YearReviewStoryFormat.integer(Double(review.totalChargeSessions)),
                label: Text("yearReview.charges")
            ),
            YearReviewSummaryStat(
                icon: "leaf.fill",
                value: YearReviewStoryFormat.integer(review.co2OffsetKg),
                label: Text("yearReview.co2KgSaved")
            )
        ]
    }
}

/// One recap row's data (icon + value + label), extracted so the summary list avoids a large tuple.
private struct YearReviewSummaryStat {
    let icon: String
    let value: String
    let label: Text
}

/// One recap row: icon + value + label (web `stats.map` row).
struct YearReviewSummaryRow: View {
    let icon: String
    let value: String
    let label: Text

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: icon).font(.system(size: 15)).foregroundStyle(.white.opacity(0.5)).frame(width: 22)
            Text(verbatim: value)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(.white)
                .frame(minWidth: 64, alignment: .leading)
            label.font(Font.TS.caption).foregroundStyle(.white.opacity(0.7))
            Spacer(minLength: 0)
        }
    }
}
