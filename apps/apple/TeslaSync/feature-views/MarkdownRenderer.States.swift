//
//  MarkdownRenderer.States.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The non-rendered states for the chatbot markdown renderer: the loading fallback (the web Suspense
//  fallback — the raw markdown shown `whitespace-pre-wrap` while formatting, or a skeleton before any
//  content arrives), the resolved-but-blank empty state, and the delivery-failure error state with a retry
//  affordance (web `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade. Never a blank box.
//

import SwiftUI

// MARK: - Loading (web Suspense fallback)

/// The loading state. With raw text available it mirrors the web fallback
/// (`<p className="whitespace-pre-wrap">{children}</p>`) — the message stays readable while the renderer
/// warms up; with no content yet it shows a skeleton so the surface is never blank.
struct MarkdownLoadingState: View {
    let rawText: String

    var body: some View {
        if rawText.isEmpty {
            skeleton
        } else {
            preparing
        }
    }

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { row in
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 12)
                    .frame(maxWidth: row == 2 ? 180 : .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(MarkdownRendererStrings.text("markdownRenderer.a11y.loading", "Loading message"))
    }

    private var preparing: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
                MarkdownRendererStrings.text("markdownRenderer.preparing", "Formatting…")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Text(verbatim: rawText)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved but blank)

/// The empty state: a friendly note when the message resolved with no content. Never a blank box.
struct MarkdownEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "text.bubble")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            MarkdownRendererStrings.text("markdownRenderer.empty.title", "Nothing to show")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            MarkdownRendererStrings.text("markdownRenderer.empty.message", "This message has no content yet.")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (delivery failure — web QueryError)

/// The delivery-failure state with a retry affordance (web `QueryError`).
struct MarkdownErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            MarkdownRendererStrings.text("markdownRenderer.error.title", "Couldn't load the message")
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
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .semibold))
                MarkdownRendererStrings.text("markdownRenderer.error.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(MarkdownRendererStrings.text("markdownRenderer.error.retry", "Retry"))
        .accessibilityAddTraits(.isButton)
    }
}
