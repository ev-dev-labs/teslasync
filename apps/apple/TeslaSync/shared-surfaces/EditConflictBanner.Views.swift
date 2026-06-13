//
//  EditConflictBanner.Views.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  The presentational subviews composed by the surface: the edit-conflict notice (the native parity of
//  the web `EditConflictBanner` — a warning-toned alert banner with the headline, the reassurance copy,
//  the "Take over editing" action, and the informational switch hint) and the freshness chip (P4
//  connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens / components — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `variant="warning"` accent (neon amber) maps
//  to the brand `statusWarning`, exactly as the shared `TSAlertBanner` warning tone does, so the banner
//  reads as a "warning" notice in both light and dark themes.
//
//  Accessibility note: the headline + reassurance message form one VoiceOver element (the web
//  `AlertBanner` body announced under `role="status"` / `aria-live="polite"`), while the "Take over
//  editing" control stays individually focusable with its own label (web real `<button>`). The layout
//  reflows the action + switch hint beneath the message when width is tight (web `flex-wrap`) so it
//  survives Dynamic Type and narrow columns.
//

import SwiftUI

// MARK: - Edit-conflict notice (web `EditConflictBanner` data render)

/// The edit-conflict notice — the native parity of the web `EditConflictBanner` body. Renders the
/// warning icon, the headline, the pre-composed reassurance copy, and the "Take over editing" + switch
/// hint affordances over the shared warning-toned banner treatment.
public struct EditConflictNoticeView: View {
    private let data: EditConflictBannerData
    private let onTakeOver: () -> Void

    public init(data: EditConflictBannerData, onTakeOver: @escaping () -> Void) {
        self.data = data
        self.onTakeOver = onTakeOver
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                headline
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: TSSpacing.sm) {
                        takeOverButton
                        switchHint
                    }
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        takeOverButton
                        switchHint
                    }
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

    private var headline: some View {
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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: EditConflictAccessibility.bannerLabel(
            title: data.title,
            body: data.body
        )))
    }

    private var takeOverButton: some View {
        TSButton(variant: .ghost, size: .small, action: onTakeOver) {
            Text(verbatim: data.takeOverLabel)
        }
        .accessibilityLabel(Text(verbatim: data.takeOverLabel))
    }

    private var switchHint: some View {
        Text(verbatim: data.switchHint)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the lease feed is not live — a coloured dot + a
/// label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct EditConflictFreshnessChip: View {
    let connection: EditConflictConnection
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
        case .live: EditConflictStrings.string("editConflict.live", "Live")
        case .stale: EditConflictStrings.string("editConflict.stale", "Stale")
        case .offline: EditConflictStrings.string("editConflict.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            EditConflictStrings.string("editConflict.staleA11y", "Stale — tap to refresh")
        case .offline:
            EditConflictStrings.string("editConflict.offlineA11y", "Offline — showing the last known editing state")
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
