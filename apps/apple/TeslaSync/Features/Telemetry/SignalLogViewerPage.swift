import SwiftUI

/// Native SwiftUI parity of `web/src/features/telemetry/pages/SignalLogViewerPage.tsx` (route
/// `/signal-log`). The page queries signal history from Postgres: choose signals (web `useSignals`),
/// set a date range, then "Query" fetches + paginates the history batch. It reproduces every region
/// of the web page, binding through the `@Observable` `SignalLogViewerPageModel` (ADR-004 — no
/// networking in the view):
///   • the header (web `PageContainer` title + subtitle);
///   • the no-vehicle empty state (web `vehicleId === 0` branch);
///   • GlassPanel1 — the signal selector (reusing the shared, fully-localized `SignalMultiSelectView`),
///     the Time Range pickers, the Per-Page select, the Query button, and the records count;
///   • the deferred results region — the pre-query "Select signals and click Query" empty state, then
///     the shared `SignalDataTableView` (loading / empty / error / rows).
///
/// Adaptive across macOS / iPad (regular) and iPhone (compact) via the P2 tokens + P3 components;
/// values render verbatim through the shared SI-aware formatters (the history endpoint already
/// carries display-ready typed values); every literal resolves from `Localizable.xcstrings` with the
/// web key names.
public struct SignalLogViewerPage: View {
    @State private var model: SignalLogViewerPageModel
    private let timeZone: TimeZone

    public init(model: SignalLogViewerPageModel, timeZone: TimeZone = .current) {
        _model = State(initialValue: model)
        self.timeZone = timeZone
    }

    public init(
        vehicleID: Int64 = 1,
        dataSource: any SignalLogViewerDataSource = SampleSignalLogViewerDataSource(),
        timeZone: TimeZone = .current
    ) {
        _model = State(initialValue: SignalLogViewerPageModel(vehicleID: vehicleID, dataSource: dataSource))
        self.timeZone = timeZone
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if let bannerError = model.bannerError {
                    errorBanner(bannerError)
                }
                if model.hasVehicle {
                    controlsPanel
                    resultsSection
                } else {
                    noVehicleState
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(SignalLogViewerStrings.navTitle)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task {
                if case .loading = model.availablePhase { await model.load() }
            }
    }

    // MARK: - Header (web `PageContainer` title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle(SignalLogViewerStrings.title)
            Text(SignalLogViewerStrings.subtitle)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Error banner (web `AlertBanner` — `error.loadFailed`)

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            (Text(SignalLogViewerStrings.loadFailed) + Text(verbatim: ": \(message)"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.statusDanger.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: - No-vehicle state (web `vehicleId === 0` branch)

    private var noVehicleState: some View {
        TSFadeIn(delay: 0.05) {
            TSEmptyState(
                title: SignalLogViewerStrings.noVehicle,
                message: SignalLogViewerStrings.noVehicleDesc,
                systemImage: "bolt.horizontal.circle"
            )
            .frame(maxWidth: .infinity, minHeight: 280)
        }
    }

    // MARK: - GlassPanel1 — controls (web selector + range + per-page + Query)

    private var controlsPanel: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    SignalMultiSelectView(
                        availableState: model.availableSelectState,
                        available: model.availableNames,
                        selected: model.selectedSignals,
                        maxSignals: nil,
                        onAdd: { model.addSignal($0) },
                        onRemove: { model.removeSignal($0) },
                        onRetry: { Task { await model.retryCatalog() } }
                    )
                    controlsRow
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var controlsRow: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            timeRangeControl
            HStack(alignment: .bottom, spacing: TSSpacing.md) {
                perPageControl
                queryButton
                if model.hasQueried {
                    recordsLabel
                }
                Spacer(minLength: 0)
            }
        }
    }

    /// Web `Time Range` `RangePicker` — a labeled From/To day-range, day-granular like the web page.
    private var timeRangeControl: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel(SignalLogViewerStrings.timeRange)
            HStack(spacing: TSSpacing.sm) {
                DatePicker(selection: startBinding, displayedComponents: .date) {
                    Text(SignalLogViewerStrings.timeRange)
                }
                .labelsHidden()
                .tint(Color.TS.accent)
                .accessibilityLabel(Text(SignalLogViewerStrings.timeRange))
                Text(verbatim: "–")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                DatePicker(selection: endBinding, displayedComponents: .date) {
                    Text(SignalLogViewerStrings.timeRange)
                }
                .labelsHidden()
                .tint(Color.TS.accent)
                .accessibilityLabel(Text(SignalLogViewerStrings.timeRange))
            }
        }
    }

    /// Web `Per Page` `Select`.
    private var perPageControl: some View {
        TSSelect(
            selection: perPageBinding,
            options: model.perPageOptions.map { TSSelectOption($0, LocalizedStringKey(String($0))) },
            label: SignalLogViewerStrings.perPage
        )
        .frame(maxWidth: 120, alignment: .leading)
    }

    /// Web `Query` `Button` (`loading={isFetching}`, `disabled={!canQuery}`).
    private var queryButton: some View {
        TSButton(
            variant: .primary,
            isLoading: model.isFetching,
            action: { Task { await model.runQuery() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "cylinder.split.1x2")
                        .font(.system(size: 12, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(SignalLogViewerStrings.query)
                }
            }
        )
        .disabled(!model.canQuery)
        .accessibilityLabel(Text(SignalLogViewerStrings.query))
    }

    /// Web `{totalRecords} {t('records')}` count, shown once a query has run.
    private var recordsLabel: some View {
        (Text(verbatim: "\(model.totalRecords) ") + Text(SignalLogViewerStrings.records))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .monospacedDigit()
            .padding(.bottom, 6)
    }

    // MARK: - Results (web pre-query EmptyState → `SignalHistoryTable`)

    private var resultsSection: some View {
        TSFadeIn(delay: 0.1) {
            if model.hasQueried {
                TSGlassPanel {
                    SignalDataTableView(
                        state: model.tableState,
                        rows: model.pagedRows,
                        pagination: model.pagination,
                        timeZone: timeZone,
                        onPageChange: { model.goToPage($0) },
                        onRetry: { Task { await model.retryQuery() } }
                    )
                }
            } else {
                TSEmptyState(
                    title: SignalLogViewerStrings.selectAndQuery,
                    message: SignalLogViewerStrings.selectAndQueryMessage,
                    systemImage: "cylinder.split.1x2"
                )
                .frame(maxWidth: .infinity, minHeight: 220)
            }
        }
    }

    // MARK: - Bindings (manual so the page keeps owning the model via `@State`)

    private var startBinding: Binding<Date> {
        Binding(get: { model.rangeStart }, set: { model.rangeStart = $0 })
    }

    private var endBinding: Binding<Date> {
        Binding(get: { model.rangeEnd }, set: { model.rangeEnd = $0 })
    }

    private var perPageBinding: Binding<Int> {
        Binding(get: { model.perPage }, set: { model.setPerPage($0) })
    }
}

#if DEBUG
    #Preview("Signal Log Viewer") {
        NavigationStack {
            SignalLogViewerPage()
        }
    }

    #Preview("No vehicle") {
        NavigationStack {
            SignalLogViewerPage(vehicleID: 0)
        }
    }
#endif
