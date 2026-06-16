import SwiftUI

/// Native SwiftUI parity of `web/src/features/trips/pages/TripReplayPage.tsx` (re-exported from
/// `web/src/features/driving/pages/TripReplayPage.tsx`). Replays one drive: the route map with a
/// moving playhead, the playback transport (scrubber + speed), the live "current position" stat
/// bar, the elevation profile, the speed+power timeline, and the drive summary — all threaded
/// through one source of truth, the `@Observable` model's `currentIndex` (web `replay.currentIndex`
/// via `useTripReplay`), so the map marker, chart playheads, and stat cards stay in lockstep.
///
/// Adaptive (ADR-002/006): the stat + summary grids reflow for macOS / iPad regular width vs.
/// compact iPhone, the map + charts get full width, and the page scrolls; the system back button
/// plus an explicit "Back to Drive" link replace the web back affordance. All copy resolves from
/// `Localizable.xcstrings` with the web key names; numeric values format at the render boundary
/// through `Units` / SI formatters — nothing non-SI is stored or computed (ADR-005). Data binds
/// through the `TripReplayPageModel` (no networking in the view).
public struct TripReplayPage: View {
    @State private var model: TripReplayPageModel

    public init(model: TripReplayPageModel) {
        _model = State(initialValue: model)
    }

    @Environment(\.tsUnits) private var units

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
                model.setUnitPreferences(units)
                guard model.status == .loading else { return }
                await model.load()
            }
            .onChange(of: units) { _, newValue in model.setUnitPreferences(newValue) }
    }

    // MARK: - Top-level status switch (web `loading ? … : error ? … : body`)

    @ViewBuilder
    private var content: some View {
        switch model.status {
        case .loading:
            TripReplayPageSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Retryable failure of the drive fetch (web `PageContainer error`), with the HIG retry
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
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main body)

    @ViewBuilder
    private var readyView: some View {
        subtitle

        if model.hasPositions {
            TripReplayMap(model: model.mapModel)
            TripReplayControlsSection(model: model)
            TripReplayStatsSection(model: model)
            TripReplayElevationSection(model: model)
            TripReplayCharts(model: model.chartsModel)
            TripReplaySummarySection(model: model)
        } else {
            noGpsState
        }
    }

    /// Web `PageContainer subtitle`: `Drive #{id} — {date}{ · start → end}`.
    @ViewBuilder
    private var subtitle: some View {
        if let record = model.record {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: subtitleText(record))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func subtitleText(_ record: TripReplayRecord) -> String {
        let drive = String(localized: "replay.drive")
        var line = "\(drive) #\(record.id) — \(TripReplayDateText.date(record.startedAt))"
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

    /// The "Back to Drive" affordance (web header back link → `/drives/{id}`), reachable when the
    /// host stack registers `.driveDetailDestination()`.
    @ToolbarContentBuilder
    private var backToolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            NavigationLink(value: DriveDetailLink(driveID: model.driveID)) {
                Label("replay.backToDrive", systemImage: "chevron.backward")
            }
            .disabled(model.record == nil)
        }
    }
}

// MARK: - Skeleton (web loading state)

/// The initial loading state: redacted map / scrubber / panel shapes with a centered progress
/// indicator so the structure is recognizable while the drive loads (ADR-011 — never a blank
/// screen).
struct TripReplayPageSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            Text(verbatim: "Drive #000 — Jun 10, 2024 · Mountain View → Palo Alto")
                .font(Font.TS.bodySm)
                .replaySkeletonRedaction()
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .fill(Color.TS.surface)
                .frame(height: 320)
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: "00:00 / 00:00").font(Font.TS.panel)
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .fill(Color.TS.surface)
                        .frame(height: 12)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .replaySkeletonRedaction()
            }
            ForEach(0 ..< 2, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        Text(verbatim: "Section title").font(Font.TS.panel)
                        Text(verbatim: "A representative line of replay content for the skeleton state.")
                            .font(Font.TS.bodySm)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .replaySkeletonRedaction()
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
    /// Applies the system skeleton redaction for the loading state. Isolated here so the SwiftUI
    /// redaction-reason API token is opted out of the stub scan on one line.
    func replaySkeletonRedaction() -> some View {
        redacted(reason: .placeholder) // parity:allow SwiftUI redaction API, not a stub
    }
}

// MARK: - Date text (web `formatDate`)

/// Small date formatter for the subtitle (web `formatDate(startTs)`) — a verbatim device-formatted
/// string, matching the web's locale-formatted timestamp.
enum TripReplayDateText {
    static func date(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            TripReplayPage(model: TripReplayPageModel(driveID: 7))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("No GPS") {
        NavigationStack {
            TripReplayPage(
                model: TripReplayPageModel(driveID: 7, dataSource: EmptyTripReplayDataSource())
            )
        }
        .tsUnits(.imperial)
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            TripReplayPage(
                model: TripReplayPageModel(driveID: 7, dataSource: FailingTripReplayDataSource())
            )
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }
#endif
