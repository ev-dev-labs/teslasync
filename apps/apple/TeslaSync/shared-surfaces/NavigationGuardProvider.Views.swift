//
//  NavigationGuardProvider.Views.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  The presentational chrome composed by the surface: the dimmed-scrim modal (the native parity of the
//  web `<ConfirmDialog>`'s focus-trapped `Modal`), the warning confirm card (icon + tinted message box
//  + "Don't ask again" opt-out + Keep editing / Discard), and the P4 leaf states (loading skeleton,
//  the friendly "no unsaved changes" idle leaf, and a retryable error tile) plus the freshness chip.
//  All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens — no router, no
//  Tailwind ports, no raw hex.
//
//  Accessibility: the prompt is one combined VoiceOver phrase (warning + title + message); the title is
//  a header; the Discard action is `.destructive` (Apple HIG for discarding edits); the silence toggle
//  and the freshness chip carry explicit, state-aware labels; motion respects Reduce Motion.
//

import SwiftUI

// MARK: - Presenter (switches over every resolution — never a blank box)

/// The standalone confirm presenter — a pure function of a ``NavigationGuardResolution`` that renders
/// every P4 leaf state. The live ``NavigationGuardProvider`` overlays the confirming case behind a
/// scrim; this view is what previews + diagnostics host to exercise loading / idle / error too.
public struct NavigationGuardConfirmSurface: View {
    private let resolution: NavigationGuardResolution
    private let dontAskAgain: Bool
    private let onToggleSilence: (Bool) -> Void
    private let onDiscard: () -> Void
    private let onKeepEditing: () -> Void
    private let onRefresh: () -> Void

    public init(
        resolution: NavigationGuardResolution,
        dontAskAgain: Bool = false,
        onToggleSilence: @escaping (Bool) -> Void = { _ in },
        onDiscard: @escaping () -> Void = {},
        onKeepEditing: @escaping () -> Void = {},
        onRefresh: @escaping () -> Void = {}
    ) {
        self.resolution = resolution
        self.dontAskAgain = dontAskAgain
        self.onToggleSilence = onToggleSilence
        self.onDiscard = onDiscard
        self.onKeepEditing = onKeepEditing
        self.onRefresh = onRefresh
    }

    public var body: some View {
        switch resolution {
        case .loading:
            NavigationGuardLoadingCard()
        case let .idle(connection):
            NavigationGuardIdleCard(connection: connection, onRefresh: onRefresh)
        case let .failed(message, _):
            NavigationGuardErrorCard(message: message, onRetry: onRefresh)
        case let .confirming(request):
            NavigationGuardConfirmCard(
                request: request,
                dontAskAgain: dontAskAgain,
                onToggleSilence: onToggleSilence,
                onDiscard: onDiscard,
                onKeepEditing: onKeepEditing,
                onRefresh: onRefresh
            )
        }
    }
}

// MARK: - Scrim modal (web focus-trapped `Modal`)

/// The dimmed backdrop + centered card — the native parity of the web `<ConfirmDialog>`'s `Modal`. A
/// backdrop tap keeps editing (web `onClose` → `resolve(false)`); the card fades in (Reduce Motion safe
/// via ``TSFadeIn``).
struct NavigationGuardScrim<Card: View>: View {
    let onBackdrop: () -> Void
    @ViewBuilder var card: () -> Card

    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { onBackdrop() }
                .accessibilityLabel(Text(verbatim: NavigationGuardStrings.string(
                    "navigationGuard.backdropA11y",
                    "Dismiss — keep editing"
                )))
                .accessibilityAddTraits(.isButton)
            TSFadeIn(delay: 0.05) {
                card()
                    .frame(maxWidth: 420)
                    .padding(TSSpacing.x2xl)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Confirm card (web `<ConfirmDialog variant="warning">`)

/// The warning confirmation card — the native parity of the web `<ConfirmDialog>` body: a warning icon,
/// the title, a tinted message box, the optional "Don't ask again" opt-out, an optional freshness chip,
/// and the Keep editing / Discard actions (Discard is `.destructive`, Apple HIG for discarding edits).
struct NavigationGuardConfirmCard: View {
    let request: NavigationGuardConfirmRequest
    let dontAskAgain: Bool
    let onToggleSilence: (Bool) -> Void
    let onDiscard: () -> Void
    let onKeepEditing: () -> Void
    let onRefresh: () -> Void

    private var accessibilityLabelText: String {
        NavigationGuardAccessibility.confirmSummary(
            title: request.copy.title,
            message: request.copy.message,
            localize: NavigationGuardStrings.string
        )
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                messageBox
                if request.showsSilenceToggle {
                    silenceToggle
                }
                if request.connection != .live {
                    NavigationGuardFreshnessChip(connection: request.connection, onRefresh: onRefresh)
                }
                actions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: request.copy.title)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var messageBox: some View {
        Text(verbatim: request.copy.message)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.statusWarning.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusWarning.opacity(0.25), lineWidth: 1)
            )
    }

    private var silenceToggle: some View {
        Toggle(isOn: Binding(get: { dontAskAgain }, set: { onToggleSilence($0) })) {
            Text(verbatim: NavigationGuardStrings.string("navigationGuard.dontAskAgain", "Don't ask again"))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .toggleStyle(.switch)
        .tint(Color.TS.accent)
        .accessibilityLabel(Text(verbatim: NavigationGuardAccessibility.silenceLabel(
            checked: dontAskAgain,
            localize: NavigationGuardStrings.string
        )))
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .secondary, size: .medium, action: onKeepEditing) {
                Text(verbatim: request.copy.cancelLabel)
            }
            .accessibilityLabel(Text(verbatim: request.copy.cancelLabel))
            TSButton(variant: .destructive, size: .medium, action: onDiscard) {
                Text(verbatim: request.copy.confirmLabel)
            }
            .accessibilityLabel(Text(verbatim: request.copy.confirmLabel))
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: - Loading (P4 leaf contract)

/// The arming chrome — a skeleton that keeps the prompt's shape while a hosted presenter is preparing.
struct NavigationGuardLoadingCard: View {
    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 160, height: 18, cornerRadius: TSRadius.sm)
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                HStack(spacing: TSSpacing.sm) {
                    Spacer()
                    TSSkeleton(width: 96, height: 32, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 120, height: 32, cornerRadius: TSRadius.sm)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: NavigationGuardStrings.string(
            "navigationGuard.loadingA11y",
            "Preparing confirmation"
        )))
    }
}

// MARK: - Idle / empty (the friendly "nothing to confirm" leaf)

/// The idle leaf — the friendly native improvement over a blank box when there is nothing to confirm
/// (the live provider is transparent here; this backs the standalone presenter / previews).
struct NavigationGuardIdleCard: View {
    let connection: NavigationGuardConnection
    let onRefresh: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.md) {
                TSEmptyState(
                    title: LocalizedStringKey(NavigationGuardStrings.string(
                        "navigationGuard.idleTitle",
                        "No unsaved changes"
                    )),
                    message: LocalizedStringKey(NavigationGuardStrings.string(
                        "navigationGuard.idleMessage",
                        "You can navigate freely — nothing needs confirming."
                    )),
                    systemImage: "checkmark.shield"
                )
                if connection != .live {
                    NavigationGuardFreshnessChip(connection: connection, onRefresh: onRefresh)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The silence-feed-failure state (web `QueryError` peer) — a compact error card with a retry
/// affordance. The message is the runtime failure reason, rendered verbatim.
struct NavigationGuardErrorCard: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: NavigationGuardStrings.string(
                    "navigationGuard.errorTitle",
                    "Couldn't check unsaved changes"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: NavigationGuardStrings.string("navigationGuard.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: NavigationGuardStrings.string(
                    "navigationGuard.retry",
                    "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown when the silence feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot.
struct NavigationGuardFreshnessChip: View {
    let connection: NavigationGuardConnection
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
        case .live: NavigationGuardStrings.string("navigationGuard.live", "Live")
        case .stale: NavigationGuardStrings.string("navigationGuard.stale", "Stale")
        case .offline: NavigationGuardStrings.string("navigationGuard.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: NavigationGuardAccessibility.freshnessLabel(
            connection: connection,
            localize: NavigationGuardStrings.string
        )))
    }
}
