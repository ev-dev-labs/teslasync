import SwiftUI

/// Native SwiftUI parity of `web/src/features/notifications/pages/AuditLogPage.tsx`
/// (route `/notifications/audit`). Reproduces the web `PageContainer` (title + subtitle) and
/// the single `GlassPanel` "Recent Activity" card, whose body switches across the web states:
/// loading (skeleton rows), error ("Failed to load audit logs" + Retry), empty ("No audit
/// entries found"), and success — a `SearchInput` + active-filter chip over a four-column
/// `DataTable` (Time / Action / Resource / Details), with the web "no matches" message when
/// the search filters everything out.
///
/// All copy resolves from `Localizable.xcstrings` with the web key names; data binds through
/// the `@Observable` `NotificationsAuditLogPageModel` (no networking in the view, ADR-004).
/// Adaptive across macOS/iPad (regular) + iPhone (compact) per ADR-002/006 — the shared
/// `TSDataTable` renders a columnar grid on regular width and per-row cards on compact.
public struct NotificationsAuditLogPage: View {
    @State private var model: NotificationsAuditLogPageModel

    public init(model: NotificationsAuditLogPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                recentActivityPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1024, alignment: .leading) // web `max-w-5xl mx-auto`
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.state { return }
            await model.load()
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("Audit Log")
            Text("Recent system-level changes recorded by the audit subsystem")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - GlassPanel1 — Recent Activity (web single GlassPanel)

    private var recentActivityPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                panelTitle
                panelBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Recent Activity"))
    }

    /// Web panel heading: Clock icon + "Recent Activity".
    private var panelTitle: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "clock")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TSPanelTitle("Recent Activity")
        }
    }

    @ViewBuilder
    private var panelBody: some View {
        switch model.state {
        case .loading:
            // Web `[1..5].map(<Skeleton h-8 />)`.
            TSTableSkeleton(rows: 5)
                .accessibilityLabel(Text("Recent Activity"))
        case .empty:
            // Web `else` branch: "No audit entries found" (no action — nothing to retry).
            TSEmptyState(title: "No audit entries found", systemImage: "clock.arrow.circlepath")
                .frame(maxWidth: .infinity)
        case let .error(message):
            errorView(message)
        case let .loaded(entries):
            loadedBody(entries)
        }
    }

    /// Web error branch (`<AlertTriangle /> Failed to load audit logs: {message}`) — surfaced
    /// as the localized title, the verbatim error detail, and a Retry action.
    private func errorView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text("Failed to load audit logs")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
            }
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            TSButton("action.retry", variant: .secondary, size: .small) {
                Task { await model.load() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Success branch (web FilterBar + ActiveFilterChips + DataTable / no-matches)

    private func loadedBody(_ entries: [AuditLogEntry]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSFilterBar {
                TSSearchInput(text: $model.search, prompt: "audit.searchPlaceholder") // parity:allow i18n key name
                    .frame(maxWidth: 288) // web `w-72`
            }
            if model.hasActiveSearch {
                TSActiveFilterChips(
                    chips: [TSFilterChip(id: "q", label: "audit.filterLabel.search")],
                    onRemove: { _ in model.clearSearch() },
                    onClearAll: { model.clearSearch() }
                )
            }
            entriesTable(entries)
        }
    }

    @ViewBuilder
    private func entriesTable(_: [AuditLogEntry]) -> some View {
        let filtered = model.filteredEntries
        if filtered.isEmpty {
            // Web `filtered.length > 0 ? <DataTable /> : "audit.noMatches"`.
            Text("audit.noMatches")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            TSDataTable(rows: filtered, columns: columns, density: .compact)
        }
    }

    // MARK: - Columns (web DataTable Time / Action / Resource / Details)

    private var columns: [TSColumn<AuditLogEntry>] {
        [
            TSColumn(id: "time", title: "Time") { entry in
                Text(verbatim: AuditEntryFormat.dateTime(entry.createdAt))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            },
            TSColumn(id: "action", title: "Action") { entry in
                Text(verbatim: entry.action)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
            },
            TSColumn(id: "resource", title: "Resource") { entry in
                Text(verbatim: entry.resource)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.accent)
            },
            TSColumn(id: "details", title: "Details") { entry in
                Text(verbatim: entry.details)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(2)
            }
        ]
    }
}

#if DEBUG
    #Preview("Loaded") {
        NotificationsAuditLogPage(model: NotificationsAuditLogPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        NotificationsAuditLogPage(model: NotificationsAuditLogPageModel(dataSource: PreviewEmptyAuditFeed()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        NotificationsAuditLogPage(model: NotificationsAuditLogPageModel(dataSource: PreviewFailingAuditFeed()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero entries (drives the empty state).
    private struct PreviewEmptyAuditFeed: NotificationsAuditLogDataSource {
        func loadAuditLogs() async throws -> [AuditLogEntry] {
            []
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingAuditFeed: NotificationsAuditLogDataSource {
        struct Failure: Error {}
        func loadAuditLogs() async throws -> [AuditLogEntry] {
            throw Failure()
        }
    }
#endif
