//
//  AlertRulesPage.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple)
//
//  SwiftUI / HIG parity of `web/src/features/notifications/pages/AlertRulesPage.tsx`
//  (web route `/notifications/rules`). The streamlined "manage many at once" surface:
//  the edit-conflict banner, the bulk-action toolbar (enable / disable / delete), and
//  the rules table (master + per-row select, an inline-rename name cell that links to
//  Alert Studio, the signal, severity + status badges), plus the "Open Alert Studio"
//  footer. Adaptive across macOS + iOS (ADR-002/006); the four page data states are
//  implemented, every panel reproduced, and every visible string resolves from the
//  catalog — all bound to `AlertRulesPageModel` (no business logic in the view body).
//

import SwiftUI

struct AlertRulesPage: View {
    @State private var model: AlertRulesPageModel
    private let onOpenStudio: (Int64?) -> Void

    init(
        model: AlertRulesPageModel = AlertRulesPageModel(),
        onOpenStudio: @escaping (Int64?) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onOpenStudio = onOpenStudio
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                subtitleHeader
                TSFadeIn {
                    VStack(alignment: .leading, spacing: TSSpacing.lg) {
                        if model.editConflictActive {
                            AlertRulesEditConflictBanner()
                        }
                        if model.selectedCount > 0 {
                            AlertRulesBulkToolbar(model: model)
                        }
                        TSGlassPanel { panelContent }
                        footer
                    }
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(verbatim: ARStrings.text("alertRules.title", "Alert rules")))
        .task {
            guard model.viewState == .loading, model.rules.isEmpty else { return }
            await model.load()
        }
        .refreshable { await model.refresh() }
    }

    /// Web `PageContainer subtitle`.
    private var subtitleHeader: some View {
        Text(verbatim: ARStrings.text(
            "alertRules.subtitle",
            "Bulk-manage alert rules. Click a rule to edit it in Alert Studio."
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Panel content (web `GlassPanel` inner switch)

    @ViewBuilder
    private var panelContent: some View {
        switch model.viewState {
        case .loading:
            loadingView
        case let .error(message):
            TSErrorDisplay(
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.refresh() } }
            )
        case .empty:
            emptyView
        case .success:
            AlertRulesTable(model: model, onOpenStudio: { onOpenStudio($0) })
        }
    }

    // MARK: - Loading state (web skeleton rows)

    private var loadingView: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    RoundedRectangle(cornerRadius: TSRadius.sm).frame(width: 18, height: 18)
                    RoundedRectangle(cornerRadius: TSRadius.sm).frame(height: 14)
                    RoundedRectangle(cornerRadius: TSRadius.sm).frame(width: 80, height: 14)
                }
            }
        }
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
        .accessibilityLabel(Text(verbatim: ARStrings.text("alertRules.title", "Alert rules")))
    }

    // MARK: - Empty state (web `EmptyState` — no rules)

    private var emptyView: some View {
        TSEmptyState(
            title: ARStrings.key("alertRules.empty.title"),
            message: ARStrings.key("alertRules.empty.body"),
            systemImage: "bell.badge"
        ) {
            TSButton(ARStrings.key("alertRules.empty.cta"), variant: .secondary, size: .small) {
                onOpenStudio(nil)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }

    // MARK: - Footer (web "Open Alert Studio" link)

    private var footerLabel: some View {
        Label {
            Text(verbatim: ARStrings.text("alertRules.openStudio", "Open Alert Studio"))
        } icon: {
            Image(systemName: "plus")
        }
    }

    private var footer: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(
                variant: .secondary,
                size: .small,
                action: { onOpenStudio(nil) },
                label: { footerLabel }
            )
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        NavigationStack { AlertRulesPage() }
            .tsUnits(.metric)
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            AlertRulesPage(model: AlertRulesPageModel(dataSource: EmptyAlertRulesDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            AlertRulesPage(model: AlertRulesPageModel(dataSource: FailingAlertRulesDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Edit conflict") {
        NavigationStack {
            AlertRulesPage(
                model: AlertRulesPageModel(editConflictActive: true)
            )
        }
        .teslaSyncTheme()
    }
#endif
