//
//  RequiresAuth.Views.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  The lock notice chrome for `RequiresAuth` — the SwiftUI parity of the web `RequiresAuth`
//  empty-state branch (the centred lock icon + title + vendor-neutral body, wrapped in a
//  bordered, elevated container). The container hosts the freshness chip + the cached-data banner
//  (P4 live-state axes) and switches over the render phase so the loading / locked / error states all
//  render real chrome under the same `requires-auth-empty-{capability}` identifier — never a blank
//  box (engineering guideline #6). All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Lock notice container (web RequiresAuth empty-state branch)

/// The gated-section lock notice: a bordered, elevated card (web `border bg-elevated/40 rounded-lg
/// px-6 py-12 text-center`) carrying the stable per-capability identifier, an optional cached-data
/// banner, the freshness chip, and the phase body. Shown whenever the gate is `locked` (web open
/// mode / loading / disabled capability).
struct RequiresAuthLockNotice: View {
    @Bindable var model: RequiresAuthModel

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            if model.connection != .live {
                RequiresAuthConnectivityBanner(connection: model.connection)
            }
            header
            phaseBody
        }
        .frame(maxWidth: 480)
        .padding(.horizontal, TSSpacing.x2xl)
        .padding(.vertical, TSSpacing.x4xl)
        .frame(maxWidth: .infinity)
        .background(
            Color.TS.surface.opacity(0.40),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityIdentifier(model.testID)
    }

    /// The freshness chip sits above the body so a cached/stale gate decision is always labelled.
    private var header: some View {
        HStack {
            Spacer(minLength: 0)
            RequiresAuthFreshnessChip(connection: model.connection)
        }
    }

    /// The phase body under the freshness chip: the lock notice content (web populated body) for
    /// `locked`, else the loading / error envelopes so no state is hidden behind a blank panel. The
    /// `content` case never reaches here (the entry view renders the children directly).
    @ViewBuilder
    private var phaseBody: some View {
        switch model.render {
        case .loading:
            RequiresAuthLoadingState(label: model.loadingAccessibilityLabel)
        case let .error(message):
            RequiresAuthErrorState(
                title: RequiresAuthStrings.string("requiresAuth.errorTitle", "Couldn't check access"),
                message: message,
                retryLabel: RequiresAuthStrings.string("requiresAuth.retry", "Retry"),
                accessibilityLabel: model.errorAccessibilityLabel(message: message),
                onRetry: { model.refresh() }
            )
        case .locked, .content:
            RequiresAuthLockedContent(model: model)
        }
    }
}

// MARK: - Locked content (web lock + title + body)

/// The resolved lock notice body (web RequiresAuth empty-state branch, populated): the centred
/// lock glyph, the "{feature} requires authentication mode" title, and the vendor-neutral body
/// (generic provider list, or the operator `provider_hint` verbatim).
struct RequiresAuthLockedContent: View {
    @Bindable var model: RequiresAuthModel

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "lock.fill")
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: model.title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: model.body)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: model.lockNoticeAccessibilityLabel))
    }
}
