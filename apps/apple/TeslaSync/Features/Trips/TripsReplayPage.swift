import SwiftUI

/// Native SwiftUI parity of `web/src/features/trips/pages/TripReplayPage.tsx`. Replays one drive:
/// the playback transport (scrubber + speed sparkline), the live "current position" stat bar, the
/// elevation profile, the speed+power timeline, and the drive summary — all threaded through one
/// source of truth, the `@Observable` model's `currentIndex` (web `replay.currentIndex` via
/// `useTripReplay`), so the chart playheads and stat cards stay in lockstep.
///
/// Adaptive (ADR-002/006): the stat + summary grids reflow for macOS / iPad regular width vs.
/// compact iPhone, the charts get full width, and the page scrolls; the system back button plus an
/// explicit "Back to Drive" affordance replace the web back link. All copy resolves from
/// `Localizable.xcstrings` with the web key names; numeric values format at the render boundary
/// through `Units` / SI formatters — nothing non-SI is stored or computed (ADR-005). Data binds
/// through the `TripsReplayModel` (no networking in the view, ADR-004).
public struct TripsReplayPage: View {
    @State private var model: TripsReplayModel
    @Environment(\.tsUnits) private var units
    @Environment(\.dismiss) private var dismiss

    public init(model: TripsReplayModel) {
        _model = State(initialValue: model)
    }

    public init(driveID: Int64, dataSource: any TripsReplayDataSource = SampleTripsReplayDataSource()) {
        _model = State(initialValue: TripsReplayModel(driveID: driveID, dataSource: dataSource))
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("replay.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .toolbar { backToolbar }
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.state else { return }
                await model.load()
            }
    }

    // MARK: - Top-level status switch (web `loading ? … : error ? … : body`)

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            TripsReplayPageSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    // MARK: - Ready (web main body)

    @ViewBuilder
    private var readyView: some View {
        subtitle
        if model.hasPositions {
            TripsReplayControlsSection(model: model)
            TripsReplayStatsSection(model: model)
            TripsReplayElevationSection(model: model)
            TripsReplayTimelineSection(model: model)
            TripsReplaySummarySection(model: model)
        } else {
            noGpsState
        }
    }

    /// Web `PageContainer subtitle`: `Drive #{id} — {date}{ · start → end}`.
    @ViewBuilder
    private var subtitle: some View {
        if let record = model.record {
            Text(verbatim: subtitleText(record))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityElement(children: .combine)
        }
    }

    private func subtitleText(_ record: TripsReplayRecord) -> String {
        let drive = String(localized: "replay.drive")
        var line = "\(drive) #\(record.id) — \(TripsReplayDateText.medium(record.startedAt))"
        if let start = record.startAddress, let end = record.endAddress, !start.isEmpty, !end.isEmpty {
            line += " · \(start) → \(end)"
        }
        return line
    }

    /// Web no-GPS empty state (`positions.length === 0`).
    private var noGpsState: some View {
        TSEmptyState(
            title: "replay.noGpsTitle",
            message: "replay.noGps",
            systemImage: "mappin.slash"
        )
        .frame(maxWidth: .infinity, minHeight: 240)
    }

    /// Retryable failure of the drive fetch (web `PageContainer error`) with the HIG retry
    /// affordance (ADR-011).
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
    }

    /// The "Back to Drive" affordance (web header back link → `/drives/{id}`): pops back to the
    /// drive that pushed this replay.
    @ToolbarContentBuilder
    private var backToolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button {
                dismiss()
            } label: {
                Label("replay.backToDrive", systemImage: "chevron.backward")
            }
        }
    }
}

// MARK: - Skeleton (web loading state)

/// The initial loading state: redacted scrubber / panel shapes with a centered progress indicator
/// so the structure is recognizable while the drive loads (ADR-011 — never a blank screen).
struct TripsReplayPageSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            Text(verbatim: "Drive #000 — Jun 10, 2024 · Mountain View → Palo Alto")
                .font(Font.TS.bodySm)
                .skeletonRedaction()
            ForEach(0 ..< 3, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        Text(verbatim: "Section title").font(Font.TS.panel)
                        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                            .fill(Color.TS.surface)
                            .frame(height: 80)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .skeletonRedaction()
                }
            }
            ProgressView()
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("loading"))
        }
        .accessibilityLabel(Text("loading"))
    }
}

private extension View {
    /// Applies the system skeleton redaction for the loading state, isolated so the SwiftUI
    /// redaction-reason API token is opted out of the stub scan on one line.
    func skeletonRedaction() -> some View {
        redacted(reason: .placeholder) // parity:allow SwiftUI redaction API, not a stub
    }
}

// MARK: - Date text (web `formatDate`)

/// Small date formatter for the subtitle (web `formatDate(startTs)`) — a verbatim device-formatted
/// string matching the web's locale-formatted timestamp.
enum TripsReplayDateText {
    static func medium(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            TripsReplayPage(driveID: 7)
        }
        .tsUnits(.metric)
    }

    #Preview("No GPS") {
        NavigationStack {
            TripsReplayPage(driveID: 7, dataSource: EmptyTripsReplayDataSource())
        }
        .tsUnits(.imperial)
    }

    #Preview("Error") {
        NavigationStack {
            TripsReplayPage(driveID: 7, dataSource: FailingTripsReplayDataSource())
        }
        .tsUnits(.metric)
    }
#endif
