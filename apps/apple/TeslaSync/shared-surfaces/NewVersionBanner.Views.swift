//
//  NewVersionBanner.Views.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The presentational subviews composed by ``NewVersionBanner`` for its data render: the
//  available-version banner card (the native parity of the web banner body — the emerald-tinted,
//  ringed row with a Sparkles glyph, the availability message, and the "Later" / "Reload" affordances)
//  and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade and the shared P1/S9
//  tokens / components (`TSButton` ← web `Button`) — no networking, no Tailwind ports, no raw hex.
//
//  Accessibility note: the row is one spoken status element (the web `role="status" aria-live`), with
//  the availability message + target version as its combined label; the "Later" / "Reload" controls
//  are standalone `TSButton`s beneath it so each affordance stays an individually focusable VoiceOver
//  element with its own label. The Sparkles glyph is decorative (web `aria-hidden`).
//

import SwiftUI

// MARK: - Available-version banner (web banner body)

/// The available-version banner — the data render of the surface. Reproduces the web banner exactly:
/// the emerald-tinted glass row, the Sparkles glyph, the availability message, and the "Later" /
/// "Reload" affordances (the web `handleLater` / `handleReload`). Both affordances always render — the
/// web banner always offers both.
struct NewVersionBannerCard: View {
    let data: NewVersionBannerData
    let onReload: () -> Void
    let onLater: () -> Void

    private var message: String {
        NewVersionBannerStrings.string("app.newVersion.message", "A new version of TeslaSync is available.")
    }

    private var laterLabel: String {
        NewVersionBannerStrings.string("app.newVersion.later", "Later")
    }

    private var reloadLabel: String {
        NewVersionBannerStrings.string("app.newVersion.reload", "Reload")
    }

    private var versionDetail: String {
        let template = NewVersionBannerStrings.string("app.newVersion.versionDetailA11y", "Version {version}")
        return template.replacingOccurrences(of: "{version}", with: data.latestVersion)
    }

    private var accessibilityLabel: String {
        NewVersionBannerAccessibility.bannerLabel(message: message, versionDetail: versionDetail)
    }

    var body: some View {
        TSFadeIn {
            HStack(spacing: TSSpacing.md) {
                glyph
                Text(verbatim: message)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityHidden(true)
                actions
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusSuccess.opacity(0.30), lineWidth: 1)
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var glyph: some View {
        Image(systemName: "sparkles")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.TS.statusSuccess)
            .frame(width: 32, height: 32)
            .background(
                Color.TS.statusSuccess.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.xs) {
            TSButton(variant: .ghost, size: .small, action: onLater) {
                Text(verbatim: laterLabel)
            }
            .accessibilityLabel(Text(verbatim: laterLabel))
            TSButton(variant: .primary, size: .small, action: onReload) {
                Text(verbatim: reloadLabel)
            }
            .accessibilityLabel(Text(verbatim: reloadLabel))
        }
        .fixedSize()
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the surface when the version feed is not live — a coloured dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the probe,
/// with an explicit label.
struct NewVersionBannerFreshnessChip: View {
    let connection: NewVersionConnection
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
        case .live: NewVersionBannerStrings.string("app.newVersion.live", "Live")
        case .stale: NewVersionBannerStrings.string("app.newVersion.stale", "Stale")
        case .offline: NewVersionBannerStrings.string("app.newVersion.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            NewVersionBannerStrings.string("app.newVersion.staleA11y", "Update check is stale — tap to refresh")
        case .offline:
            NewVersionBannerStrings.string("app.newVersion.offlineA11y", "Offline — showing the last known version")
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
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
