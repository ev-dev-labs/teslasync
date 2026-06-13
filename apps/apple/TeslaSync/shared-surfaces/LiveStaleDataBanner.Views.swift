//
//  LiveStaleDataBanner.Views.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  The presentational subviews composed by the surface: the stale-data warning card (the native parity
//  of the web `LiveStaleDataBanner` — a warning-toned alert banner with the "Live data unavailable"
//  title + the "offline for more than 2 minutes…" reassurance) and the connection chip (P4
//  status-reading axis). All consume the P1/S10 facade and the shared P1/S9 tokens — no transport
//  monitoring, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `variant="warning"` accent (neon amber) maps
//  to the brand `statusWarning`, exactly as the shared `TSAlertBanner` warning tone does, so the banner
//  reads as a "warning" notice in both light and dark themes. The web `<WifiOff/>` glyph maps to the
//  `wifi.slash` SF Symbol.
//
//  Accessibility note: the web banner is an `AlertBanner` with `role="status"` + `aria-live="polite"`,
//  so the title + reassurance are announced as one polite update. The card mirrors that by forming a
//  single VoiceOver element whose label is the pre-composed `accessibilitySummary` (title + body + the
//  optional reconnecting note) and which marks itself as a status update. The chip stays an individually
//  focusable button with its own contextual label.
//

import SwiftUI

// MARK: - Stale-data warning card (web `LiveStaleDataBanner` render)

/// The stale-data warning — the native parity of the web `LiveStaleDataBanner` body. Renders the
/// wifi-slash icon, the "Live data unavailable" title, and the "offline for more than 2 minutes…"
/// reassurance over the shared warning-toned banner treatment.
public struct LiveStaleDataBannerCard: View {
    private let data: LiveStaleDataBannerData

    public init(data: LiveStaleDataBannerData) {
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

// MARK: - Connection chip (P4 status-reading axis)

/// The connection chip shown beneath the warning banner — a coloured dot + a label ("Offline" / "Stale")
/// over the warning tone. A button so VoiceOver and pointer users can ask the host to re-subscribe to
/// the live transport, with an explicit contextual label. `live` freshness reads "Offline" (the wire is
/// down); `stale` reads "Stale" (we have not been able to re-confirm the status).
struct LiveStaleDataBannerChip: View {
    let freshness: LiveStaleFreshness
    let onRefresh: () -> Void

    private var label: String {
        switch freshness {
        case .live: LiveStaleDataBannerStrings.string("live.staleBanner.chip.offline", "Offline")
        case .stale: LiveStaleDataBannerStrings.string("live.staleBanner.chip.stale", "Stale")
        }
    }

    private var accessibilityLabelText: String {
        switch freshness {
        case .live:
            LiveStaleDataBannerStrings.string(
                "live.staleBanner.offlineA11y", "Live data offline — tap to try reconnecting"
            )
        case .stale:
            LiveStaleDataBannerStrings.string(
                "live.staleBanner.staleA11y", "Live connection check is stale — tap to retry"
            )
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
