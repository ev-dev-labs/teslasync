import SwiftUI

/// The entries panel for `ApiLogsPage` (web `GlassPanel` #3): the "Showing …" / "No logs"
/// header with the Export-JSON action, the four list states (loading / empty / error /
/// success), the paginated, expandable log rows, and the Previous / Page-of / Next controls.
/// Kept as a dedicated surface (mirroring `AuditLogEntriesTable`) so the page file stays
/// focused on chrome + stats. All copy resolves from `Localizable.xcstrings`.
struct ApiLogsEntriesPanel: View {
    let model: ApiLogsPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                headerRow
                Divider().overlay(Color.TS.border)
                stateContent
                if model.showsPagination {
                    Divider().overlay(Color.TS.border)
                    paginationRow
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Header (web "Showing …" / "No logs" + Export JSON)

    private var headerRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: headerText)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            exportButton
        }
    }

    private var headerText: String {
        model.total > 0
            ? ApiLogsPage.showingText(from: model.pageFrom, to: model.pageTo, total: model.total)
            : String(localized: "translation.apiLogs.noLogs")
    }

    private var exportButton: some View {
        ShareLink(item: model.exportJSON) {
            Label("translation.apiLogs.exportJson", systemImage: "square.and.arrow.up")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(model.logs.isEmpty ? Color.TS.textMuted : Color.TS.textPrimary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        }
        .disabled(model.logs.isEmpty)
        .accessibilityLabel(Text("translation.apiLogs.exportJson"))
    }

    // MARK: - States (web loading spinner / empty / error / rows)

    @ViewBuilder
    private var stateContent: some View {
        switch model.listState {
        case .loading:
            loadingView
        case .empty:
            emptyView
        case let .error(detail):
            TSErrorDisplay(onRetry: { Task { await model.reloadLogs() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: detail))
        case let .loaded(rows):
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, log in
                    if index > 0 {
                        Divider().overlay(Color.TS.border.opacity(0.5))
                    }
                    ApiLogsRowView(log: log, model: model)
                }
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView()
            TSCaption("translation.apiLogs.loading")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityLabel(Text("translation.apiLogs.loading"))
    }

    private var emptyView: some View {
        TSEmptyState(
            title: "translation.apiLogs.noLogsFound",
            message: model.hasFilters ? "translation.apiLogs.adjustFilters" : nil,
            systemImage: "doc.text.magnifyingglass"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Pagination (web Previous / Page-of / Next)

    private var paginationRow: some View {
        HStack(spacing: TSSpacing.md) {
            TSButton(variant: .secondary, size: .small) {
                Task { await model.prevPage() }
            } label: {
                Label("translation.apiLogs.previous", systemImage: "chevron.left")
            }
            .disabled(!model.canGoPrev)

            Spacer(minLength: TSSpacing.sm)

            Text(verbatim: ApiLogsPage.pageOfText(page: model.page + 1, total: model.totalPages))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()

            Spacer(minLength: TSSpacing.sm)

            TSButton(variant: .secondary, size: .small) {
                Task { await model.nextPage() }
            } label: {
                HStack(spacing: TSSpacing.xs) {
                    Text("translation.apiLogs.next")
                    Image(systemName: "chevron.right")
                }
            }
            .disabled(!model.canGoNext)
        }
    }
}

/// One expandable log row (web entry row + `ExpandedDetail`). The collapsed row is the tap
/// target that toggles expansion; the detail panels render below when expanded. Adaptive:
/// a single horizontal row on regular width, a stacked layout on compact iPhone.
struct ApiLogsRowView: View {
    let log: ApiCallLog
    let model: ApiLogsPageModel

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

    private var isExpanded: Bool {
        model.isExpanded(log.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Button {
                model.toggleExpanded(log.id)
            } label: {
                if isCompact {
                    compactRow
                } else {
                    regularRow
                }
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)

            if isExpanded {
                ApiLogsExpandedDetail(log: log)
            }
        }
        .padding(.vertical, TSSpacing.sm)
    }

    // MARK: - Regular row

    private var regularRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: ApiLogsFormat.dateTime(log.ts))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 150, alignment: .leading)
            ApiLogsServiceBadge(service: log.service)
            ApiLogsMethodBadge(method: log.httpMethod)
            Text(verbatim: log.endpoint)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            ApiLogsStatusBadge(code: log.statusCode)
            Text(verbatim: ApiLogsFormat.rowDurationMs(log.durationMs))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 72, alignment: .trailing)
            Text(verbatim: log.errorMessage ?? ApiLogsFormat.emptyValue)
                .font(Font.TS.caption)
                .foregroundStyle(log.errorMessage == nil ? Color.TS.textMuted : Color.TS.statusDanger)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: 200, alignment: .leading)
            chevron
        }
    }

    // MARK: - Compact row

    private var compactRow: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                ApiLogsMethodBadge(method: log.httpMethod)
                Text(verbatim: log.endpoint)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                chevron
            }
            HStack(spacing: TSSpacing.sm) {
                ApiLogsServiceBadge(service: log.service)
                ApiLogsStatusBadge(code: log.statusCode)
                Text(verbatim: ApiLogsFormat.rowDurationMs(log.durationMs))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: 0)
            }
            Text(verbatim: ApiLogsFormat.dateTime(log.ts))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let errorMessage = log.errorMessage {
                Text(verbatim: errorMessage)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .lineLimit(2)
            }
        }
    }

    private var chevron: some View {
        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
            .font(.caption2)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }
}
