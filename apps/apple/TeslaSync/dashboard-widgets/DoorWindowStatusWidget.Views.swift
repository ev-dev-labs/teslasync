//
//  DoorWindowStatusWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  The presentational subviews composed by `DoorWindowStatusWidget`: the
//  stale/offline connectivity banner, the labeled doors/windows section, the
//  two-column status grid (web `WidgetStatusGrid`, `cols={2}`) with its friendly
//  empty state, the individual status cell, and the compact (1×1) badge row. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grids when the bound source is not
/// live, so cached values are clearly labeled (web freshness-indicator intent).
struct DoorWindowConnectivityBanner: View {
    let connection: DoorWindowConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.doorWindowOfflineBanner" : "widget.doorWindowStaleBanner"
        let fallback = isOffline
            ? "Offline — showing last known status"
            : "Reconnecting — status may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            DoorWindowStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Labeled section (web `<h4>` heading + `WidgetStatusGrid`)

/// One titled section (the "Doors" block or the "Windows" block): the muted
/// uppercase heading above its two-column status grid. The whole section carries
/// a VoiceOver summary so the posture can be read in one pass.
struct DoorWindowSection: View {
    let titleKey: String
    let titleFallback: String
    let cells: [DoorWindowStatusCell]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            DoorWindowStrings.text(titleKey, titleFallback)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            DoorWindowStatusGrid(cells: cells)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: DoorWindowAccessibility.sectionSummary(
            titleKey: titleKey,
            titleFallback: titleFallback,
            cells: cells,
            localize: DoorWindowStrings.string
        )))
    }
}

// MARK: - Status grid (web `WidgetStatusGrid`, cols = 2)

/// The fixed two-column grid of status cells — the native port of the web
/// `WidgetStatusGrid` invoked with `cols={2}`.
struct DoorWindowStatusGrid: View {
    let cells: [DoorWindowStatusCell]

    private static let columns: [GridItem] = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]

    var body: some View {
        LazyVGrid(columns: Self.columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(cells) { cell in
                DoorWindowStatusCellView(cell: cell)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }
}

/// The widget-level empty state (web `WidgetStatusGrid` `emptyMessage` "No
/// door/window data" with the `DoorOpen` icon). Always rendered in place of a
/// blank panel when the source resolves with no event.
struct DoorWindowEmptyGrid: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "door.left.hand.open")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: DoorWindowStrings.string("widget.doorWindow.noData", "No door/window data"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - One status cell (web `WidgetStatusGrid` cell)

/// A single status cell: a tinted rounded container with a corner status dot, the
/// muted label, and the emphasized value — the native port of the web cell markup
/// (which carries no per-cell icon for doors/windows), with the same
/// `ok/warning/unknown` tinting.
struct DoorWindowStatusCellView: View {
    let cell: DoorWindowStatusCell

    private var fill: Color {
        cell.status.isTinted
            ? cell.status.tone.color.opacity(0.10)
            : Color.TS.textMuted.opacity(0.08)
    }

    private var stroke: Color {
        cell.status.isTinted
            ? cell.status.tone.color.opacity(0.20)
            : Color.TS.border
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: cell.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(verbatim: cell.value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(stroke, lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(cell.status.tone.color)
                .frame(width: 8, height: 8)
                .padding(TSSpacing.sm)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: DoorWindowAccessibility.cellSummary(for: cell)))
    }
}

// MARK: - Compact badges (web 1×1 layout)

/// The compact (1×1) layout: the two stacked summary badges (doors + windows)
/// the web renders in place of the grids when the footprint is a single tile.
struct DoorWindowCompactBadges: View {
    let openDoorCount: Int
    let openWindowCount: Int

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            badge(
                text: DoorWindowBadgeText.doors(openCount: openDoorCount, localize: DoorWindowStrings.string),
                tone: DoorWindowBadgeText.tone(openCount: openDoorCount)
            )
            badge(
                text: DoorWindowBadgeText.windows(openCount: openWindowCount, localize: DoorWindowStrings.string),
                tone: DoorWindowBadgeText.tone(openCount: openWindowCount)
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: DoorWindowAccessibility.compactSummary(
            openDoorCount: openDoorCount,
            openWindowCount: openWindowCount,
            localize: DoorWindowStrings.string
        )))
    }

    /// One tinted capsule badge (web `<Badge variant size="sm">`), built with
    /// `verbatim` text so the computed open-count phrase is not re-localized.
    private func badge(text: String, tone: TSTone) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}
