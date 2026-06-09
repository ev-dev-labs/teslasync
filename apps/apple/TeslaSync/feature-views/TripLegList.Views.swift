//
//  TripLegList.Views.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  The presentational subviews composed by `TripLegList` in its data state: the titled
//  glass panel (web `GlassPanel` + `h3`), the per-leg card (the index chip, the from→to
//  header, and the distance / duration / energy / battery metrics), the interleaved
//  charge-stop block, and the freshness chip (P4 connectivity axis). All consume the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the "from" pin + start SOC →
//  `statusSuccess`; the "to" pin + low arrival SOC → `statusDanger`; a healthy arrival
//  SOC → `statusWarning`; the charge-stop accent + name → `statusInfo`; the cost →
//  `statusSuccess`; muted chrome → `textMuted` / `textSecondary` (adapts light/dark).
//

import SwiftUI

// MARK: - Panel shell (web `GlassPanel` + `h3` title)

/// The titled glass panel shared by the data, empty, loading, and error states so the
/// surface always shows the "Route Breakdown" heading and never collapses to a blank box.
struct TripLegListPanel<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSSectionTitle(TripLegListStrings.label("tripPlanner.legs.title", "Route Breakdown"))
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Data state (the interleaved leg + charge-stop cards)

/// The resolved data state — the titled panel wrapping the per-leg cards, each lifted
/// in with the shared fade (web `FadeIn`, `delay={idx * 0.03}`).
struct TripLegListContentView: View {
    let rows: [TripLegRow]

    var body: some View {
        TripLegListPanel {
            VStack(spacing: TSSpacing.md) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                    TripLegRowView(row: row, delay: Double(idx) * 0.03)
                }
            }
        }
    }
}

/// One row of the breakdown: the leg card plus the charge stop that follows it (when
/// the source attached one), wrapped together in one fade so they animate as a unit.
struct TripLegRowView: View {
    let row: TripLegRow
    let delay: Double

    var body: some View {
        TSFadeIn(delay: delay) {
            VStack(spacing: TSSpacing.sm) {
                TripLegCard(row: row)
                if let stop = row.chargeStop {
                    TripChargeStopCard(stop: stop)
                        .padding(.leading, TSSpacing.md)
                }
            }
        }
    }
}

// MARK: - Leg card (web non-chrome render: header + metrics grid)

/// The leg card — the rounded, bordered container holding the index chip, the from→to
/// header, and the four metrics. One VoiceOver element with a spoken summary.
struct TripLegCard: View {
    let row: TripLegRow

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            metrics
        }
        .tripLegCardSurface()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: "\(row.index)")
                .font(Font.TS.caption)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: 24, height: 24)
                .background(Color.TS.textPrimary.opacity(0.06), in: Circle())
                .accessibilityHidden(true)
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "mappin.circle.fill")
                    .imageScale(.small)
                    .foregroundStyle(Color.TS.statusSuccess)
                Text(verbatim: row.fromLabel)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "arrow.right")
                    .imageScale(.small)
                    .foregroundStyle(Color.TS.textMuted)
                Image(systemName: "mappin.circle.fill")
                    .imageScale(.small)
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: row.toLabel)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityHidden(true)
    }

    private var metrics: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 116), spacing: TSSpacing.md, alignment: .leading)],
            alignment: .leading,
            spacing: TSSpacing.sm
        ) {
            TripMetric(label: TripLegListStrings.string("tripPlanner.legs.distance", "Distance")) {
                TripMetricValue(text: row.distanceText)
            }
            TripMetric(label: TripLegListStrings.string("tripPlanner.legs.duration", "Duration")) {
                TripMetricValue(text: "\(row.durationMinutesValue) \(TripLegStrings.minute)")
            }
            TripMetric(label: TripLegListStrings.string("tripPlanner.legs.energy", "Energy")) {
                TripMetricValue(text: row.energyText)
            }
            TripMetric(label: TripLegListStrings.string("tripPlanner.legs.soc", "Battery")) {
                TripBatteryValue(
                    startText: row.startSocText,
                    arrivalText: row.arrivalSocText,
                    arrivalLow: row.arrivalSocLow
                )
            }
        }
        .accessibilityHidden(true)
    }

    private var accessibilityLabel: String {
        let route = String(
            format: TripLegListStrings.string("tripPlanner.legs.a11y.route", "Leg %1$lld, from %2$@ to %3$@"),
            row.index,
            row.fromLabel,
            row.toLabel
        )
        let battery = String(
            format: TripLegListStrings.string("tripPlanner.legs.a11y.battery", "%1$@ to %2$@"),
            row.startSocText,
            row.arrivalSocText
        )
        return TripLegAccessibility.summary([
            route,
            TripLegStrings.pair("tripPlanner.legs.distance", "Distance", row.distanceText),
            TripLegStrings.pair(
                "tripPlanner.legs.duration", "Duration", "\(row.durationMinutesValue) \(TripLegStrings.minute)"
            ),
            TripLegStrings.pair("tripPlanner.legs.energy", "Energy", row.energyText),
            TripLegStrings.pair("tripPlanner.legs.soc", "Battery", battery)
        ])
    }
}

/// A labelled metric cell (web caption over value): a muted caption over the
/// caller-supplied value, stretched so the grid columns align.
struct TripMetric<Value: View>: View {
    let label: String
    @ViewBuilder let value: () -> Value

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            value()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A plain metric value (web `text-[var(--text-primary)] font-medium`).
struct TripMetricValue: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.body)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textPrimary)
            .monospacedDigit()
    }
}

/// The battery metric value — `start% → arrival%` with the start tinted success and the
/// arrival tinted danger (low) or warning, the arrow muted (web emerald → rose/amber).
struct TripBatteryValue: View {
    let startText: String
    let arrivalText: String
    let arrivalLow: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: startText)
                .foregroundStyle(Color.TS.statusSuccess)
            Text(verbatim: "→")
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: arrivalText)
                .foregroundStyle(arrivalLow ? Color.TS.statusDanger : Color.TS.statusWarning)
        }
        .font(Font.TS.body)
        .fontWeight(.medium)
        .monospacedDigit()
    }
}

// MARK: - Charge stop block (web blue `Zap` callout after a leg)

/// The charging stop inserted after a leg — a tinted, bordered callout with the bolt
/// glyph, the charger name, the wrapping meta row, and the optional "recommended" note.
struct TripChargeStopCard: View {
    let stop: TripChargeStopRow

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .imageScale(.small)
                .foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: stop.name)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.statusInfo)
                meta
                if stop.isRecommended {
                    TripLegListStrings
                        .text(
                            "tripPlanner.legs.recommended",
                            "Recommended stop point — actual charger locations may vary"
                        )
                        .font(Font.TS.caption)
                        .italic()
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusInfo.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusInfo.opacity(0.22), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var meta: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 92), spacing: TSSpacing.md, alignment: .leading)],
            alignment: .leading,
            spacing: TSSpacing.xs
        ) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock")
                    .imageScale(.small)
                    .accessibilityHidden(true)
                Text(verbatim: "\(stop.durationMinutesValue) \(TripLegStrings.minute)")
            }
            .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: stop.socRangeText)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: stop.energyText)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: stop.costText)
                .foregroundStyle(Color.TS.statusSuccess)
        }
        .font(Font.TS.bodySm)
        .monospacedDigit()
        .accessibilityHidden(true)
    }

    private var accessibilityLabel: String {
        let header = String(
            format: TripLegListStrings.string("tripPlanner.legs.a11y.chargeStop", "Charging stop, %@"),
            stop.name
        )
        let recommended = stop.isRecommended
            ? TripLegListStrings.string(
                "tripPlanner.legs.recommended",
                "Recommended stop point — actual charger locations may vary"
            )
            : ""
        return TripLegAccessibility.summary([
            header,
            TripLegStrings.pair(
                "tripPlanner.legs.duration", "Duration", "\(stop.durationMinutesValue) \(TripLegStrings.minute)"
            ),
            TripLegStrings.pair("tripPlanner.legs.soc", "Battery", stop.socRangeText),
            TripLegStrings.pair("tripPlanner.legs.energy", "Energy", stop.energyText),
            TripLegStrings.pair("tripPlanner.legs.a11y.cost", "Cost", stop.costText),
            recommended
        ])
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the panel when the feed is not live — a coloured
/// dot + label (`Stale` / `Offline`); a button so users can re-request the snapshot.
struct TripLegListFreshnessChip: View {
    let connection: TripLegListConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: TripLegListStrings.string("tripPlanner.legs.live", "Live")
        case .stale: TripLegListStrings.string("tripPlanner.legs.stale", "Stale")
        case .offline: TripLegListStrings.string("tripPlanner.legs.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            TripLegListStrings.string("tripPlanner.legs.staleA11y", "Stale — tap to refresh")
        case .offline:
            TripLegListStrings.string("tripPlanner.legs.offlineA11y", "Offline — showing last known data")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}

// MARK: - String helpers (i18n composition through the P1/S10 facade)

/// Small composition helpers over the surface's string table so the views hold no
/// English literals: the localized "min" suffix and a "label value" a11y pair.
enum TripLegStrings {
    static var minute: String {
        TripLegListStrings.string("common.min", "min")
    }

    static func pair(_ key: String, _ fallback: String, _ value: String) -> String {
        "\(TripLegListStrings.string(key, fallback)) \(value)"
    }
}

private extension View {
    /// The leg card's rounded, bordered container (web `rounded-lg border bg-white/[0.02]`).
    func tripLegCardSurface() -> some View {
        padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.textPrimary.opacity(0.02),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
