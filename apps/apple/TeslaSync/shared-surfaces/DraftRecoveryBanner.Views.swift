//
//  DraftRecoveryBanner.Views.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  The presentational subviews composed by the surface: the recovered-draft notice (the native parity
//  of the web `DraftRecoveryBanner` — an info-toned alert banner with the reassurance copy and the
//  "Use draft" / "Discard draft" affordances) and the freshness chip (P4 connectivity axis). All
//  consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking, no Tailwind
//  ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `variant="info"` accent (neon cyan) maps to
//  the brand `statusInfo`, exactly as the shared `TSAlertBanner` info tone does, so the banner reads
//  as an "info" notice in both light and dark themes.
//
//  Accessibility note: the reassurance message forms one VoiceOver element (the web `AlertBanner`
//  body), while the "Use draft" and "Discard draft" controls stay individually focusable with their
//  own labels (web real `<button>`s). The layout reflows the controls beneath the message when width
//  is tight (web `flex-wrap`) so it survives Dynamic Type and narrow columns.
//

import SwiftUI

// MARK: - Recovered-draft notice (web `DraftRecoveryBanner` data render)

/// The recovered-draft notice — the native parity of the web `DraftRecoveryBanner` body. Renders the
/// info icon, the pre-composed reassurance message, and the "Use draft" + "Discard draft" affordances
/// over the shared info-toned banner treatment.
public struct DraftRecoveryNoticeView: View {
    private let data: DraftRecoveryBannerData
    private let onRestore: () -> Void
    private let onDiscard: () -> Void

    public init(
        data: DraftRecoveryBannerData,
        onRestore: @escaping () -> Void,
        onDiscard: @escaping () -> Void
    ) {
        self.data = data
        self.onRestore = onRestore
        self.onDiscard = onDiscard
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    messageText
                    actions
                }
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    messageText
                    actions
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusInfo.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusInfo.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var messageText: some View {
        Text(verbatim: data.message)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: DraftRecoveryAccessibility.bannerLabel(message: data.message)))
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .ghost, size: .small, action: onRestore) {
                Text(verbatim: DraftRecoveryStrings.string("draft.useDraft", "Use draft"))
            }
            .accessibilityLabel(Text(verbatim: DraftRecoveryStrings.string("draft.useDraft", "Use draft")))

            TSButton(variant: .secondary, size: .small, action: onDiscard) {
                Text(verbatim: DraftRecoveryStrings.string("draft.discardDraft", "Discard draft"))
            }
            .accessibilityLabel(Text(verbatim: DraftRecoveryStrings.string("draft.discardDraft", "Discard draft")))
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the draft store is not live — a coloured dot + a
/// label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct DraftRecoveryFreshnessChip: View {
    let connection: DraftRecoveryConnection
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
        case .live: DraftRecoveryStrings.string("draft.live", "Live")
        case .stale: DraftRecoveryStrings.string("draft.stale", "Stale")
        case .offline: DraftRecoveryStrings.string("draft.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            DraftRecoveryStrings.string("draft.staleA11y", "Stale — tap to refresh")
        case .offline:
            DraftRecoveryStrings.string("draft.offlineA11y", "Offline — showing your saved draft")
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
