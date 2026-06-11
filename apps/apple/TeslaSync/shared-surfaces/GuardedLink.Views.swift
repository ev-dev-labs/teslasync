//
//  GuardedLink.Views.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  The presentational subviews composed by the surface: the tappable link (the native parity of the
//  web `GuardedLink` — a `<Link>` replacement that runs the guard before navigating) and the freshness
//  chip (P4 connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens / components
//  — no router, no Tailwind ports, no raw hex.
//
//  Accessibility note: the link's accessible NAME is its label (the web `children`, supplied by the
//  caller); the `.isLink` trait + a hint announce the guard behaviour, so VoiceOver users know a
//  guarded link will confirm before discarding unsaved work. The "Open in New Window" context action
//  is the Apple-idiomatic parity of the web ⌘-click / `target="_blank"` guard bypass.
//

import SwiftUI

// MARK: - Tappable link (web `GuardedLink` data render)

/// The tappable link — the native parity of the web `GuardedLink` body. Renders the caller-supplied
/// label as an accent-toned link affordance; a primary tap runs the guard-or-navigate flow, and a
/// context action opens the destination in a new window/scene (the guard-bypass path).
struct GuardedLinkButton<Content: View>: View {
    private let data: GuardedLinkData
    private let onActivate: (GuardedActivation) -> Void
    private let content: () -> Content

    init(
        data: GuardedLinkData,
        onActivate: @escaping (GuardedActivation) -> Void,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.data = data
        self.onActivate = onActivate
        self.content = content
    }

    var body: some View {
        Button {
            onActivate(.primary)
        } label: {
            content()
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                onActivate(.newContext)
            } label: {
                Label(
                    LocalizedStringKey(GuardedLinkStrings.string("guardedLink.openInNewWindow", "Open in New Window")),
                    systemImage: "macwindow.badge.plus"
                )
            }
        }
        .accessibilityAddTraits(.isLink)
        .accessibilityHint(Text(verbatim: GuardedAccessibility.hint(isDirty: data.isDirty)))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the link when the guard feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot, with an
/// explicit label.
struct GuardedLinkFreshnessChip: View {
    let connection: GuardedLinkConnection
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
        case .live: GuardedLinkStrings.string("guardedLink.live", "Live")
        case .stale: GuardedLinkStrings.string("guardedLink.stale", "Stale")
        case .offline: GuardedLinkStrings.string("guardedLink.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            GuardedLinkStrings.string("guardedLink.staleA11y", "Stale — tap to refresh")
        case .offline:
            GuardedLinkStrings.string("guardedLink.offlineA11y", "Offline — guard state may be out of date")
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
