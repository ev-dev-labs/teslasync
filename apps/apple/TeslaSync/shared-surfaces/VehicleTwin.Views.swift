//
//  VehicleTwin.Views.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The presentational subviews composed by `VehicleTwin`: the paint-resolved scene that wraps the
//  module's shared `VehicleTwinView` Canvas illustration, the always-visible status legend (the
//  native, accessible peer of the web hover tooltips), the legend chip, and the wrapping layout. All
//  consume the resolved model values via the P1/S10 facade + the shared P1/S9 tokens — no networking,
//  no Tailwind ports, no raw hex.
//
//  Scope note: the layered EV illustration is the module-owned, reusable `VehicleTwinView` (the port
//  of web `components/vehicles/VehicleTwin.tsx`), composed here rather than duplicated.
//

import SwiftUI

// MARK: - Scene (the paint-resolved illustration)

/// The twin illustration with the `useVehiclePaint`-resolved paint applied, exposed to VoiceOver as a
/// single image with the localized aria-label + a state + paint summary (replacing the embedded
/// view's own a11y with this surface's P1/S10 strings).
struct VehicleTwinScene: View {
    let content: VehicleTwinContent

    var body: some View {
        VehicleTwinView(
            state: content.state,
            size: content.size.renderSize,
            driveIn: content.driveIn,
            exteriorColor: content.paint.exteriorColorCode
        )
        .frame(maxWidth: CGFloat(content.size.maxWidth))
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isImage)
        .accessibilityLabel(Text(verbatim: content.figureAccessibilityLabel))
        .accessibilityValue(Text(verbatim: "\(content.stateSummary). \(content.paintAccessibilityLabel)"))
        .accessibilityHint(Text(verbatim: content.accessibilityHint))
    }
}

// MARK: - Legend chip (one subsystem status)

/// A capsule status chip — a leading SF Symbol, the subsystem label, and its localized value, tinted
/// by the semantic tone. The label + value are pre-localized; the whole chip is one VoiceOver element.
struct VehicleTwinLegendChip: View {
    let item: VehicleTwinLegendItem

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: item.systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: item.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: item.value)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(item.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 4)
        .background(item.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(item.tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(item.label): \(item.value)"))
    }
}

// MARK: - Status legend (wrapping chip grid)

/// The always-visible status legend — one chip per subsystem (lock / doors / windows / frunk+trunk /
/// charge / lights / turn / sentry / seat / motion). Reproduces the information the web hover
/// tooltips convey, but always visible + accessible (never a hidden panel, P4 rule #6).
struct VehicleTwinLegend: View {
    let items: [VehicleTwinLegendItem]

    var body: some View {
        VehicleTwinWrap(spacing: TSSpacing.sm) {
            ForEach(items) { item in
                VehicleTwinLegendChip(item: item)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Region detail list (web hover-tooltip peer, shown when interactive)

/// The per-region detail rows — the always-accessible native peer of the web `InteractiveHotspot` /
/// `<title>` hover tooltips. Rendered beneath the legend when the surface is `interactive` (matching
/// the web `interactive` prop, which gates the hover labels).
struct VehicleTwinRegionList: View {
    let regions: [VehicleTwinRegionRow]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(regions) { region in
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: region.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    Text(verbatim: region.value)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                .padding(.vertical, TSSpacing.xs)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: "\(region.label): \(region.value)"))
                if region.id != regions.last?.id {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Ready body (scene + legend + last-updated)

/// The content body — the paint-resolved scene, the status legend, the per-region detail list (when
/// interactive), and the last-updated caption, faded in together.
struct VehicleTwinReadyBody: View {
    let content: VehicleTwinContent

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                VehicleTwinScene(content: content)
                VehicleTwinLegend(items: content.legend)
                if content.interactive {
                    VehicleTwinRegionList(regions: content.regions)
                }
                Text(verbatim: content.updatedText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Wrapping layout (left-aligned flow)

/// A left-aligned wrapping flow layout for the legend chips (web `flex flex-wrap gap-2`). Wraps to a
/// new row when the next subview would overflow the proposed width.
struct VehicleTwinWrap: Layout {
    var spacing: CGFloat = TSSpacing.sm

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
            widest = max(widest, min(cursorX - spacing, maxWidth))
        }

        let width = maxWidth.isFinite ? maxWidth : widest
        return (CGSize(width: width, height: cursorY + rowHeight), frames)
    }
}
