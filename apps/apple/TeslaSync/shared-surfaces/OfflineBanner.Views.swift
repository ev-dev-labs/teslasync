//
//  OfflineBanner.Views.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  The presentational subviews composed by the surface: the offline warning card (the native parity of
//  the web `OfflineBanner` — a warning-toned alert banner with the "You're offline" title + the
//  "Showing cached data…" reassurance) and the freshness chip (P4 connectivity-reading axis). All
//  consume the P1/S10 facade and the shared P1/S9 tokens — no monitoring, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `variant="warning"` accent (neon amber) maps
//  to the brand `statusWarning`, exactly as the shared `TSAlertBanner` warning tone does, so the banner
//  reads as a "warning" notice in both light and dark themes. The web `<WifiOff/>` glyph maps to the
//  `wifi.slash` SF Symbol.
//
//  Accessibility note: the web banner is an `AlertBanner` with `role="status"` + `aria-live="polite"`,
//  so the title + reassurance are announced as one polite update. The card mirrors that by forming a
//  single VoiceOver element whose label is the pre-composed `accessibilitySummary` (title + body + the
//  optional stale note) and which marks itself as a status update.
//

import SwiftUI

// MARK: - Offline warning card (web `OfflineBanner` render)

/// The offline warning — the native parity of the web `OfflineBanner` body. Renders the wifi-slash
/// icon, the "You're offline" title, and the "Showing cached data…" reassurance over the shared
/// warning-toned banner treatment.
public struct OfflineBannerCard: View {
    private let data: OfflineBannerData

    public init(data: OfflineBannerData) {
        self.data = data
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "wifi.slash")
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: data.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: data.body)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusWarning.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: data.accessibilitySummary))
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Freshness chip (P4 connectivity-reading axis)

/// The freshness chip shown beneath the offline banner — a coloured dot + a label ("Offline" / "Stale")
/// over the warning tone. A button so VoiceOver and pointer users can re-probe connectivity, with an
/// explicit contextual label.
struct OfflineBannerFreshnessChip: View {
    let freshness: OfflineFreshness
    let onRefresh: () -> Void

    private var label: String {
        switch freshness {
        case .live: OfflineBannerStrings.string("pwa.offline.chip.offline", "Offline")
        case .stale: OfflineBannerStrings.string("pwa.offline.chip.stale", "Stale")
        }
    }

    private var accessibilityLabelText: String {
        switch freshness {
        case .live:
            OfflineBannerStrings.string("pwa.offline.offlineA11y", "Offline — showing cached data")
        case .stale:
            OfflineBannerStrings.string("pwa.offline.staleA11y", "Connection check is stale — tap to recheck")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(Color.TS.statusWarning).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
