//
//  OnboardingChecklistWidget.swift
//  TeslaSync — P4 dashboard widget · 0071 · OnboardingChecklistWidget (Apple)
//
//  The composable Setup Checklist dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/OnboardingChecklistWidget.tsx. Binds through
//  OnboardingChecklistModel (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - OnboardingChecklistWidget (the dashboard surface)

/// The composable Setup Checklist dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/OnboardingChecklistWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / hidden / content) plus the
/// stale + offline native chrome inside a glass widget shell, binding through
/// `OnboardingChecklistModel` (P1/S8). No networking lives here.
public struct OnboardingChecklistWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "OnboardingChecklistWidget"

    /// Canonical registry metadata (registry/system.ts → "onboarding-checklist").
    public static let registration = DashboardWidgetRegistration(
        id: "onboarding-checklist",
        nameKey: "widget.onboardingChecklist",
        descriptionKey: "widget.onboardingChecklist.description",
        category: "system",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 3),
        maxSize: DashboardWidgetSize(cols: 4, rows: 8)
    )

    @State private var model: OnboardingChecklistModel
    private let size: DashboardWidgetSize
    private let onNavigate: ((String) -> Void)?
    private let onCommandPalette: (() -> Void)?

    public init(
        model: OnboardingChecklistModel,
        size: DashboardWidgetSize = OnboardingChecklistWidget.registration.defaultSize,
        onNavigate: ((String) -> Void)? = nil,
        onCommandPalette: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = OnboardingChecklistWidget.registration.clamp(size)
        self.onNavigate = onNavigate
        self.onCommandPalette = onCommandPalette
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// Routes a task CTA: the palette sentinel toggles the command palette, every
    /// other target pushes a route (web `handleCta`).
    private func handle(ctaTo: String) {
        if ctaTo == ChecklistRouting.commandPaletteCTA {
            onCommandPalette?()
        } else {
            onNavigate?(ctaTo)
        }
    }
}

// MARK: - Header

extension OnboardingChecklistWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checklist")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            OnboardingChecklistStrings.text("checklist.title", "Get started")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            ChecklistFreshnessChip(connection: model.connection)
            refreshButton
            if showsDismiss { dismissButton }
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(OnboardingChecklistStrings.text("widget.checklist.refresh", "Refresh"))
    }

    private var dismissButton: some View {
        Button {
            model.dismiss()
        } label: {
            Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(OnboardingChecklistStrings.text("checklist.dismiss", "Dismiss"))
    }

    /// The dismiss affordance shows while the checklist chrome is active (web
    /// renders it on the main surface, not on the hidden / restart state).
    private var showsDismiss: Bool {
        switch model.phase {
        case .content, .empty: true
        default: false
        }
    }
}

// MARK: - Content states

extension OnboardingChecklistWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChecklistLoadingChrome()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .hidden:
            hiddenState
        case .content:
            checklistContent
        }
    }

    private var checklistContent: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live {
                ChecklistConnectivityBanner(connection: model.connection)
            }
            ChecklistProgressBar(projection: model.projection)
            ScrollView {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(model.projection.tasks) { task in
                        ChecklistTaskRow(task: task) { handle(ctaTo: task.ctaTo) }
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            if model.projection.allComplete {
                ChecklistCompletionFooter(onDismiss: model.dismiss)
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                OnboardingChecklistStrings.text("checklist.empty", "No setup steps available right now.")
            } icon: {
                Image(systemName: "checklist")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var hiddenState: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: hiddenTitle)
            } icon: {
                Image(systemName: "sparkles")
            }
        } description: {
            OnboardingChecklistStrings.text(
                "checklist.dismissedMessage",
                "Remove this widget from your dashboard or restart the checklist to see your remaining setup steps."
            )
        } actions: {
            Button {
                model.restart()
            } label: {
                OnboardingChecklistStrings.text("checklist.restart", "Restart checklist")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(OnboardingChecklistStrings.text("checklist.restart", "Restart checklist"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            OnboardingChecklistStrings.text("widget.checklist.errorTitle", "Couldn't load your setup checklist")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                OnboardingChecklistStrings.text("widget.checklist.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    /// The hidden-state title — celebratory once finished, otherwise the dismissed
    /// copy (web `allComplete ? completeMessage : dismissedTitle`).
    private var hiddenTitle: String {
        model.hiddenAllComplete
            ? OnboardingChecklistStrings.string("checklist.completeMessage", "You're all set! 🎉")
            : OnboardingChecklistStrings.string("checklist.dismissedTitle", "Setup checklist hidden")
    }
}
