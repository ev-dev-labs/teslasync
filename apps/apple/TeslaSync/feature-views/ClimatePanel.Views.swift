//
//  ClimatePanel.Views.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  The presentational subviews composed by `ClimatePanel`: the header (Thermometer + "Climate" +
//  freshness chip), the Cabin / Outside temperature cards, the Driver / Passenger setpoint rows,
//  the HVAC State row, the six-bar Fan Speed meter, the Defrost / Climate / Precondition badges,
//  the loading skeleton, the empty state (web `EmptyState`), the QueryError-equivalent failure
//  with retry, and the stale / offline banner. All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 design tokens — no networking, no Tailwind ports. Each semantic
//  tone maps to a `Color.TS` token here so the projection stays SwiftUI-free.
//

import SwiftUI

// MARK: - Tone → design-token color

extension CabinClimatePanelTone {
    /// The `Color.TS` token for a value or badge accent. `.info` is the web blue defrost accent;
    /// `.primary` is the web mono value color; `.neutral` is the web muted text.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .info: Color.TS.statusInfo
        case .neutral: Color.TS.textMuted
        case .primary: Color.TS.textPrimary
        }
    }
}

// MARK: - Header (web `<h3 class="section-title"><Thermometer/> Climate</h3>` + chip)

/// The panel header: the cyan Thermometer glyph, the "Climate" title, and — when the bound source
/// is not live — the freshness chip pinned to the trailing edge.
struct CabinClimatePanelHeader: View {
    let connection: CabinClimatePanelConnection
    let showsFreshness: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "thermometer.medium")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: CabinClimatePanelStrings.string("common.climate", "Climate"))
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshness {
                CabinClimatePanelFreshnessChip(connection: connection)
            }
        }
    }
}

// MARK: - Content (web `climateData` branch)

/// The resolved content body. The stale / offline banner appears above the rows when the bound
/// source is not live; then the temperature cards, the setpoint + HVAC rows, the fan meter, and
/// the system badges — mirroring the web `space-y-4` stack.
struct CabinClimatePanelContentView: View {
    let content: CabinClimatePanelContentModel
    let connection: CabinClimatePanelConnection
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if connection != .live {
                CabinClimatePanelConnectivityBanner(connection: connection, onRefresh: onRefresh)
            }
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                CabinClimatePanelMetricCard(metric: content.cabin)
                CabinClimatePanelMetricCard(metric: content.outside)
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                CabinClimatePanelRow(row: content.driverSetpoint)
                CabinClimatePanelRow(row: content.passengerSetpoint)
                CabinClimatePanelRow(row: content.hvacState)
            }
            CabinClimatePanelFanMeter(fan: content.fan)
            CabinClimatePanelBadgeRow(badges: content.badges)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Metric card (web `MetricCard` — Cabin / Outside)

/// One temperature metric card: the muted label over the prominent value, in a tinted glass box.
/// The whole card is a single VoiceOver element reading "{label}: {value}".
struct CabinClimatePanelMetricCard: View {
    let metric: CabinClimatePanelMetricModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: metric.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: metric.value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: metric.accessibilityLabel))
    }
}

// MARK: - Row (web label → mono value: setpoints + HVAC state)

/// One label → value row: a muted caption label and a trailing monospaced value. One VoiceOver
/// element per row.
struct CabinClimatePanelRow: View {
    let row: CabinClimatePanelRowModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: row.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.value)
                .font(Font.TS.body)
                .monospaced()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
    }
}

// MARK: - Fan meter (web six bars of increasing width + numeric level)

/// The fan-speed meter: the "Fan Speed" label with the fan glyph, six bars of increasing width
/// (filled up to the current level in the cyan accent, the rest faint), and the numeric value.
/// One VoiceOver element reading "Fan Speed: {n}".
struct CabinClimatePanelFanMeter: View {
    let fan: CabinClimatePanelFanModel

    /// Bar widths matching the web ramp (`w-1.5 … w-4` → 6…16pt).
    private func barWidth(_ level: Int) -> CGFloat {
        6 + CGFloat(level - 1) * 2
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "fanblades.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: fan.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            HStack(alignment: .center, spacing: TSSpacing.xs / 2) {
                ForEach(1 ... CabinClimatePanelFanModel.barCount, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 1, style: .continuous)
                        .fill(level <= fan.filledBars ? Color.TS.accent.opacity(0.7) : Color.TS.border)
                        .frame(width: barWidth(level), height: 12)
                }
                Text(verbatim: fan.valueText)
                    .font(Font.TS.caption)
                    .monospaced()
                    .foregroundStyle(Color.TS.textPrimary)
                    .padding(.leading, TSSpacing.xs / 2)
            }
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: fan.accessibilityLabel))
    }
}

// MARK: - System badges (web Defrost / Climate / Precondition pills)

/// The wrapping row of system badges (web `flex flex-wrap gap-2`). Wraps under Dynamic Type via
/// the flow layout so long labels never clip.
struct CabinClimatePanelBadgeRow: View {
    let badges: [CabinClimatePanelBadgeModel]

    var body: some View {
        CabinClimatePanelFlowLayout(spacing: TSSpacing.sm) {
            ForEach(badges) { badge in
                CabinClimatePanelBadge(badge: badge)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One system badge: a rounded pill with an optional leading glyph and the composed label. The
/// active badge is tinted in its accent tone; the inactive badge is a faint muted pill (web
/// `border-white/[0.06] bg-white/[0.02]`). One VoiceOver element per badge.
struct CabinClimatePanelBadge: View {
    let badge: CabinClimatePanelBadgeModel

    private var tint: Color {
        badge.active ? badge.tone.color : Color.TS.textMuted
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let icon = badge.systemImage {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .accessibilityHidden(true)
            }
            Text(verbatim: badge.text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tint.opacity(badge.active ? 0.1 : 0.04), in: Capsule())
        .overlay(Capsule().strokeBorder(tint.opacity(badge.active ? 0.3 : 0.12), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: badge.accessibilityLabel))
    }
}
