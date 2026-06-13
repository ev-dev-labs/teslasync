//
//  MaintenanceBanner.Views.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  The presentational subviews composed by the surface: the maintenance / degraded notice (the native
//  parity of the web `MaintenanceBanner` — a tinted banner with an icon chip, the headline, the body
//  copy, the live countdown, and the dismiss control) and the freshness chip (P4 connectivity axis). All
//  consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking, no Tailwind ports,
//  no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web maintenance "amber" tone maps to the brand
//  `statusWarning`, and the web degraded "sky" tone maps to the brand `statusInfo`, so each notice reads
//  with the same urgency in both light and dark themes. The fill / border / icon-chip opacities mirror
//  the web `bg-{tone}/[0.08]` / `border-{tone}/30` / `bg-{tone}/15` treatment.
//
//  Accessibility note: the headline + body + countdown form one VoiceOver element (the web banner's
//  `role` alert/status, `aria-live="polite"` content announced together), while the dismiss control
//  stays individually focusable with its own label (web real `<button aria-label>`).
//

import SwiftUI

// MARK: - Maintenance / degraded notice (web `MaintenanceBanner` render)

/// The maintenance / degraded notice — the native parity of the web `MaintenanceBanner` body. Renders
/// the mode icon chip, the headline, the body copy, the live countdown (when a window end is set), and
/// the dismiss control over the shared tinted banner treatment.
public struct MaintenanceBannerNoticeView: View {
    private let data: MaintenanceBannerData
    private let countdown: String?
    private let onDismiss: () -> Void

    public init(data: MaintenanceBannerData, countdown: String?, onDismiss: @escaping () -> Void) {
        self.data = data
        self.countdown = countdown
        self.onDismiss = onDismiss
    }

    private var tint: Color {
        data.isMaintenance ? Color.TS.statusWarning : Color.TS.statusInfo
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            content
            Spacer(minLength: TSSpacing.sm)
            dismissButton
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            tint.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tint.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: data.systemImageName)
            .font(Font.TS.bodySm)
            .foregroundStyle(tint)
            .padding(TSSpacing.xs)
            .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .accessibilityHidden(true)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: data.title)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: data.body)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let countdown {
                Text(verbatim: countdown)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isStaticText)
        .accessibilityLabel(Text(verbatim: MaintenanceBannerAccessibility.bannerLabel(
            title: data.title,
            body: data.body,
            countdown: countdown
        )))
    }

    private var dismissButton: some View {
        Button(action: onDismiss) {
            Image(systemName: "xmark")
                .font(.caption2)
                .fontWeight(.semibold)
                .padding(TSSpacing.xs)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textSecondary)
        .accessibilityLabel(Text(verbatim: MaintenanceBannerMessage.dismiss()))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the health feed is not live — a coloured dot + a
/// label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct MaintenanceBannerFreshnessChip: View {
    let connection: MaintenanceBannerConnection
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
        case .live: MaintenanceBannerStrings.string("serviceMode.live", "Live")
        case .stale: MaintenanceBannerStrings.string("serviceMode.stale", "Stale")
        case .offline: MaintenanceBannerStrings.string("serviceMode.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            MaintenanceBannerStrings.string("serviceMode.staleA11y", "Stale — tap to refresh")
        case .offline:
            MaintenanceBannerStrings.string(
                "serviceMode.offlineA11y",
                "Offline — showing the last known service status"
            )
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
