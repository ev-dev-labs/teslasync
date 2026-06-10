//
//  SignalDiffTable.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  The Signal Diff table — SwiftUI parity of
//  features/telemetry/components/SignalDiffTable.tsx. Renders the per-signal diff
//  between two point-in-time snapshots (Window A vs Window B) with the Δ column,
//  the source-layer badges, multi-selection, and the pin affordance power users
//  asked for during incidents. Binds through `SignalDiffTableModel` (P1/S8); the
//  production source polls the shared server-side diff. Every state from the web
//  source is reproduced: loading, the two empty messages (filtered vs. no-diff),
//  and the populated table, plus the feature-level error / stale / offline
//  surfaces. No networking lives here.
//

import SwiftUI

// MARK: - SignalDiffTable (the feature surface)

/// The Signal Diff table surface. Shows the two-window diff as a pinned-first,
/// sortable, multi-selectable table with the Δ + source-layer columns from the
/// web source. Binds through `SignalDiffTableModel`.
public struct SignalDiffTable: View {
    @State private var model: SignalDiffTableModel

    public init(model: SignalDiffTableModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if showsLegend {
                SignalDiffLegend()
            }
            content
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The column legend shows for the web-source states (content / empty); the
    /// loading and feature-only error surfaces hide it.
    private var showsLegend: Bool {
        switch model.phase {
        case .content, .empty: true
        default: false
        }
    }
}

// MARK: - State branches

extension SignalDiffTable {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingState
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            SignalDiffTableContent(model: model)
        }
    }

    /// Initial fetch with nothing cached — the web `DataTable` "Loading…" message.
    private var loadingState: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: SignalDiffTableStrings.tableLoading)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityElement(children: .combine)
    }

    /// Resolved with no differing rows — the web `DataTable` emptyMessage, choosing
    /// the filtered vs. no-diff variant exactly like the web `emptyMessage`.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: emptyMessage)
            } icon: {
                Image(systemName: "equal.circle")
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyMessage: String {
        model.filterActive ? SignalDiffTableStrings.tableNoMatches : SignalDiffTableStrings.tableEmpty
    }

    /// Fetch failed with nothing cached — feature-level error with retry.
    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: SignalDiffTableStrings.errorTitle)
                .font(Font.TS.panel)
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
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            Text(verbatim: SignalDiffTableStrings.retry)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: SignalDiffTableStrings.retry))
    }
}

// MARK: - Column legend (web HelpTooltip legend above the header row)

/// The technical-column legend — the Δ and "Src A / Src B" labels each with an
/// info affordance whose popover carries the web `HelpTooltip` description. The
/// web embeds these above the header row because the shared `DataTable` header is
/// string-only; the native surface keeps the same affordance.
struct SignalDiffLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            SignalDiffHelpChip(
                label: SignalDiffTableStrings.legendDelta,
                help: SignalDiffTableStrings.helpDelta,
                ariaLabel: SignalDiffTableStrings.legendDeltaAria
            )
            SignalDiffHelpChip(
                label: SignalDiffTableStrings.legendSource,
                help: SignalDiffTableStrings.helpSource,
                ariaLabel: SignalDiffTableStrings.legendSourceAria
            )
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One legend entry: a mono label and an info button that presents the help text
/// in a popover (the native idiom for the web `HelpTooltip`).
struct SignalDiffHelpChip: View {
    let label: String
    let help: String
    let ariaLabel: String

    @State private var showingHelp = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(.system(.caption2, design: .monospaced))
                .textCase(.uppercase)
                .tracking(TSTypeMetrics.labelTracking)
                .foregroundStyle(Color.TS.textMuted)
            Button {
                showingHelp.toggle()
            } label: {
                Image(systemName: "info.circle")
                    .font(.caption2)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: ariaLabel))
            .help(Text(verbatim: help))
            .popover(isPresented: $showingHelp) {
                Text(verbatim: help)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                    .padding(TSSpacing.md)
                    .frame(maxWidth: 280)
                    .presentationCompactAdaptation(.popover)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
