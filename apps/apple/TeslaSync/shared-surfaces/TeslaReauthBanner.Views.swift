//
//  TeslaReauthBanner.Views.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  The presentational subviews composed by the surface: the disconnection notice (the native parity of
//  the web `TeslaReauthBanner` — a warning-toned alert row with the title + reassurance body and the
//  "Reconnect" / "Dismiss" affordances) and the freshness chip (P4 connectivity axis). All consume the
//  P1/S10 facade and the shared P1/S9 tokens / components — no networking, no Tailwind ports, no raw
//  hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web amber accent (`amber-500` tint, `amber-300`
//  icon) maps to the brand `statusWarning`, exactly as the shared `TSAlertBanner` warning tone does, so
//  the row reads as a "warning" notice in both light and dark themes.
//
//  Accessibility note: the title + reassurance body form one VoiceOver element (the web `role="alert"`
//  region), while the "Reconnect" and "Dismiss" controls stay individually focusable with their own
//  labels (web real `<button>`s — the dismiss carries the `common.dismiss` `aria-label`). The layout
//  reflows the controls beneath the copy when width is tight so it survives Dynamic Type and narrow
//  columns.
//

import SwiftUI

// MARK: - Disconnection notice (web `TeslaReauthBanner` visible render)

/// The disconnection notice — the native parity of the web `TeslaReauthBanner` body. Renders the
/// warning icon, the title + pre-composed reassurance copy, and the "Reconnect" + "Dismiss" affordances
/// over the shared warning-toned banner treatment.
public struct TeslaReauthNoticeView: View {
    private let copy: TeslaReauthCopy
    private let onReconnect: () -> Void
    private let onDismiss: () -> Void

    public init(
        copy: TeslaReauthCopy,
        onReconnect: @escaping () -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.copy = copy
        self.onReconnect = onReconnect
        self.onDismiss = onDismiss
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconBox

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    messageColumn
                    actions
                }
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    messageColumn
                    actions
                }
            }
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
        .accessibilityElement(children: .contain)
    }

    private var iconBox: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.TS.statusWarning)
            .padding(TSSpacing.sm)
            .background(
                Color.TS.statusWarning.opacity(0.15),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var messageColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: copy.title)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: copy.body)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TeslaReauthAccessibility.bannerLabel(copy: copy)))
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .primary, size: .small, action: onReconnect) {
                Text(verbatim: copy.cta)
            }
            .accessibilityLabel(Text(verbatim: copy.cta))

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.semibold))
                    .padding(TSSpacing.xs)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: copy.dismiss))
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the auth signal is not live — a coloured dot + a
/// label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct TeslaReauthFreshnessChip: View {
    let connection: TeslaReauthConnection
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
        case .live: TeslaReauthStrings.string("tesla.reauth.live", "Live")
        case .stale: TeslaReauthStrings.string("tesla.reauth.stale", "Stale")
        case .offline: TeslaReauthStrings.string("tesla.reauth.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            TeslaReauthStrings.string("tesla.reauth.staleA11y", "Stale — tap to refresh")
        case .offline:
            TeslaReauthStrings.string("tesla.reauth.offlineA11y", "Offline — showing the last known status")
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
