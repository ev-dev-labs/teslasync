//
//  DrivingCoachSection.Views.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The presentational chrome + panels for the "Driving Coach" section: the header + freshness chip, the
//  stale / offline connectivity banner, the score radial gauge (web `RadialGauge`), the style-breakdown
//  split bar + legend, the avg / best efficiency stat cards (web `StatCard`), the threshold pattern bars,
//  the recommendation list, and the per-drive score table (web `DataTable` → shared `TSDataTable`). The
//  weekly-trend Swift Chart lives in DrivingCoachSection.Charts.swift and the load chrome in
//  DrivingCoachSection.States.swift. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9) — no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic): the web green / amber / red (`#22c55e` / `#f59e0b` / `#ef4444`) map to
//  the semantic `Color.TS.statusSuccess` / `statusWarning` / `statusDanger` tokens via `DrivingCoachBand`.
//

import SwiftUI

// MARK: - Band → semantic token (ADR-006)

extension DrivingCoachBand {
    /// The shared badge tone for this band.
    var tone: TSTone {
        switch self {
        case .good: .success
        case .warn: .warning
        case .bad: .danger
        }
    }

    /// The semantic colour token for this band (web green / amber / red).
    var color: Color {
        tone.color
    }
}

extension DrivingCoachStyle {
    /// The i18n key the web builds for the style label (`dynamics.coach.style.${key}`).
    var localizationKey: String {
        "dynamics.coach.style.\(rawValue)"
    }
}

// MARK: - Localized labels for dynamic enums

enum DrivingCoachLabels {
    /// The localized style word (web `t(\`dynamics.coach.style.${key}\`, key)`).
    static func style(_ style: DrivingCoachStyle) -> String {
        DrivingCoachSectionStrings.string(style.localizationKey, style.rawValue)
    }

    /// The localized impact word (web renders the raw `rec.impact`).
    static func impact(_ impact: DrivingCoachImpact) -> String {
        DrivingCoachSectionStrings.string("dynamics.coach.impact.\(impact.rawValue)", impact.rawValue)
    }
}

// MARK: - Header (web `<h2>Driving Coach</h2>`)

/// The section header: the web `Driving Coach` heading with a leading glyph and the live-state freshness
/// chip.
struct DrivingCoachSectionHeader: View {
    let connection: DrivingCoachConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "speedometer")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            DrivingCoachSectionStrings.text("dynamics.coach.title", "Driving Coach")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            DrivingCoachSectionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DrivingCoachSectionFreshnessChip: View {
    let connection: DrivingCoachConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DrivingCoachSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrivingCoachSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DrivingCoachConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "dynamics.coach.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "dynamics.coach.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "dynamics.coach.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached content is
/// clearly labelled (web `DataFreshness` intent).
struct DrivingCoachSectionConnectivityBanner: View {
    let connection: DrivingCoachConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "dynamics.coach.offlineBanner" : "dynamics.coach.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded coaching"
            : "Reconnecting — coaching may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            DrivingCoachSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Panel heading (web `<h3>` panel titles)

/// A panel sub-heading with an optional leading glyph (web `<h3 class="text-sm font-semibold">`).
struct DrivingCoachPanelHeading: View {
    let key: String
    let fallback: String
    var systemImage: String?
    var tint: Color = .TS.textPrimary

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
            }
            DrivingCoachSectionStrings.text(key, fallback)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

// MARK: - Inner empty (web per-panel `EmptyState`)

/// The compact inner empty row (web `EmptyState`): an icon over a muted message — never a blank panel, used
/// by the style / recommendations / per-drive panels when their own data is missing.
struct DrivingCoachInnerEmpty: View {
    let key: String
    let fallback: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "tray")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DrivingCoachSectionStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 96)
        .accessibilityElement(children: .combine)
    }
}
