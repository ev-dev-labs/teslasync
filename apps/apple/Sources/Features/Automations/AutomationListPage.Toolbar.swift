import SwiftUI

/// The bulk-action toolbar for `AutomationListPage` — the SwiftUI parity of the web
/// `<BulkActionToolbar>` mounted above the table. It surfaces the live selection count + noun, one
/// button per allow-listed operation (enable / disable / delete) with a per-action spinner, and a
/// Clear button; the destructive delete routes through a confirmation dialog first (web `confirm`).
/// It renders only while a selection exists (web `count === 0 → null`), so the page mounts it
/// behind `model.hasSelection`. Adaptive: the count row and the actions reflow on compact iPhone.
struct AutomationListBulkToolbar: View {
    let model: AutomationListPageModel
    @State private var showsDeleteConfirm = false

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        TSGlassPanel {
            Group {
                if isCompact {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        countRow
                        actionRow
                    }
                } else {
                    HStack(alignment: .center, spacing: TSSpacing.md) {
                        countRow
                        Spacer(minLength: TSSpacing.md)
                        actionRow
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("bulk.toolbarLabel"))
        .confirmationDialog(
            Text("automationList.bulk.deleteConfirm.title"),
            isPresented: $showsDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.performBulk(.delete) }
            } label: {
                Text("common.delete")
            }
            Button(role: .cancel) {} label: {
                Text("common.cancel")
            }
        } message: {
            Text("automationList.bulk.deleteConfirm.body")
        }
    }

    // MARK: - Count (web count chip + noun + "of total")

    private var countRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: selectedLabel)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.accent)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(Color.TS.accent.opacity(0.15), in: Capsule())
                .accessibilityLabel(Text(verbatim: selectedLabel))
            HStack(spacing: TSSpacing.xs) {
                Text(model.selectionNounKey)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: ofTotalLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    // MARK: - Actions (web action buttons + Clear)

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(AutomationBulkOperation.allCases) { operation in
                actionButton(operation)
            }
            TSButton("bulk.clear", variant: .ghost, size: .small) {
                model.clearSelection()
            }
        }
    }

    private func actionButton(_ operation: AutomationBulkOperation) -> some View {
        TSButton(
            variant: operation.isDestructive ? .destructive : .secondary,
            size: .small,
            isLoading: model.isRunning(operation),
            action: { trigger(operation) },
            label: {
                Label(operation.labelKey, systemImage: operation.systemImage)
            }
        )
        .disabled(model.isBusy)
    }

    private func trigger(_ operation: AutomationBulkOperation) {
        if operation.isDestructive {
            showsDeleteConfirm = true
        } else {
            Task { await model.performBulk(operation) }
        }
    }

    // MARK: - Labels

    /// Web `t('bulk.selected', { count })` → "{{count}} selected".
    private var selectedLabel: String {
        String(format: String(localized: "bulk.selected"), model.selectedCount)
    }

    /// Web `t('bulk.ofTotal', { total })` → "of {{total}}".
    private var ofTotalLabel: String {
        String(format: String(localized: "bulk.ofTotal"), model.visibleIDs.count)
    }
}
