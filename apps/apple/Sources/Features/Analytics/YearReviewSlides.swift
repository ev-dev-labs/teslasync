import SwiftUI

/// Dispatches the current slide kind to its native view (web `SlideRenderer`'s switch). The review
/// is non-nil here (the story only renders in the `.ready` phase). Distance/energy/drive-highlight
/// slides receive the unit preferences so they convert SI values at this render boundary.
struct YearReviewSlideView: View {
    let slide: YearReviewSlideKind
    let review: YearReview
    let units: UnitPreferences

    var body: some View {
        switch slide {
        case .title:
            YearReviewTitleSlide(review: review)
        case .statHeroDistance:
            YearReviewDistanceSlide(review: review, units: units)
        case .statChart:
            YearReviewStatChartSlide(review: review)
        case .driveHighlightLongest:
            YearReviewDriveHighlightSlide(
                drive: review.longestDrive,
                label: "yearReview.longestDrive",
                emoji: "🏔️",
                units: units
            )
        case .statHeroEnergy:
            YearReviewEnergySlide(review: review)
        case .chargingBreakdown:
            YearReviewChargingSlide(review: review)
        case .savings:
            YearReviewSavingsSlide(review: review)
        case .environment:
            YearReviewEnvironmentSlide(review: review)
        case .patterns:
            YearReviewPatternsSlide(review: review, units: units)
        case .driveHighlightEfficient:
            YearReviewDriveHighlightSlide(
                drive: review.mostEfficientDrive,
                label: "yearReview.mostEfficient",
                emoji: "🌿",
                units: units
            )
        case .comparisons:
            YearReviewComparisonsSlide(comparisons: review.comparisons)
        case .summary:
            YearReviewSummarySlide(review: review, units: units)
        }
    }
}

// MARK: - Shared slide building blocks (DRY across the deck)

/// Centered, full-bleed slide scaffold (web `flex flex-col items-center justify-center h-full`).
struct YearReviewSlideContainer<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, TSSpacing.x3xl)
        .multilineTextAlignment(.center)
    }
}

/// A decorative slide emoji (hidden from VoiceOver — the surrounding copy carries the meaning).
struct YearReviewEmoji: View {
    let value: String
    var size: CGFloat = 56

    var body: some View {
        Text(verbatim: value)
            .font(.system(size: size))
            .accessibilityHidden(true)
    }
}

/// The oversized white hero number shared by the stat slides (web `text-6xl/8xl font-bold`).
struct YearReviewHeroNumber: View {
    let value: String

    var body: some View {
        Text(verbatim: value)
            .font(.system(size: 60, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}

/// The shared "emoji → hero number → unit → comparison" stat-hero layout (web `StatHeroSlide`).
struct YearReviewHeroSlide: View {
    let emoji: String
    let value: String
    let unit: Text
    let comparison: String

    var body: some View {
        YearReviewSlideContainer {
            YearReviewEmoji(value: emoji, size: 64)
            YearReviewHeroNumber(value: value)
            unit
                .font(Font.TS.title)
                .foregroundStyle(.white.opacity(0.7))
            Text(verbatim: comparison)
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.6))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Title slide (web `TitleSlide`)

/// Opening slide: 🚗, the year, "Year in Review", and the vehicle name (web `TitleSlide`).
struct YearReviewTitleSlide: View {
    let review: YearReview

    var body: some View {
        YearReviewSlideContainer {
            YearReviewEmoji(value: "🚗", size: 72)
            YearReviewHeroNumber(value: String(review.year))
            Text("yearReview.title")
                .font(Font.TS.title)
                .foregroundStyle(.white.opacity(0.7))
            Text(verbatim: review.vehicle.displayName)
                .font(Font.TS.section)
                .foregroundStyle(.white.opacity(0.6))
        }
    }
}
