//
//  DataExportPage.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple)
//
//  Native SwiftUI / HIG parity of `web/src/features/system/pages/DataExportPage.tsx`
//  (route `/data-export`). Reproduces every section of the web page — the summary
//  stats (Total Exports / Total Size / Most Exported / Last Export), the GDPR
//  "Download my data" account export, the New Export wizard (data type, format,
//  optional column picker, vehicle, date range), the CSV / JSON format previews, the
//  data overview, the export history, and the recurring scheduled-exports panel.
//
//  Faithful to the web, each panel renders and switches its own data state in place
//  (loading / empty / error / success) rather than gating the whole surface. Adaptive
//  across macOS + iOS/iPadOS (ADR-002/006); all data binds through the `@Observable`
//  `DataExportPageModel` (ADR-004 — no networking in the view); every visible string
//  resolves from `Localizable.xcstrings` with the web key names (ADR-014).
//

import SwiftUI

public struct DataExportPage: View {
    @State private var model: DataExportPageModel

    public init() {
        _model = State(initialValue: DataExportPageModel())
    }

    /// Injectable initializer for previews / route registration (in-module).
    init(model: DataExportPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                statsRow
                DataExportAccountPanel(model: model)
                DataExportWizardView(model: model)
                DataExportFormatCards()
                DataExportOverviewCard(model: model)
                DataExportHistoryView(model: model)
                scheduledSection
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(String(localized: "dataExport.title", defaultValue: "Data Export"))
        .task { await model.loadIfNeeded() }
        .refreshable { await model.refresh() }
        .alert(
            model.feedback?.title ?? "",
            isPresented: feedbackBinding,
            presenting: model.feedback
        ) { _ in
            Button(String(localized: "dataExport.dismiss", defaultValue: "OK"), role: .cancel) {}
        } message: { feedback in
            Text(verbatim: feedback.message)
        }
    }

    // MARK: - Header (web PageContainer title + subtitle + Refresh)

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top) { titleBlock; Spacer(minLength: 12); refreshButton }
            VStack(alignment: .leading, spacing: 12) { titleBlock; refreshButton }
        }
        .accessibilityElement(children: .contain)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(String(localized: "dataExport.title", defaultValue: "Data Export"))
                .font(.largeTitle.weight(.bold))
            Text(String(
                localized: "dataExport.subtitle",
                defaultValue: "Export vehicle data in CSV or JSON format"
            ))
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var refreshButton: some View {
        Button {
            Task { await model.refresh() }
        } label: {
            Label(
                String(localized: "dataExport.refresh", defaultValue: "Refresh"),
                systemImage: "arrow.clockwise"
            )
        }
        .buttonStyle(.bordered)
    }

    // MARK: - Stats row (web `StatsRow` — Total Exports / Size / Most / Last)

    private var statsRow: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
            DataExportMetricCard(
                label: String(localized: "Total Exports", defaultValue: "Total Exports"),
                value: "\(model.totalExports)",
                systemImage: "shippingbox.fill",
                tone: .cyan
            )
            DataExportMetricCard(
                label: String(localized: "Total Size", defaultValue: "Total Size"),
                value: model.totalSizeLabel,
                systemImage: "internaldrive.fill",
                tone: .blue
            )
            DataExportMetricCard(
                label: String(localized: "Most Exported", defaultValue: "Most Exported"),
                value: model.mostExportedLabel,
                subtitle: String(localized: "By Count", defaultValue: "By Count"),
                systemImage: "chart.bar.fill",
                tone: .purple
            )
            DataExportMetricCard(
                label: String(localized: "Last Export", defaultValue: "Last Export"),
                value: model.lastExportLabel,
                systemImage: "clock.fill",
                tone: .green
            )
        }
        // Web `StatsRow` renders skeleton cards while loading.
        .redacted(reason: model.state == .loading ? .placeholder : []) // parity:allow SwiftUI redaction skeleton
    }

    // MARK: - Scheduled exports (web `<RequiresAuth><ScheduledExportsPanel/>`)

    private var scheduledSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScheduledExportsPanel()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(String(localized: "dataExport.scheduled.feature", defaultValue: "Scheduled exports"))
        )
    }

    // MARK: - Feedback alert binding (web toasts)

    private var feedbackBinding: Binding<Bool> {
        Binding(
            get: { model.feedback != nil },
            set: { if !$0 { model.feedback = nil } }
        )
    }
}

#if DEBUG
    #Preview("Loaded") {
        NavigationStack { DataExportPage(model: DataExportPageModel()) }
    }

    #Preview("Empty") {
        NavigationStack { DataExportPage(model: DataExportPageModel(dataSource: EmptyDataExportDataSource())) }
    }

    #Preview("Error") {
        NavigationStack { DataExportPage(model: DataExportPageModel(dataSource: FailingDataExportDataSource())) }
    }
#endif
