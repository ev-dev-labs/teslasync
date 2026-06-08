//
//  ChargingSessionCard.Elements.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The atomic pieces the history row reproduces inline (the native counterparts of
//  the web shared components `Badge`, `ScoreBadge`, `InlineMetric`, `BatteryDelta`,
//  `RouteDisplay`, `Checkbox`). Each consumes pre-localized strings + the shared
//  P1/S9 tokens — no literals, no hardcoded hexes.
//

import SwiftUI

// MARK: - Badge (web `Badge` size `sm`)

/// A small status chip: a toned label on a matching tint fill + border, satisfying
/// the "neon chip" exception (colour + bg + border on the same element).
struct ChargingSessionBadge: View {
    let text: String
    let tone: ChargingSessionCardTone
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 9, weight: .semibold))
                    .accessibilityHidden(true)
            }
            Text(verbatim: text)
                .font(Font.TS.label)
                .fontWeight(.semibold)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Score badge (web `ScoreBadge` `md`)

/// The leading letter-grade badge: the letter is the badge, coloured by grade,
/// with the caller's overriding accessibility label (web `scoreAria`).
struct ChargingSessionScoreBadge: View {
    let grade: ChargingScoreGrade
    let accessibilityText: String

    var body: some View {
        Text(verbatim: grade.label)
            .font(.system(size: 20, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(grade.tone.color)
            .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Inline metric (web `InlineMetric`)

/// A compact icon + value metric chip. A `neutral` tone reads muted; any other
/// tone colours the value (web `className="text-emerald-300"`).
struct ChargingSessionInlineMetric: View {
    let systemImage: String
    let value: String
    var tone: ChargingSessionCardTone = .neutral

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: value)
                .monospacedDigit()
        }
        .font(Font.TS.caption)
        .foregroundStyle(tone == .neutral ? Color.TS.textMuted : tone.color)
    }
}

// MARK: - Battery delta (web `BatteryDelta`)

/// The compact battery state-of-charge change: the battery icon + the toned delta,
/// with the spoken from→to (or unknown) label resolved by the caller.
struct ChargingSessionBatteryDelta: View {
    let display: ChargingBatteryDeltaDisplay
    let accessibilityText: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "battery.100")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: display.label)
                .monospacedDigit()
        }
        .font(Font.TS.caption)
        .foregroundStyle(display.hasData ? display.tone.color : Color.TS.textMuted)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Route (web `RouteDisplay` explicit-single mode)

/// The single-endpoint charger location line: a map-pin + the resolved place,
/// falling back to a coordinate string, then to a "No location data" fallback.
struct ChargingSessionRoute: View {
    let place: String?
    let latitude: Double?
    let longitude: Double?
    let localize: (String, String) -> String

    private var label: String {
        if let trimmed = place?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty {
            return trimmed
        }
        if let latitude, let longitude {
            return "📍 \(String(format: "%.2f", latitude)), \(String(format: "%.2f", longitude))"
        }
        return localize("route.noLocation", "No location data")
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "mappin")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary.opacity(0.6))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }
}

// MARK: - Checkbox (web `Checkbox`)

/// The selection checkbox: a plain button toggling a check-square, carrying the
/// localized label + the selected accessibility trait.
struct ChargingSessionCheckbox: View {
    let selected: Bool
    let label: String
    let onToggle: (Bool) -> Void

    var body: some View {
        Button {
            onToggle(!selected)
        } label: {
            Image(systemName: selected ? "checkmark.square.fill" : "square")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(selected ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}
