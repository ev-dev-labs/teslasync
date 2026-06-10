//
//  VehicleCard.Views.swift
//  TeslaSync — P4 feature view · 0302 · VehicleCard (Apple)
//
//  The presentational subviews of the loaded VehicleCard — the native port of the
//  web card's gradient accent strip, the `TeslaCarViz` body, the title + status
//  block, the wrapping stats row (battery ring + range, interior temperature,
//  odometer, charging power, and the locked / sentry markers), and the trailing
//  action cluster (View details / Remove vehicle). Each piece reads its copy
//  through the injected `VehicleCardLocalizer`; no English is hardcoded. The
//  load / empty / error chrome + the card container live in `VehicleCard.swift`.
//

import SwiftUI

// MARK: - Flow layout (wrapping stats row — web `flex flex-wrap`)

/// A minimal left-aligned wrapping layout (native parity of the web stats row's
/// `flex flex-wrap items-center gap-x-5 gap-y-2`). Lays subviews left-to-right,
/// wrapping to a new line when the next subview would overflow the proposed width.
struct VehicleCardFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.xl
    var verticalSpacing: CGFloat = TSSpacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        layout(maxWidth: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let frames = layout(maxWidth: bounds.width, subviews: subviews).frames
        for index in subviews.indices {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frames[index].minX, y: bounds.minY + frames[index].minY),
                proposal: ProposedViewSize(frames[index].size)
            )
        }
    }

    private func layout(maxWidth: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var origin = CGPoint.zero
        var rowHeight: CGFloat = 0
        var contentWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x > 0, origin.x + size.width > maxWidth {
                origin.x = 0
                origin.y += rowHeight + verticalSpacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: origin, size: size))
            origin.x += size.width + horizontalSpacing
            rowHeight = Swift.max(rowHeight, size.height)
            contentWidth = Swift.max(contentWidth, origin.x - horizontalSpacing)
        }
        return (CGSize(width: contentWidth, height: origin.y + rowHeight), frames)
    }
}

// MARK: - Gradient accent strip (web `h-1 bg-gradient-to-r`)

/// The thin cyan→purple→green accent strip across the card top (web gradient bar).
struct VehicleCardGradientStrip: View {
    var body: some View {
        LinearGradient(
            colors: [Color.TS.accent, Color.TS.chartSeriesPower, Color.TS.statusSuccess],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: 3)
        .opacity(0.5)
        .accessibilityHidden(true)
    }
}

// MARK: - Car viz (web `TeslaCarViz`)

/// The native stand-in for the web `TeslaCarViz`: a model body glyph in a tinted
/// box, a charging bolt overlay, and a battery-level fill bar — conveying the same
/// data (model, battery, charging) the web SVG renders.
struct VehicleCardCarViz: View {
    let data: VehicleCardData
    let localize: VehicleCardLocalizer

    var body: some View {
        let tone = data.live?.batteryTone ?? .accent
        return VStack(spacing: TSSpacing.xs) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: data.modelKey.systemImage)
                    .font(.system(size: 30, weight: .regular))
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(width: 64, height: 44)
                if data.live?.isCharging == true {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.TS.statusSuccess)
                        .padding(3)
                        .background(Color.TS.surface, in: Circle())
                }
            }
            batteryBar(tone: tone)
        }
        .frame(width: 64)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VehicleCardAccessibility.cardLabel(for: data, localize: localize)))
    }

    private func batteryBar(tone: TSTone) -> some View {
        let fraction = data.live.map(\.batteryFraction) ?? (Double(data.vizBatteryLevel) / 100)
        return GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.4))
                Capsule().fill(tone.color).frame(width: proxy.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(width: 56, height: 4)
    }
}

// MARK: - Battery ring (web `ProgressRing`)

/// The battery state-of-charge ring (web `ProgressRing value color={batteryColor}`),
/// tinted by the threshold tone — a native `Gauge` honoring the design tokens.
struct VehicleCardBatteryRing: View {
    let fraction: Double
    let tone: TSTone

    var body: some View {
        Gauge(value: min(max(fraction, 0), 1)) { EmptyView() }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(tone.color)
            .scaleEffect(0.62)
            .frame(width: 40, height: 40)
            .accessibilityHidden(true)
    }
}

// MARK: - Status pill (web `StatusBadge`)

/// The vehicle status badge: a tinted state dot + the localized status label
/// (web `<StatusBadge status={status} />`).
struct VehicleCardStatusPill: View {
    let label: String
    let tone: TSTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone.color).frame(width: 7, height: 7)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Info header (web title `<Link>` + status + descriptor)

/// The title block: the vehicle name as a navigable element (web `<Link>` to the
/// detail route), the status badge, and the `model trim · vin` descriptor row.
struct VehicleCardInfoHeader: View {
    let data: VehicleCardData
    let localize: VehicleCardLocalizer
    let onViewDetails: (Int64) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Button { onViewDetails(data.vehicleID) } label: {
                    Text(verbatim: data.title)
                        .font(Font.TS.panel)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: data.title))
                .accessibilityHint(Text(verbatim: VehicleCardAccessibility.viewDetailsLabel(localize)))
                .accessibilityAddTraits(.isButton)
                VehicleCardStatusPill(label: data.statusLabel, tone: data.statusTone)
            }
            descriptorRow
        }
    }

    private var descriptorRow: some View {
        HStack(spacing: TSSpacing.xs) {
            if !data.descriptor.isEmpty {
                Text(verbatim: data.descriptor)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Text(verbatim: data.vin)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat cell (web stacked value + label)

/// One stacked stat: a prominent value over a muted caption (web `text-sm` value
/// + `text-[10px]` label).
struct VehicleCardStat: View {
    let value: String
    let label: String
    var valueTone: TSTone?

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: value)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(valueTone?.color ?? Color.TS.textPrimary)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}

// MARK: - Stats row (web `{state && (...)}`)

/// The wrapping stats row: battery ring + percent/range, interior temperature,
/// odometer, the charging-power cell (charging only), and the locked / sentry
/// markers. Rendered only when a live projection is present; the awaiting-state
/// fallback is shown by the card body otherwise.
struct VehicleCardStatsRow: View {
    let live: VehicleCardLiveProjection
    let localize: VehicleCardLocalizer

    var body: some View {
        VehicleCardFlowLayout {
            batteryCluster
            VehicleCardStat(
                value: live.interiorText,
                label: localize.string("card.interior", "Interior")
            )
            VehicleCardStat(
                value: live.odometerValue,
                label: live.odometerUnit
            )
            if live.isCharging {
                VehicleCardStat(
                    value: live.chargerPowerText,
                    label: localize.string("card.charging", "Charging"),
                    valueTone: .success
                )
            }
            securityMarkers
        }
    }

    private var batteryCluster: some View {
        HStack(spacing: TSSpacing.sm) {
            VehicleCardBatteryRing(fraction: live.batteryFraction, tone: live.batteryTone)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: live.batteryPercentText)
                    .font(Font.TS.body)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: live.rangeText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim:
            "\(localize.string("card.battery", "Battery")) \(live.batteryPercentText), \(live.rangeText)"))
    }

    private var securityMarkers: some View {
        HStack(spacing: TSSpacing.sm) {
            if live.isLocked {
                Image(systemName: "lock.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityLabel(Text(verbatim: localize.string("card.locked", "Locked")))
            }
            if live.sentryMode {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityLabel(Text(verbatim: localize.string("card.sentry", "Sentry Mode")))
            }
        }
    }
}

// MARK: - Action cluster (web trailing `<Link>` + delete `<Button>`)

/// The trailing actions: open the detail route (web external-link `<Link>`) and
/// remove the vehicle (web destructive ghost `<Button>` → `onDelete`).
struct VehicleCardActionsColumn: View {
    let data: VehicleCardData
    let vehicle: VehicleCardVehicle
    let localize: VehicleCardLocalizer
    let actions: VehicleCardActions

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSButton(variant: .ghost, size: .small) {
                actions.onViewDetails(data.vehicleID)
            } label: {
                Image(systemName: "arrow.up.forward.square")
                    .font(.system(size: 15, weight: .semibold))
            }
            .accessibilityLabel(Text(verbatim: VehicleCardAccessibility.viewDetailsLabel(localize)))

            TSButton(variant: .ghost, size: .small) {
                actions.onDelete(vehicle)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
            }
            .accessibilityLabel(Text(verbatim: VehicleCardAccessibility.removeLabel(localize)))
        }
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// The live-stream freshness chip (stale / offline) — native chrome for the P4
/// stale/offline states; keeps the cached card visible with a clear label.
struct VehicleCardFreshnessChipView: View {
    let chip: VehicleCardFreshnessChip
    let localize: VehicleCardLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: chip.systemImage).font(.system(size: 10, weight: .semibold))
            Text(verbatim: localize.string(chip.labelKey, chip.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(chip.tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: localize.string(chip.labelKey, chip.labelFallback)))
    }
}
