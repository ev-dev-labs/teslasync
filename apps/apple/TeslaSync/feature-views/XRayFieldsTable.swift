//
//  XRayFieldsTable.swift
//  TeslaSync — P4 feature view · 0034 · XRayFieldsTable (Apple)
//
//  The Ingest X-Ray per-field statistics table — the SwiftUI parity of
//  web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx. Renders every state the
//  query can be in (loading / empty / error / stale / offline / content), binding through
//  `XRayFieldsModel` (P1/S8). No networking lives here; the sortable table itself is composed
//  in XRayFieldsTable.Views.swift from the shared design system + atoms.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helpers (P1/S10)

public extension XRayFieldsStrings {
    /// SwiftUI `Text` for a key with the web English fallback (rendered verbatim so the resolved
    /// per-surface string always shows, never the raw key).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// `LocalizedStringKey` carrying the resolved per-surface string, for shared components whose
    /// API takes a `LocalizedStringKey` (e.g. `TSBadge`). The resolved English value is not itself
    /// a catalog key, so it renders verbatim until the integrator folds the table into the catalog.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - XRayFieldsTable (the feature view)

/// The sortable per-field ingest-statistics table. SwiftUI parity of `XRayFieldsTable.tsx`:
/// the four sortable columns (field / samples / last seen / kind), the `useSortToggle`
/// default of `sample_count` descending, and the loading + empty messaging — plus the
/// query-lifecycle states (error / stale / offline) the native feature view owns because it
/// binds `useIngestXRay` directly through the P1/S8 seam.
public struct XRayFieldsTable: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = XRayFieldsSurface.slug

    @State private var model: XRayFieldsModel
    @Environment(\.locale) private var locale
    private let onRetry: (() -> Void)?

    public init(model: XRayFieldsModel, onRetry: (() -> Void)? = nil) {
        _model = State(initialValue: model)
        self.onRetry = onRetry
    }

    /// The sorted + per-cell-formatted projection, derived per render from the model's cached
    /// rows + sort state — the native parity of the web `const sorted = [...rows].sort(...)`.
    private var projection: [XRayFieldRow] {
        XRayFieldsProjector.project(
            rows: model.rows,
            sortKey: model.sortKey,
            sortDirection: model.sortDirection,
            context: XRayFieldsRenderContext(now: Date(), locale: locale, timeZone: .current)
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (freshness + refresh)

extension XRayFieldsTable {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            XRayFieldsStrings.text("admin.xray.panels.fields", "Field statistics")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            XRayFreshnessChip(connection: model.connection, isFetching: model.isFetching)
            refreshButton
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
        .disabled(model.isFetching)
        .accessibilityLabel(XRayFieldsStrings.text("admin.xray.fields.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension XRayFieldsTable {
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
            loadedContent
        }
    }

    private var loadingState: some View {
        TSTableSkeleton(rows: 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .accessibilityElement()
            .accessibilityLabel(XRayFieldsStrings.text("admin.xray.fields.loading", "Loading…"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                XRayFieldsStrings.text("admin.xray.fields.emptyTitle", "No samples")
            } icon: {
                Image(systemName: "tray")
            }
        } description: {
            XRayFieldsStrings.text(
                "admin.xray.fields.empty",
                "No samples in this window. Try widening the window or confirm the vehicle is publishing."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            XRayFieldsStrings.text("admin.xray.fields.errorTitle", "Couldn't load field statistics")
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
            if let onRetry { onRetry() } else { model.refresh() }
        } label: {
            XRayFieldsStrings.text("admin.xray.fields.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                XRayConnectivityBanner(connection: model.connection)
            }
            XRayFieldsTableView(
                rows: projection,
                sortKey: model.sortKey,
                sortDirection: model.sortDirection,
                onSort: { model.toggleSort($0) }
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
