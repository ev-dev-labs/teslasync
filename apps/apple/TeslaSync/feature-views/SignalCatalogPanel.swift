//
//  SignalCatalogPanel.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  The staleness-aware signal catalog browser — SwiftUI parity of
//  features/telemetry/components/SignalCatalogPanel.tsx. Composes the four summary
//  StatCards, the panel header (title + "Refreshes every 5s"), the search + filter
//  + sort bar, the adaptive catalog table, and the last-refreshed line. Every web
//  state is reproduced: loading (skeleton rows), no-data, the filtered-empty
//  message, the populated table, the stale / offline banner, plus the feature-level
//  error surface with retry. Binds through `SignalCatalogPanelModel` (P1/S8); no
//  networking lives here.
//

import SwiftUI

// MARK: - SignalCatalogPanel (the feature surface)

/// The signal-catalog browser surface. Shows the cached `/signals/{id}/live`
/// snapshot as a searchable, filterable, sortable catalog with staleness badges,
/// formatted per the web source. Binds through `SignalCatalogPanelModel`.
public struct SignalCatalogPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SignalCatalogPanel"

    @State private var model: SignalCatalogPanelModel
    private let title: String?
    private let showSummary: Bool

    public init(model: SignalCatalogPanelModel, title: String? = nil, showSummary: Bool = true) {
        _model = State(initialValue: model)
        self.title = title
        self.showSummary = showSummary
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if case let .error(message) = model.phase {
                errorPanel(message)
            } else {
                if showSummary {
                    SignalCatalogPanelSummaryCards(summary: model.summary)
                }
                catalogPanel
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Panel chrome

extension SignalCatalogPanel {
    /// The GlassPanel body for the web data-driven states (loading / empty /
    /// content): header, the filter bar, the table region, and the refreshed line.
    private var catalogPanel: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            SignalCatalogPanelFilterBar(model: model)
            tableRegion
            if let updatedAt = model.updatedAt {
                lastRefreshed(updatedAt)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(panelBackground)
    }

    /// The fetch-failed panel (web `QueryError`): the header + a centered error
    /// with a retry affordance. Native chrome for the spec's error state.
    private func errorPanel(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            SignalCatalogPanelErrorState(message: message) { model.refresh() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(panelBackground)
    }

    private var panelBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }

    /// The panel header: optional title on the lead, the muted "Refreshes every
    /// 5s" note (with a refresh glyph) trailing — the web header row.
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            if let title {
                Text(verbatim: title)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11))
                    .accessibilityHidden(true)
                Text(verbatim: SignalCatalogPanelStrings.refreshInterval)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityElement(children: .combine)
        }
    }

    /// The web last-refreshed line: "Last refreshed: <relative>", right-aligned.
    private func lastRefreshed(_ date: Date) -> some View {
        let relative = SignalCatalogPanelFormat.relative(from: date, to: Date(), locale: .current)
        let text = "\(SignalCatalogPanelStrings.lastRefreshed): \(relative)"
        return Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Table region (loading / empty / content)

extension SignalCatalogPanel {
    @ViewBuilder
    private var tableRegion: some View {
        switch model.phase {
        case .loading:
            SignalCatalogPanelSkeletonRows()
        case .empty:
            emptyState
        case .content:
            contentRegion
        case .error:
            EmptyView()
        }
    }

    /// Resolved with no cached snapshot — the web "No signal data available"
    /// paragraph (`signals.length === 0`). Never a blank box.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SignalCatalogPanelStrings.noData)
            } icon: {
                Image(systemName: "antenna.radiowaves.left.and.right.slash")
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text(verbatim: SignalCatalogPanelStrings.noData))
    }

    /// The populated branch: the stale/offline banner over the table, or the
    /// filtered-empty message when the active filters hide every cached row.
    private var contentRegion: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                SignalCatalogPanelConnectivityBanner(connection: model.connection)
            }
            if model.displayedRows.isEmpty {
                inlineMessage
            } else {
                SignalCatalogPanelTable(model: model)
            }
        }
    }

    /// Web filtered-empty paragraph: "No signals match current filters" (cached
    /// signals exist but the search / filter mode hides them all).
    private var inlineMessage: some View {
        Text(verbatim: SignalCatalogPanelStrings.noMatch)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.x2xl)
            .accessibilityLabel(Text(verbatim: SignalCatalogPanelStrings.noMatch))
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure body with a retry affordance — mirrors the inline error
/// treatment used across the feature-view surfaces.
struct SignalCatalogPanelErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SignalCatalogPanelStrings.errorTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                Text(verbatim: SignalCatalogPanelStrings.retry)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SignalCatalogPanelStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web 8× `<Skeleton className="h-12" />`)

/// The initial-fetch skeleton: eight shimmering rows at table-row height, the
/// native parity of the web skeleton stack. Static under Reduce Motion.
struct SignalCatalogPanelSkeletonRows: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 8, id: \.self) { _ in
                SignalCatalogPanelSkeletonBar()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SignalCatalogPanelStrings.tableLabel))
    }
}

/// One shimmering skeleton bar (Reduce Motion → steady).
struct SignalCatalogPanelSkeletonBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmering = false

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.surface)
            .frame(height: 44)
            .opacity(reduceMotion || !shimmering ? 0.6 : 0.3)
            .onAppear(perform: animate)
            .accessibilityHidden(true)
    }

    private func animate() {
        guard !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
            shimmering = true
        }
    }
}
