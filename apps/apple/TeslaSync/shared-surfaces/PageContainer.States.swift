//
//  PageContainer.States.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  The body-state chrome composed by `PageContainer` when it is not rendering its children: the
//  centred loading spinner (web `<div class="flex justify-center py-20"><Spinner size="lg" /></div>`),
//  the error tile (the native parity of the web red error box, lifted to a `QueryError`-equivalent
//  with the P4 leaf retry affordance), and the friendly empty state (web centred muted message,
//  improved to never collapse to a blank box). All copy resolves through the P1/S10 facade; all colour
//  comes from the P1/S9 tokens — no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Loading (web `<Spinner size="lg" />`, centred)

/// The initial-fetch chrome — a large spinner centred with generous vertical padding, the native
/// parity of the web centred `py-20` spinner. Exposes a single VoiceOver "Loading" element.
struct PageContainerLoadingView: View {
    var body: some View {
        VStack {
            ProgressView()
                .controlSize(.large)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x4xl)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: PageContainerStrings.string("page.loadingA11y", "Loading")))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Error (web red error tile → `QueryError` peer)

/// The page-error tile — the native parity of the web red error box, carrying the runtime
/// `error.message` verbatim and adding the P4 leaf retry affordance (the web box has none; the leaf
/// contract requires a `QueryError`-equivalent with retry). A danger leading icon + an emphasised
/// title + the message line + Retry, over a danger-tinted, bordered, material-backed rounded box.
struct PageContainerErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    private var accessibilityText: String {
        PageContainerAccessibility.errorLabel(message: message, strings: PageContainerStrings.string)
    }

    var body: some View {
        TSFadeIn {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                summary
                Spacer(minLength: TSSpacing.sm)
                retryButton
            }
            .padding(TSSpacing.lg)
            .background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(Color.TS.statusDanger.opacity(0.06))
                }
            }
            .overlay {
                shape.strokeBorder(Color.TS.statusDanger.opacity(0.2), lineWidth: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: PageContainerStrings.string("page.errorTitle", "Something went wrong"))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
        .accessibilityAddTraits(.isStaticText)
    }

    private var retryButton: some View {
        TSButton(variant: .secondary, size: .small, action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: PageContainerStrings.string("page.retry", "Retry"))
            }
        }
        .accessibilityLabel(Text(verbatim: PageContainerStrings.string("page.retry", "Retry")))
    }
}

// MARK: - Empty (web centred muted message → friendly empty state)

/// The empty render — a friendly card stating there is nothing to show, the native parity of the web
/// centred muted message (improved to never collapse to a blank box, per the P4 leaf contract). The
/// message is the caller's `emptyMessage` or the resolved `No {title} found.` default.
struct PageContainerEmptyView: View {
    let message: String

    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(message),
                systemImage: "tray"
            )
        }
        .frame(maxWidth: .infinity)
    }
}
