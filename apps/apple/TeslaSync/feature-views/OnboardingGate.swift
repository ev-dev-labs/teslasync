//
//  OnboardingGate.swift
//  TeslaSync — P4 feature view · 0194 · OnboardingGate (Apple)
//
//  The composable OnboardingGate feature view — the SwiftUI parity of
//  features/onboarding/components/OnboardingGate.tsx. The web gate is a non-visual
//  redirect guard (`return null`); the native surface renders the gate's verdict
//  across every state the matrix requires (loading / empty / error / content, with
//  a live / stale / offline freshness overlay) and drives the same
//  `navigate('/onboarding')` redirect through the model. Binds through
//  `OnboardingGateModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - OnboardingGateView (the feature surface)

/// The composable OnboardingGate surface — the SwiftUI parity of
/// `features/onboarding/components/OnboardingGate.tsx`. A header (title + freshness)
/// over a verdict-driven body, tinted by the gate decision. Binds through
/// `OnboardingGateModel`; the view performs no networking.
public struct OnboardingGateView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "OnboardingGate"

    @State private var model: OnboardingGateModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: OnboardingGateModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            OnboardingGateTint.color(for: model.projection.decision),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .animation(
            reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration),
            value: model.phase
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: OnboardingGateAccessibility.panelLabel(for: model.projection)))
    }
}

// MARK: - Header (icon + title + subtitle + freshness)

extension OnboardingGateView {
    /// The surface header: a setup glyph, the title + subtitle, and a freshness chip
    /// interposed on the trailing edge when the status feed is not live.
    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .frame(width: 36, height: 36)
                .background(
                    Color.TS.accent.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: OnboardingGateStrings.string("onboarding.gate.title", "Finish setting up TeslaSync"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verbatim: OnboardingGateStrings.string(
                    "onboarding.gate.subtitle",
                    "A few steps remain before your dashboard is ready."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                OnboardingFreshnessChip(connection: model.connection)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states

extension OnboardingGateView {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            contentBody
        }
    }

    /// Loading: a skeleton stand-in for the verdict card + anchor checklist while
    /// the status feed resolves (web gate has no loading UI — this is native chrome).
    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 220, height: 14)
            TSSkeleton(width: nil, height: 44)
            TSSkeleton(width: nil, height: 12)
            TSSkeleton(width: nil, height: 12)
            TSSkeleton(width: 180, height: 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(OnboardingGateStrings.text("onboarding.gate.loading", "Checking your setup…"))
    }

    /// Empty (web `!data` → hold): the status feed resolved without a value. A
    /// friendly muted line + retry — never a blank box.
    private var emptyState: some View {
        OnboardingGateNotice(
            systemImage: "questionmark.circle",
            tone: .muted,
            title: OnboardingGateStrings.string("onboarding.gate.empty", "Setup status unavailable"),
            message: OnboardingGateStrings.string(
                "onboarding.gate.empty.body",
                "We couldn't read your setup status. It will refresh automatically."
            ),
            retry: { model.refresh() }
        )
    }

    /// Error (web `isError` → hold): the gate deliberately does NOT redirect on a
    /// failed status check so the user is never trapped; it shows the failure with a
    /// retry (the prompt's `QueryError` equivalent).
    private func errorState(_ message: String) -> some View {
        let resolved = message.isEmpty
            ? OnboardingGateStrings.string(
                "onboarding.gate.error.body",
                "We'll keep you here so nothing is interrupted. Try again."
            )
            : message
        return OnboardingGateNotice(
            systemImage: "exclamationmark.triangle.fill",
            tone: .danger,
            title: OnboardingGateStrings.string("onboarding.gate.error.title", "Couldn't verify setup"),
            message: resolved,
            retry: { model.refresh() }
        )
    }

    /// Content (web pass / redirect verdicts): the connectivity banner (when the
    /// status is cached + stale/offline), the verdict card, and — once the status
    /// has loaded — the three onboarding anchors as a checklist.
    private var contentBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                OnboardingConnectivityBanner(connection: model.connection)
            }
            OnboardingGateDecisionCard(
                decision: model.projection.decision,
                goToOnboarding: { model.goToOnboarding() }
            )
            if model.projection.isResolved {
                OnboardingAnchorList(
                    anchors: model.projection.anchors,
                    completed: model.projection.completedAnchorCount
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
