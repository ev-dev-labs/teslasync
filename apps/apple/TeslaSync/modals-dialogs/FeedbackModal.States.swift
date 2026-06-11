//
//  FeedbackModal.States.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  The non-content states the FeedbackModal switches over for its auto-attached-context panel —
//  loading (web Spinner / skeleton), empty (diagnostics resolved with nothing to show), error (web
//  `QueryError` with retry), the inline reload error, the live-state freshness chip + cached-data
//  banner, and the inline submit-failure alert (web `submit.isError`). Every state renders real
//  chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Context loading (web Spinner / skeleton chrome)

/// The first-paint loading state for the auto-context panel (web `<Spinner/>` equivalent), shown
/// while the diagnostics are gathered so the panel doesn't reflow when they resolve.
struct FeedbackContextLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: TSSpacing.sm) {
                ProgressView().controlSize(.small)
                FeedbackStrings.text("feedback.context.loading", "Gathering diagnostics…")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FeedbackStrings.text("feedback.context.loading", "Gathering diagnostics…"))
    }
}

// MARK: - Context empty (diagnostics resolved with nothing to show)

/// The resolved-but-no-diagnostics state over a native `ContentUnavailableView` (never a blank box).
/// The form above stays usable; only the auto-context section reports it has nothing to attach.
struct FeedbackContextEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                FeedbackStrings.text("feedback.context.empty", "No diagnostic context available")
            } icon: {
                Image(systemName: "doc.text.magnifyingglass")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Context error (web `QueryError` with retry)

/// The context-gather failure state with a retry affordance (web `QueryError` — a first-load failure
/// rendered as a panel with a retry, never a blank box).
struct FeedbackContextErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FeedbackStrings.text("feedback.context.errorTitle", "Couldn't gather diagnostics.")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            FeedbackStrings.text("feedback.context.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(FeedbackStrings.text("feedback.context.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-context-with-failure)

/// The inline reload error shown above the context rows when a refresh failed but a cached context
/// remains (web reload-failure-with-cached-data).
struct FeedbackInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            FeedbackStrings.text("feedback.context.errorTitle", "Couldn't gather diagnostics.")
                .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Submit-failure alert (web `submit.isError`)

/// The inline submit-failure alert (web `role="alert"` "Failed to submit feedback. Please try
/// again."), shown above the footer after a failed submission.
struct FeedbackSubmitErrorAlert: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.octagon.fill")
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            FeedbackStrings.text("feedback.submitError", "Failed to submit feedback. Please try again.")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.statusDanger.opacity(0.10),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct FeedbackFreshnessChip: View {
    let connection: FeedbackConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            FeedbackStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FeedbackStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: FeedbackConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "feedback.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "feedback.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "feedback.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the form when the bound source is not live, so the user knows
/// the attached diagnostics may be out of date / the submission will send on reconnect (ADR-013).
struct FeedbackConnectivityBanner: View {
    let connection: FeedbackConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "feedback.offlineBanner" : "feedback.staleBanner"
        let fallback = offline
            ? "Offline — your feedback will send when you reconnect"
            : "Reconnecting — attached diagnostics may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FeedbackStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension FeedbackStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
