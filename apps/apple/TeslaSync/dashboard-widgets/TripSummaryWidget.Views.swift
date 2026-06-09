//
//  TripSummaryWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0103 · TripSummaryWidget (Apple)
//
//  The presentational subviews composed by `TripSummaryWidget`: the "Last Trip" summary card
//  (badge + date + name + a 2-/4-up stat grid) and the compact/wide recent-trip row. They consume
//  the pre-projected `TripSummaryLastTrip` / `TripSummaryRow` strings and the shared P1/S9 tokens;
//  no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Last-trip summary block (web `lastTrip` card)

/// The "Last Trip" block: a `Last Trip` chip + the short date, the trip name, and a stat grid that
/// is 2-up when compact and 4-up otherwise — the native parity of the web `lastTrip` card.
struct TripSummaryLastTripCard: View {
    let block: TripSummaryLastTrip
    let isCompact: Bool

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .leading),
            count: isCompact ? 2 : 4
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                TripSummaryChip(text: TripSummaryStrings.string("widget.lastTrip", "Last Trip"), tone: .accent)
                Text(verbatim: block.dateText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: 0)
            }
            Text(verbatim: block.name)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
                TripSummaryStatTile(
                    label: TripSummaryStrings.string("widget.distance", "Distance"),
                    value: "\(block.distanceValue) \(block.distanceUnit)",
                    systemImage: "mappin.and.ellipse"
                )
                TripSummaryStatTile(
                    label: TripSummaryStrings.string("widget.duration", "Duration"),
                    value: block.durationText,
                    systemImage: "clock"
                )
                TripSummaryStatTile(
                    label: TripSummaryStrings.string("widget.drives", "Drives"),
                    value: block.drivesText,
                    systemImage: "road.lanes"
                )
                TripSummaryStatTile(
                    label: TripSummaryStrings.string("widget.chargeStops", "Charge Stops"),
                    value: block.chargeStopsText,
                    systemImage: "bolt.fill"
                )
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: block.accessibilityLabel))
    }
}

// MARK: - Stat tile (web `StatCard`)

/// One compact metric tile: a muted label + trailing glyph above a prominent monospaced value —
/// the native counterpart of the web `StatCard` used inside the last-trip grid.
struct TripSummaryStatTile: View {
    let label: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 2)
                Image(systemName: systemImage)
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            Text(verbatim: value)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }
}

// MARK: - Recent trip row (web `recentTrips.slice(1)` row)

/// One recent-trip row: the name + date on the left and, when not compact, the distance + duration
/// + a `N drv` badge on the right (compact shows only the distance) — the native parity of the web
/// recent-trips list row.
struct TripSummaryRowView: View {
    let row: TripSummaryRow
    let isCompact: Bool

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: row.name)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: row.dateText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.xs)
            if isCompact {
                distanceText
            } else {
                HStack(spacing: TSSpacing.sm) {
                    distanceText
                    Text(verbatim: row.durationText)
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                    TripSummaryChip(
                        text: "\(row.driveCountText) \(TripSummaryStrings.string("widget.drivesShort", "drv"))",
                        tone: .neutral
                    )
                }
            }
        }
        .padding(TSSpacing.sm)
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
    }

    private var distanceText: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(verbatim: row.distanceValue)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: row.distanceUnit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Chip (web `Badge`)

/// A compact tinted capsule label with verbatim (already-localized / dynamic) content — the native
/// counterpart of the web `Badge`. Built inline rather than reusing `TSBadge` because the content
/// is resolved through the per-surface i18n table and may interpolate a dynamic count.
struct TripSummaryChip: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .monospacedDigit()
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}
