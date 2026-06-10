//
//  VehicleCommandCenter.Banners.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The status / asleep / stale / command-status banners composed by `VehicleCommandCenter`
//  (web `lastResult` feedback panel, `isAsleep` panel, `commands.staleData` AlertBanner, and
//  the command-status query error). Each renders only when its condition holds; none perform I/O.
//

import SwiftUI

// MARK: - Banners (web status feedback + asleep + stale)

/// The last-command result banner (web `lastResult` panel): a tinted glass strip with a
/// success / failure glyph + message.
struct VCCFeedbackBanner: View {
    let result: VCCCommandResult

    var body: some View {
        let tone: TSTone = result.success ? .success : .danger
        let symbol = result.success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: symbol)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(verbatim: result.message)
                .font(Font.TS.caption)
                .foregroundStyle(tone.color)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: result.message))
    }
}

/// A generic inline callout strip (web `AlertBanner`) used for the asleep + stale states.
struct VCCInlineBanner: View {
    let tone: TSTone
    let systemImage: String
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(tone.color)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}

/// The asleep / offline banner (web `isAsleep` panel): "Vehicle is <state>. Wake it up
/// first to send commands."
struct VCCAsleepBanner: View {
    let state: String

    var body: some View {
        VCCInlineBanner(
            tone: .warning,
            systemImage: "powersleep",
            message: VehicleCommandCenterStrings.format(
                "commands.asleep",
                "Vehicle is %@. Wake it up first to send commands.",
                state
            )
        )
    }
}

/// The stale-data banner (web `commands.staleData` AlertBanner).
struct VCCStaleBanner: View {
    let ageLabel: String

    var body: some View {
        VCCInlineBanner(
            tone: .warning,
            systemImage: "clock.badge.exclamationmark",
            message: VehicleCommandCenterStrings.format(
                "commands.staleData",
                "Vehicle data is %@ old. The vehicle may be asleep or offline.",
                ageLabel
            )
        )
    }
}

/// The command-status query failure banner (web `useQuery` error) with a retry button.
struct VCCCommandStatusErrorBanner: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                VehicleCommandCenterStrings.text("commands.status.errorTitle", "Couldn't load command status")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRetry) {
                VehicleCommandCenterStrings.text("commands.status.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VehicleCommandCenterStrings.text("commands.status.retry", "Retry"))
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}
