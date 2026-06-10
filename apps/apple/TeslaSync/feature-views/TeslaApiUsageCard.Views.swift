//
//  TeslaApiUsageCard.Views.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The presentational subviews composed by `TeslaApiUsageCard`, reproducing the shared web
//  <UsageCard> regions — the budget progress bar, the at-a-glance bands grid, and the key/value
//  detail grid. All consume the P1/S10 facade output + the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex. The web intent palette (normal / warn / danger) is mapped to the
//  semantic status tokens.
//
//  Scope note: the web <UsageCard> primitive is shared between TeslaApiUsageCard and AiUsageCard.
//  Its native atomic peer is owned by the P4 component-library bundle (out of scope here), so these
//  regions are reproduced as private subviews scoped to this surface — the only files this prompt
//  is allowed to touch.
//

import SwiftUI

// MARK: - Intent palette (web `intentBarBg` / `intentBandRing` / `intentValueText`)

/// Maps a `TeslaApiUsageIntent` to the semantic status tokens — the native peer of the web intent
/// class maps. `normal` is a near-transparent glass tile with no ring + a cyan bar; `warn` / `danger`
/// add a tinted fill + ring and colour the headline value.
enum TeslaApiUsageIntentStyle {
    static func valueColor(_ intent: TeslaApiUsageIntent) -> Color {
        switch intent {
        case .normal: Color.TS.textPrimary
        case .warn: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }

    static func tileFill(_ intent: TeslaApiUsageIntent) -> Color {
        switch intent {
        case .normal: Color.TS.surfaceGlass
        case .warn: Color.TS.statusWarning.opacity(0.10)
        case .danger: Color.TS.statusDanger.opacity(0.10)
        }
    }

    static func tileStroke(_ intent: TeslaApiUsageIntent) -> Color {
        switch intent {
        case .normal: Color.clear
        case .warn: Color.TS.statusWarning.opacity(0.30)
        case .danger: Color.TS.statusDanger.opacity(0.30)
        }
    }

    /// The budget-bar fill — web `intentBarBg` (normal cyan / warn amber / danger red).
    static func barColor(_ intent: TeslaApiUsageIntent) -> Color {
        switch intent {
        case .normal: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Budget bar (web `BudgetSection`)

/// The month-to-date budget progress bar — the headline + "% of credit" caption, the clamped fill
/// bar, and the "Day N of M · resets …" caption. The bar reports the unclamped percentage to
/// VoiceOver so an over-budget overflow is announced accurately (web `aria-valuenow`).
struct TeslaApiUsageBudgetBar: View {
    let budget: TeslaApiUsageBudget

    private var fraction: Double {
        max(0, min(100, budget.pct)) / 100
    }

    private var spokenPercent: String {
        "\(Int(max(0, budget.pct.rounded())))%"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: budget.headline)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: budget.rightLabel)
                    .font(Font.TS.bodySm)
                    .fontWeight(budget.intent == .danger ? .semibold : .regular)
                    .monospacedDigit()
                    .foregroundStyle(budget.intent == .danger ? Color.TS.statusDanger : Color.TS.textMuted)
            }
            bar
            Text(verbatim: budget.caption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var bar: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.surfaceGlass)
                Capsule()
                    .fill(TeslaApiUsageIntentStyle.barColor(budget.intent))
                    .frame(width: proxy.size.width * fraction)
            }
        }
        .frame(height: 8)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: budget.accessibilityLabel))
        .accessibilityValue(Text(verbatim: spokenPercent))
    }
}

// MARK: - Bands grid (web `BandsSection` — grid-cols-1 md:grid-cols-3)

/// The three at-a-glance bands. Adaptive so it is a single column on a compact width and three
/// across on a regular width (web `md:grid-cols-3`).
struct TeslaApiUsageBandsView: View {
    let bands: [TeslaApiUsageBand]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(bands) { band in
                TeslaApiUsageBandCell(band: band)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One band tile — an icon + uppercase label, a large tabular headline (+ small unit), and a
/// subtitle. The intent tints the tile + colours the value.
struct TeslaApiUsageBandCell: View {
    let band: TeslaApiUsageBand

    private var valueWithUnit: String {
        guard let unit = band.unit else { return band.value }
        return "\(band.value) \(unit)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: 4) {
                Image(systemName: band.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: band.label)
                    .font(Font.TS.caption)
                    .tracking(0.5)
                    .textCase(.uppercase)
            }
            .foregroundStyle(Color.TS.textMuted)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: band.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(TeslaApiUsageIntentStyle.valueColor(band.intent))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = band.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }

            Text(verbatim: band.sub)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            TeslaApiUsageIntentStyle.tileFill(band.intent),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(TeslaApiUsageIntentStyle.tileStroke(band.intent), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: "\(TeslaApiUsageAccessibility.label(band.label, valueWithUnit)). \(band.sub)")
        )
    }
}

// MARK: - Detail grid (web `DetailsSection` — grid-cols-2 md:grid-cols-4)

/// The key/value detail grid. Adaptive: two columns compact, four regular (web `md:grid-cols-4`).
struct TeslaApiUsageDetailsView: View {
    let details: [TeslaApiUsageDetail]

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(details) { detail in
                TeslaApiUsageDetailCell(detail: detail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One detail cell — a muted label over an intent-coloured tabular value, with an optional muted
/// trailing suffix (the error-rate `(count)` parenthetical).
struct TeslaApiUsageDetailCell: View {
    let detail: TeslaApiUsageDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: detail.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: detail.value)
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(TeslaApiUsageIntentStyle.valueColor(detail.intent))
                if let suffix = detail.suffix {
                    Text(verbatim: suffix)
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TeslaApiUsageAccessibility.label(detail.label, detail.spokenValue)))
    }
}
