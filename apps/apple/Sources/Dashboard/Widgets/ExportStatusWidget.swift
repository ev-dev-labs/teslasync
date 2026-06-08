import Foundation
import OSLog
import SwiftUI

// This is one cohesive dashboard surface (registry metadata + domain model + pure
// reducer + binding seam + SwiftUI view + previews) kept in a single file to match
// the prompt's `ExportStatusWidget.*` allowed-files scope. Only the cosmetic
// file-length threshold is relaxed; every other lint rule is enforced.
// swiftlint:disable file_length

// MARK: - Registry metadata

/// Static dashboard-registry metadata for the Export Status surface — the native
/// mirror of the web registry entry in
/// `web/src/features/dashboard/widgets/registry/system.ts` (`id: 'export-status'`,
/// category `system`, default 2×4, min 1×2, max 4×40). The dashboard host (P4
/// core) registers this surface under the same id and honours the same size
/// bounds in its grid system.
public enum ExportStatusWidgetRegistry {
    /// Stable registry id shared with every other platform (web/Android/Windows).
    public static let id = "export-status"
    /// Registry category bucket.
    public static let category = "system"
    /// Default grid footprint (cols × rows).
    public static let defaultSize = ExportStatusWidgetSize(cols: 2, rows: 4)
    /// Smallest footprint the host may allocate.
    public static let minSize = ExportStatusWidgetSize(cols: 1, rows: 2)
    /// Largest footprint the host may allocate.
    public static let maxSize = ExportStatusWidgetSize(cols: 4, rows: 40)
    /// Diagnostics surface slug emitted on the P1/S11 `view.opened` event.
    public static let surfaceSlug = "ExportStatusWidget"
}

/// Grid footprint (columns × rows) the dashboard host allocates to a widget — the
/// native port of the web `WidgetSize` (`{ cols, rows }`). The two breakpoints
/// reproduce the web `isCompact` / `isWide` switches verbatim.
public struct ExportStatusWidgetSize: Equatable, Sendable {
    public var cols: Int
    public var rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }

    /// Single-column footprint → headline-only layout (web `size.cols <= 1`).
    public var isCompact: Bool {
        cols <= 1
    }

    /// Three-or-more-column footprint → adds the per-row download affordance
    /// (web `size.cols >= 3`).
    public var isWide: Bool {
        cols >= 3
    }
}

// MARK: - Domain model

/// Normalised lifecycle state of an export job — the union of the web `useExports`
/// (`fsmState`) and `useExportJobs` (`status`) discriminators folded to one lenient
/// enum (web `normaliseStatusFromExport` / `normaliseStatusFromAdmin`).
public enum ExportJobStatus: String, CaseIterable, Sendable {
    case queued
    case processing
    case ready
    case failed

    /// Lenient parse mirroring the web normalisers: `running` ⇒ processing,
    /// `done`/`completed` ⇒ ready, `error` ⇒ failed, anything else ⇒ queued.
    public static func normalised(from raw: String) -> ExportJobStatus {
        switch raw.lowercased() {
        case "processing", "running": .processing
        case "ready", "done", "completed": .ready
        case "failed", "error": .failed
        default: .queued
        }
    }

    /// Sort weight — processing first, then queued, ready, failed (web `STATUS_ORDER`).
    public var order: Int {
        switch self {
        case .processing: 0
        case .queued: 1
        case .ready: 2
        case .failed: 3
        }
    }

    /// Semantic tone for the status badge (web `STATUS_BADGE.variant`).
    public var tone: TSTone {
        switch self {
        case .queued: .neutral
        case .processing: .info
        case .ready: .success
        case .failed: .danger
        }
    }

    /// Localised badge label key (resolves through the P1/S10 catalog).
    public var labelKey: LocalizedStringKey {
        LocalizedStringKey(labelKeyString)
    }

    /// Raw catalog key, exposed so the accessibility label can resolve it via
    /// `String(localized:)` (catalog keys live under the `translation.` prefix).
    public var labelKeyString: String {
        switch self {
        case .queued: "translation.export.status.queued"
        case .processing: "translation.export.status.processing"
        case .ready: "translation.export.status.ready"
        case .failed: "translation.export.status.failed"
        }
    }
}

/// One job as delivered by a source feed before merge — the native port of the web
/// `NormalisedJob`, keeping `rawStatus` (the source discriminator string) so the
/// reducer can normalise both source shapes through one path.
public struct ExportStatusSourceJob: Equatable, Sendable {
    public let id: String
    public let format: String
    public let filePath: String?
    public let fileSizeBytes: Int64
    public let createdAt: String
    public let rawStatus: String

    public init(
        id: String,
        format: String,
        filePath: String?,
        fileSizeBytes: Int64,
        createdAt: String,
        rawStatus: String
    ) {
        self.id = id
        self.format = format
        self.filePath = filePath
        self.fileSizeBytes = fileSizeBytes
        self.createdAt = createdAt
        self.rawStatus = rawStatus
    }
}

/// A merged, status-normalised, display-ready export row — the web post-merge item
/// `{ job, status }`.
public struct ExportStatusRow: Equatable, Identifiable, Sendable {
    public let id: String
    public let format: String
    public let filePath: String?
    public let fileSizeBytes: Int64
    public let createdAt: String
    public let status: ExportJobStatus

    public init(
        id: String,
        format: String,
        filePath: String?,
        fileSizeBytes: Int64,
        createdAt: String,
        status: ExportJobStatus
    ) {
        self.id = id
        self.format = format
        self.filePath = filePath
        self.fileSizeBytes = fileSizeBytes
        self.createdAt = createdAt
        self.status = status
    }
}

// MARK: - Reducer (pure, framework-free)

/// Pure projection logic shared by the view and its tests — the exact port of the
/// web `sortedJobs`/`activeCount`/`hasRunning` memos plus the `fmtBytes` /
/// `truncateFilename` helpers. Holds no SwiftUI/KMP dependency so it is unit
/// testable in isolation.
public enum ExportStatusReducer {
    /// Merge + dedupe (admin wins, position preserved like JS `Map.set`) + sort
    /// (status order, then newest first). Swift's `sorted(by:)` is stable, so rows
    /// with an equal sort key keep their insertion order exactly as the web does.
    public static func merge(
        exports: [ExportStatusSourceJob],
        admin: [ExportStatusSourceJob]
    ) -> [ExportStatusRow] {
        var indexByID: [String: Int] = [:]
        var rows: [ExportStatusRow] = []

        func upsert(_ source: ExportStatusSourceJob) {
            let row = ExportStatusRow(
                id: source.id,
                format: source.format,
                filePath: source.filePath,
                fileSizeBytes: source.fileSizeBytes,
                createdAt: source.createdAt,
                status: ExportJobStatus.normalised(from: source.rawStatus)
            )
            if let existing = indexByID[source.id] {
                rows[existing] = row
            } else {
                indexByID[source.id] = rows.count
                rows.append(row)
            }
        }

        for source in exports {
            upsert(source)
        }
        for source in admin {
            upsert(source)
        }

        return rows.sorted { lhs, rhs in
            if lhs.status.order != rhs.status.order {
                return lhs.status.order < rhs.status.order
            }
            return epochMillis(lhs.createdAt) > epochMillis(rhs.createdAt)
        }
    }

    /// Count of jobs still in flight — processing or queued (web `activeCount`).
    public static func activeCount(_ rows: [ExportStatusRow]) -> Int {
        rows.count(where: { $0.status == .processing || $0.status == .queued })
    }

    /// Whether any job is actively processing (web `hasRunning`).
    public static func hasRunning(_ rows: [ExportStatusRow]) -> Bool {
        rows.contains { $0.status == .processing }
    }

    /// Human byte size — the exact port of the web `fmtBytes` (1 decimal place,
    /// `—` for non-positive sizes).
    public static func formatBytes(_ bytes: Int64) -> String {
        if bytes <= 0 { return "—" }
        let value = Double(bytes)
        let kib = 1024.0
        let mib = kib * 1024
        let gib = mib * 1024
        if value < kib { return "\(bytes) B" }
        if value < mib { return String(format: "%.1f KB", value / kib) }
        if value < gib { return String(format: "%.1f MB", value / mib) }
        return String(format: "%.1f GB", value / gib)
    }

    /// Basename, ellipsised past `maxLength` — the port of the web
    /// `truncateFilename` (`—` when no path is present).
    public static func truncateFilename(_ path: String?, maxLength: Int) -> String {
        guard let path, !path.isEmpty else { return "—" }
        let name = path.split(separator: "/").last.map(String.init) ?? path
        if name.count <= maxLength { return name }
        let head = name.prefix(max(0, maxLength - 1))
        return head + "…"
    }

    /// Epoch milliseconds for an ISO-8601 string; `0` for unparsable input (the web
    /// `new Date(x).getTime()` with the `NaN`→unsorted edge folded to a stable `0`).
    public static func epochMillis(_ iso: String) -> Double {
        guard let date = parseISODate(iso) else { return 0 }
        return date.timeIntervalSince1970 * 1000
    }

    /// Parses an ISO-8601 timestamp with or without fractional seconds.
    public static func parseISODate(_ iso: String) -> Date? {
        if iso.isEmpty { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// Deterministic VoiceOver label for one row, built from already-resolved,
    /// localised pieces so the builder stays catalog-independent for unit tests.
    public static func accessibilityLabel(
        filename: String,
        format: String,
        size: String,
        status: String,
        time: String
    ) -> String {
        let formatPart = format.isEmpty ? "—" : format.uppercased()
        return [filename, formatPart, size, status, time]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}

// MARK: - Feed + snapshot + view state

/// Cache-then-network feed state for one source — the native, KMP-free mirror of
/// the facade `LoadableState` (ADR-013). The dashboard host maps each shared
/// `StateHolderModel<LoadableState<…>>` emission into this at the binding seam so
/// the view never references KMP symbols or performs HTTP.
public enum ExportStatusFeed: Equatable, Sendable {
    case idle
    case loading(cached: [ExportStatusSourceJob], stale: Bool)
    case loaded([ExportStatusSourceJob], stale: Bool)
    case empty(stale: Bool)
    case failed(message: String?, cached: [ExportStatusSourceJob], stale: Bool)

    /// The most recent rows to display, whether fresh, cached, or absent.
    public var value: [ExportStatusSourceJob] {
        switch self {
        case .idle, .empty: []
        case let .loading(cached, _): cached
        case let .loaded(rows, _): rows
        case let .failed(_, cached, _): cached
        }
    }

    /// Whether a first-load spinner is warranted (in flight with nothing cached).
    public var isInitialLoading: Bool {
        if case let .loading(cached, _) = self { return cached.isEmpty }
        return false
    }

    /// Whether the feed is fetching in the background (with cached rows present).
    public var isFetching: Bool {
        if case .loading = self { return true }
        return false
    }

    /// Whether the feed is in a failure state.
    public var isError: Bool {
        if case .failed = self { return true }
        return false
    }

    /// Whether the displayed value is older than its freshness window.
    public var isStale: Bool {
        switch self {
        case .idle: false
        case let .loading(_, stale), let .loaded(_, stale),
             let .empty(stale), let .failed(_, _, stale):
            stale
        }
    }
}

/// Aggregate of both source feeds plus connectivity — the input the host pushes and
/// the view renders. Combines the two web TanStack query results.
public struct ExportStatusSnapshot: Equatable, Sendable {
    public var exports: ExportStatusFeed
    public var admin: ExportStatusFeed
    public var isOffline: Bool
    public var lastUpdated: Date?

    public init(
        exports: ExportStatusFeed = .idle,
        admin: ExportStatusFeed = .idle,
        isOffline: Bool = false,
        lastUpdated: Date? = nil
    ) {
        self.exports = exports
        self.admin = admin
        self.isOffline = isOffline
        self.lastUpdated = lastUpdated
    }

    /// The pre-bind idle snapshot.
    public static let idle = ExportStatusSnapshot()
}

/// Fully-derived, render-ready state — the single source of truth the view switches
/// on. Pure value type so every rendered branch is unit testable without SwiftUI.
public struct ExportStatusViewState: Equatable {
    /// The dominant rendering branch.
    public enum Phase: Equatable {
        case loading
        case error
        case empty
        case content
    }

    public let phase: Phase
    public let rows: [ExportStatusRow]
    public let activeCount: Int
    public let hasRunning: Bool
    public let isStale: Bool
    public let isOffline: Bool
    public let isRefreshing: Bool
    public let lastUpdated: Date?

    public init(snapshot: ExportStatusSnapshot) {
        let mergedRows = ExportStatusReducer.merge(
            exports: snapshot.exports.value,
            admin: snapshot.admin.value
        )
        let anyInitialLoading = snapshot.exports.isInitialLoading || snapshot.admin.isInitialLoading
        let anyError = snapshot.exports.isError || snapshot.admin.isError
        let anyFetching = snapshot.exports.isFetching || snapshot.admin.isFetching

        rows = mergedRows
        activeCount = ExportStatusReducer.activeCount(mergedRows)
        hasRunning = ExportStatusReducer.hasRunning(mergedRows)
        isStale = snapshot.exports.isStale || snapshot.admin.isStale
        isOffline = snapshot.isOffline
        isRefreshing = anyFetching && !mergedRows.isEmpty
        lastUpdated = snapshot.lastUpdated

        if mergedRows.isEmpty, anyInitialLoading, !anyError {
            phase = .loading
        } else if mergedRows.isEmpty, anyError {
            phase = .error
        } else if mergedRows.isEmpty {
            phase = .empty
        } else {
            phase = .content
        }
    }
}

// MARK: - Telemetry seam

/// The P1/S11 `view.opened` emission seam. The host may inject a shared-`Telemetry`
/// backed sink; the default routes to the Apple `os.Logger` platform sink.
public protocol ExportStatusTelemetry: AnyObject {
    func viewOpened(surface: String)
}

/// Default `os.Logger`-backed sink (Apple platform observability wiring for the
/// P1/S11 `view.opened` event). Emits only the surface slug — never PII (ADR-016).
public final class OSLogExportStatusTelemetry: ExportStatusTelemetry, Sendable {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics.view")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Provider seam + model

/// The data-binding seam — the native analogue of the web `useExports` /
/// `useExportJobs` hooks. The host implements this over the shared `ExportsStore` /
/// `AdminStore` (via `AppContainer.loadable(...)`); previews and tests supply
/// lightweight doubles. The view never touches HTTP or KMP symbols directly.
@MainActor
public protocol ExportStatusProvider: AnyObject {
    /// Begin delivering snapshots; `onUpdate` is invoked with the current value and
    /// on every subsequent change.
    func start(_ onUpdate: @escaping (ExportStatusSnapshot) -> Void)
    /// Re-fetch both source feeds (web `exportsRefetch()` + `adminRefetch()`).
    func refresh()
}

/// Observable view-model that owns the latest snapshot and exposes the derived
/// `ExportStatusViewState`. Mirrors the codebase's `StateHolderModel` pattern: a
/// thin `@MainActor @Observable` adapter over an injected provider.
@MainActor
@Observable
public final class ExportStatusModel {
    public private(set) var snapshot: ExportStatusSnapshot

    @ObservationIgnored private let provider: ExportStatusProvider
    @ObservationIgnored private var started = false

    public init(provider: ExportStatusProvider, initial: ExportStatusSnapshot = .idle) {
        self.provider = provider
        snapshot = initial
    }

    /// Begins observing the provider. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        provider.start { [weak self] next in
            self?.snapshot = next
        }
    }

    /// Forwards a manual refresh to the provider.
    public func refresh() {
        provider.refresh()
    }

    /// The derived, render-ready state.
    public var viewState: ExportStatusViewState {
        ExportStatusViewState(snapshot: snapshot)
    }
}

/// Host-driven provider: the dashboard host constructs this, maps each shared
/// `LoadableState` emission into an `ExportStatusFeed` on the stored properties, and
/// points `onRefresh` at the `ExportsStore`/`AdminStore` refresh seam. Keeping the
/// mapping here leaves the view (and this file) free of any KMP dependency.
@MainActor
public final class ExportStatusFeedProvider: ExportStatusProvider {
    public var exports: ExportStatusFeed {
        didSet { publish() }
    }

    public var admin: ExportStatusFeed {
        didSet { publish() }
    }

    public var isOffline: Bool {
        didSet { publish() }
    }

    public var lastUpdated: Date? {
        didSet { publish() }
    }

    /// Wired by the host to the shared stores' refresh.
    public var onRefresh: (() -> Void)?

    private var sink: ((ExportStatusSnapshot) -> Void)?

    public init(
        exports: ExportStatusFeed = .idle,
        admin: ExportStatusFeed = .idle,
        isOffline: Bool = false,
        lastUpdated: Date? = nil
    ) {
        self.exports = exports
        self.admin = admin
        self.isOffline = isOffline
        self.lastUpdated = lastUpdated
    }

    /// The current aggregate snapshot.
    public var snapshot: ExportStatusSnapshot {
        ExportStatusSnapshot(exports: exports, admin: admin, isOffline: isOffline, lastUpdated: lastUpdated)
    }

    public func start(_ onUpdate: @escaping (ExportStatusSnapshot) -> Void) {
        sink = onUpdate
        publish()
    }

    public func refresh() {
        onRefresh?()
    }

    private func publish() {
        sink?(snapshot)
    }
}

// MARK: - View

/// Native, Apple-idiomatic Export Status dashboard widget — parity port of
/// `web/src/features/dashboard/widgets/ExportStatusWidget.tsx`.
///
/// Reproduces the web data (merged `useExports` + `useExportJobs`), composition
/// (compact headline / standard list / wide list with download), and every state
/// (loading, empty, error, stale, offline). All strings resolve through the P1/S10
/// catalog; data binds through the injected `ExportStatusProvider` (P1/S8 seam).
public struct ExportStatusWidget: View {
    private let size: ExportStatusWidgetSize
    private let telemetry: ExportStatusTelemetry
    private let onDownload: ((ExportStatusRow) -> Void)?

    @State private var model: ExportStatusModel
    @State private var didEmitOpen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Standard maximum rows in the list layout (web `maxItems` non-compact).
    private static let maxRows = 15
    /// Filename truncation budget (web `truncateFilename(path, 28)`).
    private static let filenameBudget = 28

    @MainActor
    public init(
        size: ExportStatusWidgetSize = ExportStatusWidgetRegistry.defaultSize,
        provider: ExportStatusProvider,
        telemetry: ExportStatusTelemetry = OSLogExportStatusTelemetry(),
        onDownload: ((ExportStatusRow) -> Void)? = nil
    ) {
        self.size = size
        self.telemetry = telemetry
        self.onDownload = onDownload
        _model = State(initialValue: ExportStatusModel(provider: provider))
    }

    public var body: some View {
        let state = model.viewState
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header(state)
            content(state)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .task {
            model.start()
            guard !didEmitOpen else { return }
            didEmitOpen = true
            telemetry.viewOpened(surface: ExportStatusWidgetRegistry.surfaceSlug)
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: Header

    private func header(_ state: ExportStatusViewState) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "square.and.arrow.down")
                .font(.caption2)
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text("translation.widget.exportStatus")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshness(state)
            refreshButton
        }
    }

    @ViewBuilder
    private func freshness(_ state: ExportStatusViewState) -> some View {
        if state.isOffline {
            TSFreshnessIndicator(isStale: true, label: "widget.freshness.offline")
        } else if state.isStale {
            TSFreshnessIndicator(isStale: true, label: "widget.freshness.stale")
        } else if state.isRefreshing {
            ProgressView()
                .controlSize(.mini)
                .accessibilityLabel(Text("widget.freshness.updated"))
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.caption2)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .buttonStyle(.plain)
        .frame(minWidth: 28, minHeight: 28)
        .accessibilityLabel(Text("translation.common.refresh"))
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ state: ExportStatusViewState) -> some View {
        switch state.phase {
        case .loading:
            loadingView
        case .error:
            errorView
        case .empty:
            emptyView
        case .content:
            if size.isCompact {
                compactView(state)
            } else {
                listView(state)
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 44, height: 12)
                    TSSkeleton(width: 52, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(Text("widget.freshness.updated"))
    }

    private var emptyView: some View {
        TSEmptyState(
            title: "translation.widget.noExportJobs",
            systemImage: "tray.and.arrow.down"
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var errorView: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text("translation.queryError.title")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton("translation.common.retry", variant: .secondary, size: .small) {
                model.refresh()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func compactView(_ state: ExportStatusViewState) -> some View {
        VStack(spacing: TSSpacing.xs) {
            TSAnimatedNumber(formatted: "\(state.activeCount)")
            Text("translation.widget.exportActiveJobs")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
            TSBadge(
                state.hasRunning ? "translation.widget.exportRunningBadge" : "translation.widget.exportIdleBadge",
                tone: state.hasRunning ? .success : .neutral
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func listView(_ state: ExportStatusViewState) -> some View {
        let visible = Array(state.rows.prefix(Self.maxRows))
        return ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, row in
                    VStack(spacing: TSSpacing.xs) {
                        jobRow(row)
                        if row.status == .processing {
                            TSMetricBar(fraction: 0.5, tone: .info)
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(.vertical, TSSpacing.xs)
                    if index < visible.count - 1 {
                        Rectangle()
                            .fill(Color.TS.border)
                            .frame(height: 1)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
    }

    private func jobRow(_ row: ExportStatusRow) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: ExportStatusReducer.truncateFilename(row.filePath, maxLength: Self.filenameBudget))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            FormatChip(format: row.format)
            Text(verbatim: ExportStatusReducer.formatBytes(row.fileSizeBytes))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 60, alignment: .trailing)
            TSBadge(row.status.labelKey, tone: row.status.tone)
            Text(verbatim: relativeTime(row.createdAt))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 48, alignment: .trailing)
            if size.isWide {
                downloadAffordance(row)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(row)))
    }

    @ViewBuilder
    private func downloadAffordance(_ row: ExportStatusRow) -> some View {
        if row.status == .ready, row.filePath != nil, let onDownload {
            Button {
                onDownload(row)
            } label: {
                Image(systemName: "arrow.down.circle")
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityLabel(Text("translation.widget.exportDownload"))
        } else {
            Color.clear
                .frame(width: 44, height: 1)
                .accessibilityHidden(true)
        }
    }

    // MARK: Helpers

    private func relativeTime(_ iso: String) -> String {
        guard let date = ExportStatusReducer.parseISODate(iso) else { return "—" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func rowAccessibilityLabel(_ row: ExportStatusRow) -> String {
        ExportStatusReducer.accessibilityLabel(
            filename: ExportStatusReducer.truncateFilename(row.filePath, maxLength: Self.filenameBudget),
            format: row.format,
            size: ExportStatusReducer.formatBytes(row.fileSizeBytes),
            status: String(localized: String.LocalizationValue(row.status.labelKeyString)),
            time: relativeTime(row.createdAt)
        )
    }
}

/// Compact uppercased format pill (web neutral `Badge` around `format`). Renders the
/// raw, non-localised format token verbatim.
private struct FormatChip: View {
    let format: String

    private var text: String {
        format.isEmpty ? "—" : format.uppercased()
    }

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Previews

#if DEBUG
    /// In-memory provider for previews and tests — replays a fixed snapshot.
    @MainActor
    public final class PreviewExportStatusProvider: ExportStatusProvider {
        private let snapshot: ExportStatusSnapshot
        public private(set) var refreshCount = 0

        public init(_ snapshot: ExportStatusSnapshot) {
            self.snapshot = snapshot
        }

        public func start(_ onUpdate: @escaping (ExportStatusSnapshot) -> Void) {
            onUpdate(snapshot)
        }

        public func refresh() {
            refreshCount += 1
        }
    }

    enum ExportStatusPreviewData {
        static func source(
            id: String,
            format: String,
            status: String,
            sizeBytes: Int64,
            minutesAgo: Int
        ) -> ExportStatusSourceJob {
            let date = Calendar.current.date(byAdding: .minute, value: -minutesAgo, to: Date()) ?? Date()
            let iso = ISO8601DateFormatter().string(from: date)
            // Queued jobs have not produced a file yet (web parity: no download link).
            let path = status == "queued" ? nil : "/exports/\(id)_\(format).\(format)"
            return ExportStatusSourceJob(
                id: id,
                format: format,
                filePath: path,
                fileSizeBytes: sizeBytes,
                createdAt: iso,
                rawStatus: status
            )
        }

        static var populated: ExportStatusSnapshot {
            let exports: [ExportStatusSourceJob] = [
                source(id: "1", format: "csv", status: "ready", sizeBytes: 2_400_000, minutesAgo: 4),
                source(id: "2", format: "json", status: "processing", sizeBytes: 0, minutesAgo: 1)
            ]
            let admin: [ExportStatusSourceJob] = [
                source(id: "3", format: "csv", status: "queued", sizeBytes: 0, minutesAgo: 0),
                source(id: "4", format: "json", status: "failed", sizeBytes: 0, minutesAgo: 32)
            ]
            return ExportStatusSnapshot(
                exports: .loaded(exports, stale: false),
                admin: .loaded(admin, stale: false),
                lastUpdated: Date()
            )
        }

        static var empty: ExportStatusSnapshot {
            ExportStatusSnapshot(exports: .empty(stale: false), admin: .empty(stale: false), lastUpdated: Date())
        }

        static var loading: ExportStatusSnapshot {
            ExportStatusSnapshot(exports: .loading(cached: [], stale: false), admin: .loading(cached: [], stale: false))
        }

        static var failed: ExportStatusSnapshot {
            ExportStatusSnapshot(
                exports: .failed(message: "boom", cached: [], stale: false),
                admin: .failed(message: "boom", cached: [], stale: false)
            )
        }
    }

    #Preview("Standard — populated") {
        ExportStatusWidget(
            size: ExportStatusWidgetSize(cols: 2, rows: 4),
            provider: PreviewExportStatusProvider(ExportStatusPreviewData.populated),
            onDownload: { _ in }
        )
        .frame(width: 320, height: 280)
        .padding()
    }

    #Preview("Wide — download") {
        ExportStatusWidget(
            size: ExportStatusWidgetSize(cols: 3, rows: 4),
            provider: PreviewExportStatusProvider(ExportStatusPreviewData.populated),
            onDownload: { _ in }
        )
        .frame(width: 460, height: 280)
        .padding()
    }

    #Preview("Compact — headline") {
        ExportStatusWidget(
            size: ExportStatusWidgetSize(cols: 1, rows: 2),
            provider: PreviewExportStatusProvider(ExportStatusPreviewData.populated)
        )
        .frame(width: 150, height: 150)
        .padding()
    }

    #Preview("Empty / Loading / Error") {
        VStack(spacing: TSSpacing.md) {
            ExportStatusWidget(provider: PreviewExportStatusProvider(ExportStatusPreviewData.empty))
                .frame(height: 160)
            ExportStatusWidget(provider: PreviewExportStatusProvider(ExportStatusPreviewData.loading))
                .frame(height: 120)
            ExportStatusWidget(provider: PreviewExportStatusProvider(ExportStatusPreviewData.failed))
                .frame(height: 160)
        }
        .padding()
    }
#endif
