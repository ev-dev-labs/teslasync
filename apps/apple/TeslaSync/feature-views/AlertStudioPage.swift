//
//  AlertStudioPage.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The SwiftUI parity of web/src/features/notifications/pages/AlertStudioPage.tsx —
//  the typed alert-rule editor page. This top-level surface owns the page chrome (web
//  `PageContainer`: title + subtitle + Templates/New-Rule actions + the page-level
//  loading / error / offline states), composes the opt-in AI panels at their web
//  positions (gated identically: the builder always, cross-rule conflict when ≥2 rules,
//  tuning when a rule is selected — baseline renders nothing, ADR-015 §I3), the
//  collapsible templates browser, the responsive two-column rules-list + rule-editor
//  layout, and the snooze sheet + discard/delete confirmations. It binds every data
//  source through the P1/S8 `AlertStudioViewModel` (no networking in the view) and
//  emits the P1/S11 `view.opened` diagnostics event on appear.
//

import SwiftUI

// MARK: - i18n SwiftUI bridge (web `t(key, default)`)

/// Bridges the `ASStrings` / injected localizer into the SwiftUI text types the shared
/// components expect, so no view holds a hardcoded literal and runtime-resolved strings
/// flow into `LocalizedStringKey`-typed parameters verbatim.
enum ASView {
    /// A `LocalizedStringKey` that renders an already-resolved string verbatim.
    static func key(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }
}

extension ASLocalizer {
    /// Resolves a descriptor to a verbatim-rendering `LocalizedStringKey`.
    func key(_ text: ASText) -> LocalizedStringKey {
        ASView.key(string(text))
    }

    /// Resolves a one-token interpolation to a verbatim-rendering `LocalizedStringKey`.
    func key(_ text: ASText, _ token: String, _ value: String) -> LocalizedStringKey {
        ASView.key(format(text, token, value))
    }
}

// MARK: - AI composition seam (web `@/components/ai/*`)

/// The opt-in AI panels the page mounts at fixed positions. The atomic AI surfaces are
/// separately-owned shared components (out of scope here); the page exposes them as
/// injected composition slots so production wires the real panels while the baseline /
/// previews render nothing — faithfully reproducing the web off-mode where the manual
/// editor is the canonical baseline (ADR-015 §I3).
public struct ASAIPanels {
    public var builder: AnyView
    public var conflict: AnyView
    public var tuning: AnyView

    public init(
        builder: AnyView = AnyView(EmptyView()),
        conflict: AnyView = AnyView(EmptyView()),
        tuning: AnyView = AnyView(EmptyView())
    ) {
        self.builder = builder
        self.conflict = conflict
        self.tuning = tuning
    }

    /// The baseline (web ai_mode == 'off'): nothing renders, manual form is canonical.
    public static var baseline: ASAIPanels {
        ASAIPanels()
    }
}

// MARK: - Top-level surface

public struct AlertStudioPage: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AlertStudioSurface.slug

    @State private var viewModel: AlertStudioViewModel
    private let ai: ASAIPanels
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init(viewModel: AlertStudioViewModel, ai: ASAIPanels = .baseline) {
        _viewModel = State(initialValue: viewModel)
        self.ai = ai
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                body(for: viewModel.rulesModel.presentation)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task { viewModel.start() }
        .onDisappear { viewModel.stop() }
        .sheet(isPresented: snoozeSheetBinding) { snoozeSheet }
        .confirmationDialog(
            viewModel.localize.key(ASCopy.formsUnsavedTitle),
            isPresentedDiscard: viewModel
        )
        .confirmationDialog(
            deleteConfirmTitle,
            isPresentedDelete: viewModel
        )
    }

    // MARK: Header (web `PageContainer` title + subtitle + actions)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSPageTitle(viewModel.localize.key(ASCopy.title))
                    Text(viewModel.localize.key(ASCopy.subtitle))
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                Spacer(minLength: TSSpacing.md)
            }
            headerActions
        }
        .accessibilityElement(children: .contain)
    }

    private var headerActions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .ghost, size: .small, action: { viewModel.showTemplates.toggle() }, label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                    Text(viewModel.localize.key(ASCopy.actionsTemplates))
                }
            })
            .accessibilityLabel(Text(viewModel.localize.key(ASCopy.actionsTemplates)))

            TSButton(variant: .primary, size: .small, action: { viewModel.requestNewRule() }, label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus")
                    Text(viewModel.localize.key(ASCopy.actionsNewRule))
                }
            })
            .accessibilityLabel(Text(viewModel.localize.key(ASCopy.actionsNewRule)))
            Spacer(minLength: 0)
        }
    }

    // MARK: Page-level state body (web `PageContainer` loading / error)

    @ViewBuilder
    private func body(for presentation: ASListPresentation<ASAlertRule>) -> some View {
        switch presentation {
        case .loading:
            loadingState
        case let .error(retryable):
            errorState(retryable: retryable)
        case .offlineNoData:
            offlineState
        case let .empty(connection):
            content(connection: connection)
        case let .content(_, connection, _):
            content(connection: connection)
        }
    }

    private var loadingState: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 180, height: 18)
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                }
            }
            .accessibilityLabel(Text(viewModel.localize.key(ASCopy.stateLoading)))
        }
    }

    private func errorState(retryable: Bool) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: viewModel.localize.key(ASCopy.stateErrorTitle),
                onRetry: retryable ? { viewModel.rulesModel.refresh() } : nil
            )
        }
    }

    private var offlineState: some View {
        TSGlassPanel {
            TSEmptyState(
                title: viewModel.localize.key(ASCopy.stateOfflineTitle),
                message: viewModel.localize.key(ASCopy.stateOfflineMessage),
                systemImage: "wifi.slash"
            ) {
                TSButton(viewModel.localize.key(ASCopy.stateRetry), variant: .secondary, size: .small) {
                    viewModel.rulesModel.refresh()
                }
            }
        }
    }

    // MARK: Content (web body: AI builder + templates + two-column)

    private func content(connection: ASConnection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ai.builder
            if viewModel.showTemplates {
                TSFadeIn { ASTemplatesPanel(viewModel: viewModel) }
            }
            twoColumn(connection: connection)
        }
    }

    @ViewBuilder
    private func twoColumn(connection: ASConnection) -> some View {
        let rules = ASRulesPanel(viewModel: viewModel, connection: connection)
        let editor = editorColumn
        if horizontalSizeClass == .compact {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                rules
                editor
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.x2xl) {
                rules.frame(maxWidth: .infinity, alignment: .top)
                editor.frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }

    /// Web right column: cross-rule conflict (≥2 rules) → tuning (rule selected) → editor.
    private var editorColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if viewModel.rules.count >= 2 {
                ai.conflict
            }
            if viewModel.isEditing {
                ai.tuning
            }
            ASRuleEditor(viewModel: viewModel)
        }
    }

    // MARK: Snooze sheet (web `Modal`)

    private var snoozeSheetBinding: Binding<Bool> {
        Binding(
            get: { viewModel.snoozeTargetID != nil },
            set: { presented in if !presented { viewModel.snoozeTargetID = nil } }
        )
    }

    @ViewBuilder
    private var snoozeSheet: some View {
        if let rule = viewModel.snoozeTargetRule {
            ASSnoozeSheet(viewModel: viewModel, rule: rule)
        }
    }

    private var deleteConfirmTitle: LocalizedStringKey {
        viewModel.localize.key(ASCopy.rulesConfirmDeleteTitle)
    }
}

// MARK: - Confirmation dialogs (web `useConfirm` discard + delete)

private extension View {
    /// The discard-changes dialog (web `confirmDiscard`): presented while a guarded
    /// switch is parked; "Discard" applies it, "Keep editing" drops it.
    func confirmationDialog(
        _ title: LocalizedStringKey,
        isPresentedDiscard viewModel: AlertStudioViewModel
    ) -> some View {
        confirmationDialog(
            title,
            isPresented: Binding(
                get: { viewModel.pendingSwitch != nil },
                set: { presented in if !presented { viewModel.cancelDiscardSwitch() } }
            ),
            titleVisibility: .visible
        ) {
            Button(viewModel.localize.key(ASCopy.formsDiscard), role: .destructive) {
                viewModel.confirmDiscardSwitch()
            }
            Button(viewModel.localize.key(ASCopy.formsKeepEditing), role: .cancel) {
                viewModel.cancelDiscardSwitch()
            }
        } message: {
            Text(viewModel.localize.key(ASCopy.formsUnsavedWarning))
        }
    }

    /// The delete-rule dialog (web `confirmDelete`).
    func confirmationDialog(
        _ title: LocalizedStringKey,
        isPresentedDelete viewModel: AlertStudioViewModel
    ) -> some View {
        confirmationDialog(
            title,
            isPresented: Binding(
                get: { viewModel.pendingDelete != nil },
                set: { presented in if !presented { viewModel.cancelDelete() } }
            ),
            titleVisibility: .visible
        ) {
            Button(viewModel.localize.key(ASCopy.commonDelete), role: .destructive) {
                viewModel.confirmDelete()
            }
            Button(viewModel.localize.key(ASCopy.commonCancel), role: .cancel) {
                viewModel.cancelDelete()
            }
        } message: {
            if let rule = viewModel.pendingDelete {
                let name = rule.name.isEmpty ? viewModel.localize.string(ASCopy.untitled) : rule.name
                Text(viewModel.localize.key(ASCopy.rulesConfirmDelete, "name", name))
            }
        }
    }
}
