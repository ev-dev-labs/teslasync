import SwiftUI

// The impact slides (web `SavingsSlide` + `EnvironmentSlide`). All money/CO₂ values render at the
// display boundary; the savings figure is emerald and the CO₂ figure green, matching the web.

// MARK: - Savings (web `SavingsSlide`)

/// Fuel savings: 💰, "You saved", the emerald dollar figure, the "vs. gas" line, the two cost bars
/// (gas vs. electric), and the playful "cups of coffee" note.
struct YearReviewSavingsSlide: View {
    let review: YearReview

    private var gasCostEquiv: Double {
        review.gasSavings + review.totalChargingCost
    }

    var body: some View {
        YearReviewSlideContainer {
            YearReviewEmoji(value: "💰", size: 56)
            Text("yearReview.youSaved")
                .font(Font.TS.section)
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.7))
            savedFigure
            Text("yearReview.vsGas")
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.6))
            bars
        }
    }

    private var savedFigure: some View {
        Text(verbatim: YearReviewStoryFormat.currency(review.gasSavings))
            .font(.system(size: 56, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(Color.tsHex(0x34D399))
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }

    private var bars: some View {
        VStack(spacing: TSSpacing.md) {
            YearReviewCostBar(
                icon: "fuelpump.fill", label: "yearReview.gasCost",
                amount: YearReviewStoryFormat.currency(gasCostEquiv), tint: Color.tsHex(0xF87171), fill: 1
            )
            YearReviewCostBar(
                icon: "bolt.fill", label: "yearReview.electricCost",
                amount: YearReviewStoryFormat.currency(review.totalChargingCost), tint: Color.tsHex(0x34D399),
                fill: gasCostEquiv > 0 ? review.totalChargingCost / gasCostEquiv : 0
            )
            coffeeNote
        }
        .frame(maxWidth: 320)
    }

    /// Web `t('yearReview.savingsNote', { cupsOfCoffee: round(gas_savings / 5) })`.
    private var coffeeNote: some View {
        Text(verbatim: String(
            format: String(localized: "yearReview.savingsNote"),
            Int((review.gasSavings / 5).rounded())
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.tsHex(0x34D399))
        .padding(.top, TSSpacing.xs)
    }
}

/// One labeled cost bar (web gas / electric comparison rows): an icon + label + amount over a
/// proportional fill track.
struct YearReviewCostBar: View {
    let icon: String
    let label: LocalizedStringKey
    let amount: String
    let tint: Color
    let fill: Double

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: icon).font(.system(size: 12)).foregroundStyle(tint.opacity(0.8))
                Text(label).font(Font.TS.caption).foregroundStyle(.white.opacity(0.7))
                Spacer()
                Text(verbatim: amount).font(Font.TS.caption).fontWeight(.semibold).foregroundStyle(tint)
            }
            GeometryReader { geo in
                Capsule()
                    .fill(.white.opacity(0.08))
                    .overlay(alignment: .leading) {
                        Capsule().fill(tint.opacity(0.6)).frame(width: geo.size.width * min(max(fill, 0), 1))
                    }
            }
            .frame(height: 8)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Environment (web `EnvironmentSlide`)

/// CO₂ offset: 🌍, "CO₂ offset", the green kilogram figure, the "trees planted" equivalent, and a
/// capped 🌳 grid with a "+N more" overflow note.
struct YearReviewEnvironmentSlide: View {
    let review: YearReview

    private var trees: Int {
        Int((review.co2OffsetKg / 21).rounded())
    }

    private var shownTrees: Int {
        min(trees, 30)
    }

    var body: some View {
        YearReviewSlideContainer {
            YearReviewEmoji(value: "🌍", size: 48)
            Text("yearReview.co2Offset")
                .font(Font.TS.section)
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.7))
            Text(verbatim: "\(YearReviewStoryFormat.integer(review.co2OffsetKg)) kg")
                .font(.system(size: 52, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.tsHex(0x4ADE80))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: String(format: String(localized: "yearReview.treesEquiv"), trees))
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.6))
            treeGrid
        }
    }

    private var treeGrid: some View {
        VStack(spacing: TSSpacing.xs) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 26), spacing: 4)], spacing: 4) {
                ForEach(0 ..< shownTrees, id: \.self) { _ in
                    Text(verbatim: "🌳").font(.system(size: 20))
                }
            }
            .frame(maxWidth: 280)
            if trees > 30 {
                Text(verbatim: "+\(trees - 30) \(YearReviewStoryFormat.localized("yearReview.more"))")
                    .font(Font.TS.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .accessibilityHidden(true)
    }
}
