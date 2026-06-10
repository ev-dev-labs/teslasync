//
//  ClimateStatusWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  The presentational subviews composed by `ClimateStatusWidget`: the stale/offline
//  connectivity banner, the labeled metric row (web `Row`), the tinted status chip,
//  and the leading-aligned wrapping chip row (web `flex-wrap`). All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Tone → design token color

extension ClimateStatusTone {
    /// Maps the Foundation-only semantic tone to a design token, reproducing the web
    /// tints: defrost → speed (blue, web `text-blue-400`), heater → energy (orange,
    /// web `text-orange-400`).
    var color: Color {
        switch self {
        case .defrost: Color.TS.chartSeriesSpeed
        case .heater: Color.TS.chartSeriesEnergy
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the rows when the bound source is not live,
/// so cached values are clearly labeled (web freshness-indicator intent).
struct ClimateStatusConnectivityBanner: View {
    let connection: ClimateStatusConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.climateStatus.offlineBanner" : "widget.climateStatus.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known climate"
            : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: ClimateStatusStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Row (web `Row`)

/// One labeled metric row: the muted label on the leading edge, the emphasized value
/// on the trailing edge — the native port of the web `Row`.
struct ClimateStatusRowView: View {
    let row: ClimateStatusRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: row.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.value)
                .font(Font.TS.body)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(row.label) \(row.value)"))
    }
}

// MARK: - Chip (web Defrost / Heater pills)

/// One tinted pill with a leading SF Symbol — the Defrost or Heater status chip.
/// Built with `verbatim` text so the localized label is not re-localized.
struct ClimateStatusChipView: View {
    let chip: ClimateStatusChip

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: chip.systemImage)
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: chip.text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .lineLimit(1)
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(chip.tone.color.opacity(0.22), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: chip.text))
    }
}

// MARK: - Chip row (web `flex items-center gap-2 flex-wrap`)

/// The Defrost / Heater chip row, wrapping leading-aligned — the native port of the
/// web `flex items-center gap-2 flex-wrap` chip container.
struct ClimateStatusChipRow: View {
    let chips: [ClimateStatusChip]

    var body: some View {
        ClimateStatusFlowLayout(spacing: TSSpacing.sm) {
            ForEach(chips) { chip in
                ClimateStatusChipView(chip: chip)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Flow layout (web `flex-wrap`)

/// A leading-aligned wrapping layout — the native analog of the web `flex
/// items-center gap-2 flex-wrap` chip row. Places subviews left-to-right, wrapping to
/// a new line when the next subview would overflow the proposed width.
struct ClimateStatusFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        arrange(subviews: subviews, maxWidth: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let arrangement = arrange(subviews: subviews, maxWidth: bounds.width)
        for index in subviews.indices {
            let frame = arrangement.frames[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(subviews: Subviews, maxWidth: CGFloat) -> (size: CGSize, frames: [CGRect]) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        var frames = [CGRect](repeating: .zero, count: subviews.count)
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0

        for index in subviews.indices {
            let itemSize = sizes[index]
            if cursorX > 0, cursorX + itemSize.width > maxWidth {
                cursorX = 0
                cursorY += rowHeight + spacing
                rowHeight = 0
            }
            frames[index] = CGRect(x: cursorX, y: cursorY, width: itemSize.width, height: itemSize.height)
            cursorX += itemSize.width + spacing
            rowHeight = max(rowHeight, itemSize.height)
            widest = max(widest, min(cursorX - spacing, maxWidth.isFinite ? maxWidth : cursorX))
        }
        let width = maxWidth.isFinite ? maxWidth : widest
        return (CGSize(width: width, height: cursorY + rowHeight), frames)
    }
}
