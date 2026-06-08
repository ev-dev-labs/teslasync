//
//  SessionListSection.Row.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  One session row — the SwiftUI parity of `ChargingSessionCard.tsx`. Composes the
//  optional selection toggle (web `Checkbox`), the leading score badge (web
//  `ScoreBadge`), the primary line (timestamp · duration · category · energy · free
//  badges), the location, and the wrapping inline metrics (battery delta, peak / avg
//  power, duration, cost, cost-per-kWh, distance added). All values format through
//  the injected facades (no view-side networking); badges + metrics wrap via
//  `SessionFlowLayout`, matching the web `flex-wrap` rows.
//

import SwiftUI

/// A single charging-session row.
struct SessionRow: View {
    let item: SessionListItem
    let formatting: any SessionListFormatting
    let units: any SessionListUnits
    let localize: (String, String) -> String
    let selectable: Bool
    let selected: Bool
    let onToggleSelect: (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            if selectable {
                selectionToggle
            }
            if let score = item.batteryScore {
                SessionScoreBadge(score: score, localize: localize)
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                SessionFlowLayout(spacing: TSSpacing.sm) { primaryBadges }
                if let place = locationText {
                    locationRow(place)
                }
                SessionFlowLayout(spacing: TSSpacing.md) { metrics }
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(background)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(selected ? Color.TS.accent.opacity(0.5) : Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(selected ? Color.TS.accent.opacity(0.08) : Color.TS.surfaceGlass)
    }

    // MARK: Selection toggle (web `Checkbox`)

    private var selectionToggle: some View {
        Button { onToggleSelect(!selected) } label: {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(selected ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SessionListStrings.text("charging.selectSession", "Select charging session"))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Primary badges (web primary line)

    @ViewBuilder
    private var primaryBadges: some View {
        Text(verbatim: timestampText)
            .font(Font.TS.bodySm)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
        if item.durationMinutes > 0 {
            Text(verbatim: "· \(formatting.formatDuration(minutes: item.durationMinutes))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        }
        SessionCategoryBadge(category: item.category, localize: localize)
        if item.energyKwh > 0 {
            SessionBadge(text: energyText, tone: Color.TS.statusInfo)
        }
        if item.isFree, item.energyKwh > 0 {
            SessionBadge(
                text: localize("charging.free", "Free"),
                tone: Color.TS.statusSuccess,
                systemImage: "sun.max.fill"
            )
        }
    }

    // MARK: Location (web `RouteDisplay` single endpoint)

    private func locationRow(_ place: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: place)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }

    // MARK: Metrics (web `InlineMetric` row)

    @ViewBuilder
    private var metrics: some View {
        if let delta = batteryDeltaText {
            SessionMetricChip(systemImage: "battery.50", text: delta)
        }
        if let peak = item.peakPowerKw {
            SessionMetricChip(systemImage: "chart.line.uptrend.xyaxis", text: peakText(peak))
        }
        if let avg = item.avgPowerKw {
            SessionMetricChip(systemImage: "powerplug", text: avgText(avg))
        }
        if item.durationMinutes > 0 {
            SessionMetricChip(systemImage: "clock", text: formatting.formatDuration(minutes: item.durationMinutes))
        }
        if let cost = item.costDecimal, cost > 0 {
            SessionMetricChip(
                systemImage: "dollarsign.circle",
                text: formatting.formatCurrency(cost),
                tone: Color.TS.statusSuccess
            )
        }
        if let cpk = item.costPerKwh {
            Text(verbatim: costPerKwhText(cpk))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        }
        if let distance = distanceText {
            SessionMetricChip(systemImage: "bolt.fill", text: distance, tone: Color.TS.accent)
        }
    }

    // MARK: Derived display strings

    private var timestampText: String {
        DateFormatter.sessionListMedium.string(from: item.startedAt)
    }

    private var energyText: String {
        "\(formatting.formatNumber(item.energyKwh)) kWh"
    }

    private var locationText: String? {
        guard let place = item.startPlace?.trimmingCharacters(in: .whitespacesAndNewlines), !place.isEmpty else {
            return nil
        }
        return place
    }

    private var batteryDeltaText: String? {
        guard let start = item.startSocPct, let end = item.endSocPct else { return nil }
        return "\(Int(start.rounded()))% → \(Int(end.rounded()))%"
    }

    private func peakText(_ kilowatts: Double) -> String {
        let value = formatting.formatNumber(kilowatts)
        return SessionListStrings.string("charging.sessions.peakPower", "{{value}} kW peak")
            .replacingOccurrences(of: "{{value}}", with: value)
    }

    private func avgText(_ kilowatts: Double) -> String {
        let value = formatting.formatNumber(kilowatts)
        return SessionListStrings.string("charging.sessions.avgPower", "~{{value}} kW avg")
            .replacingOccurrences(of: "{{value}}", with: value)
    }

    private func costPerKwhText(_ value: Double) -> String {
        "(\(formatting.formatCurrency(value, decimals: 2))/kWh)"
    }

    private var distanceText: String? {
        guard let meters = item.distanceAddedM else { return nil }
        let display = units.distanceDisplay(kilometers: meters / 1000)
        guard display > 0 else { return nil }
        return "+\(formatting.formatInt(display)) \(units.distanceUnit)"
    }

    private var accessibilityLabel: String {
        SessionListAccessibility.rowLabel(item, formatting: formatting, localize: localize)
    }
}
