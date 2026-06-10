//
//  LiveTelemetryPanels.MorePanelViews.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The remaining four SwiftUI panels — Vehicle State (`VehicleStatePanel`), Tire Pressure
//  (`TirePressurePanel`), Energy & Charging (`EnergyChargingPanel`), Media & Navigation
//  (`MediaNavigationPanel`) — plus the wrapping chip row used by the climate / nav chips.
//  Continues LiveTelemetryPanels.PanelViews.swift.
//

import SwiftUI

// MARK: - Vehicle State

struct LTPVehicleStatePanelView: View {
    let projection: LTPVehicleStateProjection

    var body: some View {
        LTPPanelShell(
            icon: "waveform.path.ecg",
            tint: Color.TS.accent,
            title: projection.title,
            trailing: { livePip },
            content: {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(projection.lightsRows) { LTPRow(row: $0) }
                    Divider().overlay(Color.TS.border)
                    ForEach(projection.driverRows) { LTPRow(row: $0) }
                    Divider().overlay(Color.TS.border)
                    ForEach(projection.accessRows) { LTPRow(row: $0) }
                }
            }
        )
    }

    @ViewBuilder private var livePip: some View {
        if projection.sseConnected {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(Color.TS.statusSuccess).frame(width: 6, height: 6)
                Text(verbatim: projection.liveLabel).font(Font.TS.caption).foregroundStyle(Color.TS.statusSuccess)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: projection.liveLabel))
        }
    }
}

// MARK: - Tire pressure

struct LTPTirePanelView: View {
    let projection: LTPTireProjection

    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.md),
        GridItem(.flexible(), spacing: TSSpacing.md)
    ]

    var body: some View {
        LTPPanelShell(icon: "gauge.with.dots.needle.bottom.50percent", tint: Color.TS.accent, title: projection.title) {
            if projection.hasData {
                VStack(spacing: TSSpacing.md) {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        ForEach(projection.corners) { cornerTile($0) }
                    }
                    HStack {
                        Spacer(minLength: 0)
                        LTPChipView(chip: projection.statusChip)
                        Spacer(minLength: 0)
                    }
                }
            } else {
                LTPPanelEmpty(message: projection.emptyMessage)
            }
        }
    }

    private func cornerTile(_ corner: LTPTireCorner) -> some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: corner.label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Text(verbatim: corner.value)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(corner.tone.valueColor)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(corner.tone.color.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(corner.label) \(corner.value)"))
    }
}

// MARK: - Energy & charging

struct LTPEnergyChargingPanelView: View {
    let projection: LTPEnergyChargingProjection

    var body: some View {
        LTPPanelShell(icon: "bolt.batteryblock.fill", tint: Color.TS.accent, title: projection.title) {
            if projection.hasData {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    HStack(spacing: TSSpacing.md) {
                        LTPMetricTileView(tile: projection.voltageTile)
                        LTPMetricTileView(tile: projection.currentTile)
                    }
                    LTPRow(row: projection.chargerPowerRow)
                    LTPRow(row: projection.energyAddedRow)
                    HStack {
                        Text(verbatim: projection.chargingStateLabel).font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                        Spacer(minLength: TSSpacing.sm)
                        LTPChipView(chip: projection.chargingStateChip)
                    }
                    LTPRow(row: projection.batteryLevelRow)
                    LTPRow(row: projection.chargeRateRow)
                }
            } else {
                LTPPanelEmpty(message: projection.emptyMessage)
            }
        }
    }
}

// MARK: - Media & navigation

struct LTPMediaNavPanelView: View {
    let projection: LTPMediaNavProjection

    var body: some View {
        LTPPanelShell(icon: "headphones", tint: Color.TS.chartSeriesPower, title: projection.title) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                nowPlayingSection
                navigationSection
            }
        }
    }

    private var nowPlayingSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: projection.nowPlayingLabel.uppercased())
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            if projection.hasMedia {
                mediaCard
            } else {
                Text(verbatim: projection.mediaEmpty).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var mediaCard: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: projection.mediaTitle)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: projection.mediaArtist)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            HStack(spacing: TSSpacing.sm) {
                if let source = projection.sourceChip { LTPChipView(chip: source) }
                if let status = projection.statusChip { LTPChipView(chip: status) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous).strokeBorder(
            Color.TS.border,
            lineWidth: 1
        ))
    }

    private var navigationSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "location.north.line.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: projection.navigationLabel.uppercased())
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
            if projection.hasLocation {
                destinationBlock
                LTPChipWrap(chips: projection.placeChips)
            } else {
                Text(verbatim: projection.locationEmpty).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    @ViewBuilder private var destinationBlock: some View {
        if let destination = projection.destinationName {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "mappin.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    Text(verbatim: destination)
                        .font(Font.TS.bodySm)
                        .fontWeight(.bold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                }
                HStack(spacing: TSSpacing.md) {
                    if let distance = projection.distanceText {
                        Text(verbatim: distance).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    }
                    if let eta = projection.etaText {
                        Text(verbatim: eta).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous).strokeBorder(
                Color.TS.border,
                lineWidth: 1
            ))
        } else {
            Text(verbatim: projection.noDestination).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Chip wrap (web `flex flex-wrap gap-2`)

/// Wraps a row of chips, flowing to the next line when they overflow.
struct LTPChipWrap: View {
    let chips: [LTPChip]

    var body: some View {
        if chips.isEmpty {
            EmptyView()
        } else {
            LTPFlowLayout(spacing: TSSpacing.sm) {
                ForEach(chips) { LTPChipView(chip: $0) }
            }
        }
    }
}

/// A minimal wrapping flow layout (web `flex-wrap`). Places subviews left-to-right and
/// wraps to a new line when the proposed width is exceeded.
struct LTPFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let maxWidth = proposal.replacingUnspecifiedDimensions().width
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalWidth = max(totalWidth, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalWidth = max(totalWidth, rowWidth)
        totalHeight += rowHeight
        return CGSize(width: maxWidth.isFinite ? maxWidth : totalWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var origin = bounds.origin
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x > bounds.minX, origin.x + size.width > bounds.maxX {
                origin.x = bounds.minX
                origin.y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: origin, proposal: ProposedViewSize(size))
            origin.x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
