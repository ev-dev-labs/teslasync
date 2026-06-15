import SwiftUI

// The four data-bound regions of the Ingest X-Ray page, each composing a P3 X-Ray component
// (presentational view + pure projection from `TeslaSync/feature-views/`) over the page's central
// `IngestXRayPageModel`. Split out of `IngestXRayPage.swift` so the scaffold stays readable and
// each region owns its own state switch. No networking lives here (ADR-004); copy resolves through
// the per-component i18n facades (the web `t(key, default)` keys) and the app string catalog.

// MARK: - GlassPanel1 — controls bar (web `XRayControls`)

/// The controls bar: the vehicle picker (state-driven: skeleton / picker / empty hint / inline
/// error) plus the always-usable window + bucket selectors, laid out responsively (web
/// `flex flex-wrap` → `ViewThatFits`). Reuses the P3 `XRayControls` projection + presentational
/// pieces, reporting selections back through the page model (web controlled-component callbacks).
struct IngestXRayControlsSection: View {
    let model: IngestXRayPageModel

    private var vehicleOptions: [XRayControlOption<Int?>] {
        XRayControlsProjection.vehicleOptions(model.vehicles, localize: XRayControlsStrings.string)
    }

    private var windowOptions: [XRayControlOption<IngestXRayWindow>] {
        XRayControlsProjection.windowOptions(localize: XRayControlsStrings.string)
    }

    private var bucketOptions: [XRayControlOption<IngestXRayBucket>] {
        XRayControlsProjection.bucketOptions(window: model.window, localize: XRayControlsStrings.string)
    }

    var body: some View {
        XRayControlsLayout {
            vehicleSlot
        } window: {
            XRayControlSelect(
                options: windowOptions,
                selection: model.window,
                accessibilityLabel: XRayControlsStrings.string("admin.xray.controls.windowAria", "Window"),
                onSelect: { model.selectWindow($0) }
            )
        } bucket: {
            XRayControlSelect(
                options: bucketOptions,
                selection: model.bucket,
                accessibilityLabel: XRayControlsStrings.string("admin.xray.controls.bucketAria", "Bucket"),
                onSelect: { model.selectBucket($0) }
            )
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var vehicleSlot: some View {
        switch model.controlsPhase {
        case .loading:
            XRayControlsSkeletonField()
        case .content:
            vehiclePicker
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                vehiclePicker
                    .disabled(true)
                XRayControlsEmptyHint()
            }
        case let .error(message):
            XRayControlsErrorSlot(message: message) {
                Task { await model.loadVehicles() }
            }
        }
    }

    private var vehiclePicker: some View {
        XRayControlSelect(
            options: vehicleOptions,
            selection: model.vehicleID,
            accessibilityLabel: XRayControlsStrings.string("admin.xray.controls.vehicleAria", "Vehicle"),
            onSelect: { model.selectVehicle($0) }
        )
    }
}

// MARK: - Header strip (web `XRayHeader`)

/// The three-tile summary strip (Total samples / Distinct fields / Window), reusing the P3
/// `XRayHeader` projection + responsive strip. Renders skeleton values on the initial load and
/// the localized window echo always, exactly like the web header.
struct IngestXRayHeaderSection: View {
    let model: IngestXRayPageModel

    private var stats: [XRayStat] {
        XRayHeaderProjection.build(
            summary: model.summary,
            window: model.window,
            localize: XRayHeaderStrings.string
        )
    }

    var body: some View {
        XRayHeaderStrip(stats: stats, isLoading: model.isDataLoading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
    }
}

// MARK: - GlassPanel3 — samples-per-bucket chart (web `XRayBucketChart`)

/// The bucketed sample-count panel: the web `ChartContainer` title + subtitle over the P3
/// `XRayBucketChart` Swift Charts bar chart, switching loading / empty / error / success in place
/// so the panel never renders a blank region.
struct IngestXRayChartSection: View {
    let model: IngestXRayPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            panelHeader
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var panelHeader: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPanelTitle("admin.xray.chart.title")
            Text("admin.xray.chart.subtitle")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.dataState {
        case .idle, .loading:
            TSChartSkeleton(height: 220)
                .accessibilityLabel(Text("admin.xray.chart.title"))
        case .empty:
            chartEmptyState
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadData() } })
                .frame(maxWidth: .infinity, minHeight: 220)
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(result):
            let bars = XRayBucketChartProjection.bars(from: result.buckets)
            if bars.isEmpty {
                chartEmptyState
            } else {
                XRayBucketBarChart(bars: bars)
            }
        }
    }

    private var chartEmptyState: some View {
        TSEmptyState(title: "admin.xray.chart.empty", systemImage: "chart.bar")
            .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - GlassPanel4 — per-field statistics (web `XRayFieldsTable`)

/// The sortable per-field statistics panel: the web panel header (icon + "Field statistics") over
/// the P3 `XRayFieldsTable` responsive table, switching loading / empty / error / success in place.
/// Rows are sorted + display-formatted by the reused `XRayFieldsProjector` (web `sorted` derive +
/// column `render` callbacks); the sort is driven through the page model (web `useSortToggle`).
struct IngestXRayFieldsSection: View {
    let model: IngestXRayPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            panelHeader
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.xray.panels.fields"))
    }

    private var panelHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSPanelTitle("admin.xray.panels.fields")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.dataState {
        case .idle, .loading:
            TSTableSkeleton(rows: 6)
                .accessibilityLabel(Text("admin.xray.fields.loading"))
        case .empty:
            fieldsEmptyState
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadData() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case .loaded:
            let rows = model.fieldRows()
            if rows.isEmpty {
                fieldsEmptyState
            } else {
                XRayFieldsTableView(
                    rows: rows,
                    sortKey: model.sortKey,
                    sortDirection: model.sortDirection,
                    onSort: { model.toggleSort($0) }
                )
            }
        }
    }

    private var fieldsEmptyState: some View {
        TSEmptyState(title: "admin.xray.fields.empty", systemImage: "tray")
            .frame(maxWidth: .infinity)
    }
}
