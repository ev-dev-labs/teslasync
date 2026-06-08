//
//  SignalCatalogWidget.swift
//  TeslaSync — P4 dashboard widget · 0087 · SignalCatalogWidget (Apple)
//
//  The composable Signal Catalog dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SignalCatalogWidget.tsx. Binds through
//  SignalCatalogModel (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content (+ the compact count).
//

import Foundation
import SwiftUI

// MARK: - SignalCatalogWidget (the dashboard surface)

/// The browsable telemetry signal catalog — the SwiftUI parity of the web
/// `SignalCatalogWidget`. Renders a header (book icon + title + freshness chip)
/// over the resolved render state: a searchable, category-grouped signal list with
/// per-signal observation counts. Binds through `SignalCatalogModel` (P1/S8); no
/// networking lives here.
public struct SignalCatalogWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SignalCatalogModel.surfaceSlug
    }

    /// Canonical registry metadata (registry/telemetry.ts → "signal-catalog").
    public static let registration = DashboardWidgetRegistration(
        id: "signal-catalog",
        nameKey: "widget.signalCatalog.title",
        descriptionKey: "widget.signalCatalog.description",
        category: "telemetry",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SignalCatalogModel
    @State private var search = ""
    private let size: DashboardWidgetSize

    public init(
        model: SignalCatalogModel,
        size: DashboardWidgetSize = SignalCatalogWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = SignalCatalogWidget.registration.clamp(size)
    }

    private var isCompact: Bool {
        SignalCatalogBuilder.isCompact(cols: size.cols)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
}

// MARK: - Header

extension SignalCatalogWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "book")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            if !isCompact {
                SignalCatalogStrings.text("widget.signalCatalog.title", "Signal Catalog")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            SignalCatalogFreshnessChip(
                freshness: model.freshness,
                updatedAt: model.updatedAt,
                onRefresh: { model.refresh() }
            )
        }
    }
}

// MARK: - Content states

extension SignalCatalogWidget {
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
            if isCompact {
                SignalCatalogCountSummary(total: model.totalCount)
            } else {
                standardContent
            }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 120, height: 12)
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 36, height: 10)
                }
                .frame(minHeight: 32)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            SignalCatalogStrings.text("widget.signalCatalog.loading", "Loading signal catalog")
        )
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SignalCatalogStrings.text("widget.signalCatalog.noData", "No signals in catalog")
            } icon: {
                Image(systemName: "book")
            }
        } description: {
            SignalCatalogStrings.text(
                "widget.signalCatalog.emptyHint",
                "Signals appear here once your vehicle streams telemetry."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SignalCatalogStrings.text("widget.signalCatalog.errorTitle", "Couldn't load the catalog")
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            SignalCatalogStrings.text("widget.signalCatalog.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SignalCatalogStrings.text("widget.signalCatalog.retry", "Retry"))
    }
}

// MARK: - Standard layout (search + grouped list) + connectivity

extension SignalCatalogWidget {
    private var uncategorizedLabel: String {
        SignalCatalogStrings.string("widget.signalCatalog.uncategorized", "Uncategorized")
    }

    private var standardContent: some View {
        let groups = SignalCatalogBuilder.groups(
            entries: model.entries,
            search: search,
            counts: model.observationCounts,
            uncategorized: uncategorizedLabel
        )
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                connectivityBanner
            }
            SignalCatalogSearchField(text: $search)
            if groups.isEmpty {
                noResultsState
            } else {
                groupedList(groups)
            }
        }
    }

    private func groupedList(_ groups: [SignalCatalogGroup]) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TSSpacing.sm, pinnedViews: [.sectionHeaders]) {
                ForEach(groups) { group in
                    Section {
                        VStack(spacing: 0) {
                            ForEach(group.rows) { row in
                                SignalCatalogRowView(row: row)
                            }
                        }
                    } header: {
                        SignalCatalogGroupHeader(group: group)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noResultsState: some View {
        ContentUnavailableView {
            Label {
                SignalCatalogStrings.text("widget.signalCatalog.noResults", "No matching signals")
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        } description: {
            SignalCatalogStrings.text("widget.signalCatalog.noResultsHint", "Try a different search term.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.signalCatalog.offlineBanner" : "widget.signalCatalog.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded catalog"
            : "Reconnecting — the catalog may be out of date"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SignalCatalogStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
