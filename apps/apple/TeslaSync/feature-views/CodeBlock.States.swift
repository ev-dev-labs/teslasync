//
//  CodeBlock.States.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  The non-content states for the chatbot fenced-code block: the initial-fetch skeleton (a card-shaped
//  shimmer that keeps the surface's shape while the snippet resolves), the resolved-but-blank empty
//  state (a friendly note — never a blank `<pre>` box), and the load-failure error state with a retry
//  affordance (web `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade.
//

import SwiftUI

// MARK: - Loading (card-shaped skeleton)

/// The initial-fetch chrome: a card-shaped skeleton (a header-bar shimmer over three body-line shimmers)
/// matching the content card so the surface keeps its shape while the snippet resolves.
struct CodeBlockLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 56, height: 10)
                Spacer(minLength: 0)
                TSSkeleton(width: 22, height: 14)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surfaceGlass)
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 10)
                TSSkeleton(height: 10)
                TSSkeleton(width: 160, height: 10)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(CodeBlockStrings.text("codeBlock.a11y.loading", "Loading code"))
    }
}

// MARK: - Empty (resolved but blank)

/// The empty state: a friendly note when the snippet resolved with no code. Never a blank `<pre>` box.
struct CodeBlockEmptyState: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(CodeBlockStrings.string("codeBlock.empty.title", "No code to show")),
            message: LocalizedStringKey(
                CodeBlockStrings.string("codeBlock.empty.message", "This snippet has no content yet.")
            ),
            systemImage: "chevron.left.forwardslash.chevron.right"
        )
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
    }
}

// MARK: - Error (load failure — web QueryError)

/// The load-failure state with a retry affordance (web `QueryError`).
struct CodeBlockErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CodeBlockStrings.text("codeBlock.error.title", "Couldn't load the code")
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
                CodeBlockStrings.text("codeBlock.error.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(CodeBlockStrings.text("codeBlock.error.retry", "Retry"))
        .accessibilityAddTraits(.isButton)
    }
}
