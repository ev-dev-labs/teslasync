import SwiftUI

/// Native SwiftUI parity of `web/src/features/sharing/pages/SharingTripsPage.tsx` (route
/// `/sharing/trips`). The page surfaces recent trips eligible for sharing, the static share-card
/// hint, and the propose-only AI share-card image-prompt drafter. It reproduces every region of the
/// web page, binding through the `@Observable` `SharingTripsPageModel` (ADR-004 — no networking in
/// the view):
///   1. GlassPanel1 — the recent-trips selector with the web `loading` / `empty` / `success` states.
///   2. GlassPanel2 — the static share-card hint (the AI-off baseline publishing path).
///   3. The AI section — the existing `AITripPostcardShareCardImageGeneration` surface, fed the
///      selected trip id (web `<AITripPostcardShareCardImageGeneration tripId={selectedTripId} />`).
///
/// Adaptive across macOS / iPad (regular) and iPhone (compact) via the P2 tokens + P3 components;
/// every value formats at the render boundary through `Units` (SI in, display out — ADR-005); every
/// literal resolves from `Localizable.xcstrings` with the web key names.
public struct SharingTripsPage: View {
    @State private var model: SharingTripsPageModel

    public init(model: SharingTripsPageModel) {
        _model = State(initialValue: model)
    }

    public init(
        vehicleID: Int64? = nil,
        dataSource: any SharingTripsDataSource = SampleSharingTripsDataSource()
    ) {
        _model = State(initialValue: SharingTripsPageModel(vehicleID: vehicleID, dataSource: dataSource))
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                subtitle
                recentTripsPanel
                staticHintPanel
                aiSection
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 920, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(SharingTripsStrings.title))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.state else { return }
                await model.load()
            }
    }

    /// Web `PageContainer subtitle`: "Pick a recent trip to share …".
    private var subtitle: some View {
        Text(SharingTripsStrings.subtitle)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - GlassPanel1 — Recent trips (web first FadeIn block)

    private var recentTripsPanel: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSPanelTitle(SharingTripsStrings.recentHeading)
                    recentTripsContent
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    /// The web `isLoading ? skeletons : empty ? EmptyState : list` branch (plus a robust retryable
    /// error region so the panel is never blank — ADR-011).
    @ViewBuilder
    private var recentTripsContent: some View {
        switch model.state {
        case .loading:
            loadingRows
        case let .error(message):
            errorView(message)
        case .ready:
            if model.hasTrips {
                tripList
            } else {
                emptyState
            }
        }
    }

    /// Web loading state: three `Skeleton` rows (`h-16 rounded-xl`).
    private var loadingRows: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 64, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(Text("loading"))
    }

    /// Web empty state: a route glyph + "No recent trips …" (trips populate automatically — no
    /// manual action, so no action button, matching the web `EmptyState`).
    private var emptyState: some View {
        TSEmptyState(
            title: SharingTripsStrings.recentEmpty,
            systemImage: "point.topleft.down.to.point.bottomright.curvepath"
        )
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    /// Web success state: the selectable recent-trips list (`role="listbox"`).
    private var tripList: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(model.trips) { trip in
                SharingTripsRow(
                    trip: trip,
                    isSelected: model.selectedTripID == trip.id,
                    onSelect: { model.select(tripID: trip.id) }
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(SharingTripsStrings.recentHeading))
    }

    /// Retryable failure of the trips fetch with the HIG retry affordance (ADR-011).
    private func errorView(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - GlassPanel2 — Static share-card hint (web second FadeIn block)

    private var staticHintPanel: some View {
        TSFadeIn(delay: 0.1) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSPanelTitle(SharingTripsStrings.staticHintHeading)
                    Text(SharingTripsStrings.staticHintBody)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - AI section (web third FadeIn block)

    /// The propose-only Helix share-card image-prompt drafter, fed the selected trip id — the exact
    /// composition the web page performs (`<AITripPostcardShareCardImageGeneration tripId={…} />`).
    /// The shared surface owns the AI feature-gate + its own data states; the page only supplies the
    /// selected trip (web `selectedTripId`).
    private var aiSection: some View {
        TSFadeIn(delay: 0.15) {
            AITripPostcardShareCardImageGeneration(tripID: model.selectedTripID.map(Int.init))
        }
    }
}

// MARK: - Recent-trips row (web `<button role="option">`)

/// One selectable trip in the recent-trips list (web list `<button role="option">`). Shows the trip
/// name (or the `Trip #{id}` fallback), the date / duration / drive-count inline metrics, and the
/// SI-converted distance + verbatim-Wh energy. Selecting it drives the AI card's input; the selected
/// row carries the cyan accent treatment + the VoiceOver `isSelected` trait.
struct SharingTripsRow: View {
    let trip: SharingTrip
    let isSelected: Bool
    let onSelect: () -> Void

    @Environment(\.tsUnits) private var units

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                avatar
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: title)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    metricsRow
                }
                Spacer(minLength: TSSpacing.sm)
                trailingMetrics
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .overlay(rowBorder)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var title: String {
        trip.name ?? SharingTripsStrings.rowTrip(id: trip.id)
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(Color.TS.accent.opacity(0.12))
            Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
        }
        .frame(width: 36, height: 36)
        .accessibilityHidden(true)
    }

    private var metricsRow: some View {
        HStack(spacing: TSSpacing.md) {
            inlineMetric(systemImage: "calendar", text: SharingTripsFormat.date(trip.startDate))
            inlineMetric(
                systemImage: "clock",
                text: SharingTripsFormat.duration(start: trip.startDate, end: trip.endDate)
            )
            Text(verbatim: SharingTripsStrings.rowDrives(count: trip.driveCount))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var trailingMetrics: some View {
        HStack(alignment: .center, spacing: TSSpacing.lg) {
            valueChip(
                systemImage: "mappin",
                value: SharingTripsFormat.distance(meters: trip.totalDistanceM, units: units),
                iconTint: Color.TS.accent,
                valueTint: Color.TS.textPrimary
            )
            valueChip(
                systemImage: "bolt.fill",
                value: SharingTripsFormat.energy(wattHours: trip.totalEnergyWh, units: units),
                iconTint: Color.TS.statusWarning,
                valueTint: Color.TS.statusWarning
            )
        }
    }

    private func inlineMetric(systemImage: String, text: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.system(size: 10)).foregroundStyle(Color.TS.textMuted)
            Text(verbatim: text).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
    }

    private func valueChip(systemImage: String, value: String, iconTint: Color, valueTint: Color) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.system(size: 11)).foregroundStyle(iconTint)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(valueTint)
        }
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(isSelected ? Color.TS.accent.opacity(0.10) : Color.TS.surfaceGlass)
    }

    private var rowBorder: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(isSelected ? Color.TS.accent.opacity(0.6) : Color.TS.border, lineWidth: 1)
    }
}
