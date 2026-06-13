//
//  SignalCategoryTree.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  The categorized signal picker — the SwiftUI parity of
//  features/telemetry/components/SignalCategoryTree.tsx. A search field over a
//  tri-state select-all header over a scrollable category tree, binding through
//  `SignalCategoryTreeModel` (P1/S8). Every state from the web source is
//  reproduced: loading (skeleton), empty ("No signals available…"), the
//  no-results message, the populated tree, plus the feature-level error / stale /
//  offline surfaces. No networking lives here.
//

import SwiftUI

// MARK: - SignalCategoryTree (the feature surface)

/// The categorized signal picker surface. Groups the vehicle's available-signal
/// catalog by routing category, with tri-state group selection, a live search
/// filter, and per-group counts. Binds through `SignalCategoryTreeModel`; the
/// production source polls the shared available-signals query.
public struct SignalCategoryTree: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SignalCategoryTreeSurface.slug

    @State private var model: SignalCategoryTreeModel

    public init(model: SignalCategoryTreeModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                SignalCategoryConnectivityBanner(connection: model.connection)
            }
            if showsControls {
                SignalCategorySearchField(model: model)
                SignalCategorySelectAllHeader(model: model)
            }
            content
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.catalogLabel))
        .accessibilityValue(
            Text(verbatim: SignalCategoryTreeAccessibility.treeSummary(
                selectedCount: model.selectedCount,
                totalLeafCount: model.totalLeafCount
            ))
        )
    }

    /// The search + select-all controls show for every web-source state
    /// (loading / empty / content); the feature-only error surface hides them
    /// (nothing to search or select).
    private var showsControls: Bool {
        if case .error = model.phase { return false }
        return true
    }
}

// MARK: - State branches

extension SignalCategoryTree {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SignalCategoryLoadingView()
        case .empty:
            emptyState
        case let .error(message):
            SignalCategoryErrorView(message: message) { model.refresh() }
        case .content:
            SignalCategoryTreeBody(model: model)
        }
    }

    /// Resolved with no catalog — the web `emptyState` non-error branch.
    private var emptyState: some View {
        treeFrame {
            ContentUnavailableView {
                Label {
                    Text(verbatim: SignalCategoryTreeStrings.emptyMessage)
                } icon: {
                    Image(systemName: "antenna.radiowaves.left.and.right.slash")
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Loading / error states

/// The initial-fetch skeleton — four pulsing rows mirroring the web TreeSelect
/// `isLoading` skeleton block, inside the same bordered tree frame.
struct SignalCategoryLoadingView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        treeFrame {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .fill(Color.TS.textPrimary.opacity(pulse ? 0.12 : 0.05))
                        .frame(height: 24)
                }
            }
            .padding(TSSpacing.md)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.loading))
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}

/// The catalog-failed surface — a feature-level error with retry (web surfaces the
/// error inline in the tree; the native envelope adds an explicit retry).
struct SignalCategoryErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: SignalCategoryTreeStrings.errorTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: SignalCategoryTreeStrings.catalogError(message))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            retryButton
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            Text(verbatim: SignalCategoryTreeStrings.retry)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.retry))
    }
}

// MARK: - Search field (web search `Input` with leading icon + clear)

/// The catalog search field — a leading magnifying-glass icon, the web prompt, and
/// a trailing clear control when non-empty (web `<Input icon suffix>`).
struct SignalCategorySearchField: View {
    @Bindable var model: SignalCategoryTreeModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: $model.searchText,
                prompt: Text(verbatim: SignalCategoryTreeStrings.searchPrompt)
            ) {
                Text(verbatim: SignalCategoryTreeStrings.searchAria)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .labelsHidden()
            .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.searchAria))
            if !model.searchText.isEmpty {
                Button {
                    model.setSearch("")
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.clearSearch))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Select-all header (web top select-all + counts row)

/// The select-all row: a tri-state select/clear control on the left and the
/// "{n} selected" counter plus a clear-all-selected control on the right (web
/// header `Checkbox` + counts + "Clear all selected").
struct SignalCategorySelectAllHeader: View {
    let model: SignalCategoryTreeModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button {
                model.toggleAllVisible()
            } label: {
                HStack(spacing: TSSpacing.sm) {
                    SignalCategoryCheckbox(state: model.selectAllState)
                    Text(verbatim: SignalCategoryTreeStrings.selectAll(model.selectAllLabel))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.visibleLeafIDs.isEmpty)
            .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.selectAll(model.selectAllLabel)))

            Spacer(minLength: TSSpacing.sm)

            Text(verbatim: SignalCategoryTreeStrings.selectionSummary(
                selected: model.selectedCount,
                total: model.totalLeafCount,
                isSearching: model.isSearching
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .monospacedDigit()

            if model.selectedCount > 0 {
                Button {
                    model.clearAllSelected()
                } label: {
                    Text(verbatim: SignalCategoryTreeStrings.clearAllSelected)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .underline()
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.clearAllSelected))
            }
        }
        .padding(.horizontal, TSSpacing.xs)
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the picker when the catalog query is not
/// fresh — the feature-level analogue of the web freshness indicators.
struct SignalCategoryConnectivityBanner: View {
    let connection: SignalCategoryTreeConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "arrow.triangle.2.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: isOffline
                ? SignalCategoryTreeStrings.offlineBanner
                : SignalCategoryTreeStrings.staleBanner)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }
}

// MARK: - Shared tree frame

/// The bordered, scroll-capable frame wrapping the tree body and its inline states
/// (web `role="tree"` container: `rounded-md border bg-surface-1`).
func treeFrame(@ViewBuilder _ content: @escaping () -> some View) -> some View {
    content()
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.TS.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
}
