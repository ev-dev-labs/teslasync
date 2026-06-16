import SwiftUI

/// The ordered story slides (web `SLIDE_DEFS` in `components/review/slides.ts`). One case per web
/// slide entry, in the exact same order, so the deck length + sequence stay at parity. Each slide
/// carries the festive gradient backdrop the web renders via Tailwind `from-…-to-…` classes,
/// approximated with the matching dark brand hues for the native story.
public enum YearReviewSlideKind: Int, CaseIterable, Identifiable, Sendable {
    case title
    case statHeroDistance
    case statChart
    case driveHighlightLongest
    case statHeroEnergy
    case chargingBreakdown
    case savings
    case environment
    case patterns
    case driveHighlightEfficient
    case comparisons
    case summary

    public var id: Int {
        rawValue
    }

    /// The two-stop diagonal backdrop (web `bg-gradient-to-br from-…-to-…`), endpoints taken from
    /// the first/last Tailwind 900 stops of each web slide definition.
    public var backgroundGradient: LinearGradient {
        LinearGradient(colors: gradientStops, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var gradientStops: [Color] {
        switch self {
        case .title: [.tsHex(0x1E3A8A), .tsHex(0x0F172A)]
        case .statHeroDistance: [.tsHex(0x064E3B), .tsHex(0x134E4A)]
        case .statChart: [.tsHex(0x581C87), .tsHex(0x312E81)]
        case .driveHighlightLongest: [.tsHex(0x78350F), .tsHex(0x713F12)]
        case .statHeroEnergy: [.tsHex(0x164E63), .tsHex(0x1E3A8A)]
        case .chargingBreakdown: [.tsHex(0x7C2D12), .tsHex(0x831843)]
        case .savings: [.tsHex(0x064E3B), .tsHex(0x164E63)]
        case .environment: [.tsHex(0x14532D), .tsHex(0x365314)]
        case .patterns: [.tsHex(0x312E81), .tsHex(0x4C1D95)]
        case .driveHighlightEfficient: [.tsHex(0x134E4A), .tsHex(0x0C4A6E)]
        case .comparisons: [.tsHex(0x831843), .tsHex(0x701A75)]
        case .summary: [.tsHex(0x1E3A8A), .tsHex(0x581C87)]
        }
    }
}

extension Color {
    /// Builds an opaque sRGB color from a `0xRRGGBB` literal (story gradient stops only).
    static func tsHex(_ rgb: UInt32) -> Color {
        Color(
            .sRGB,
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255,
            opacity: 1
        )
    }
}
