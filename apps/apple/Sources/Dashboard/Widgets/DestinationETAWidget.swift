import Shared
import SwiftUI

// MARK: - Widget

/// Native, Apple-idiomatic port of the web `DestinationETAWidget`. Reproduces the
/// compact (1×2) and standard (2×2+) layouts plus the loading, empty, error,
/// stale, and offline states. Registers under the `destination-eta` id.
public struct DestinationETAWidget: View {
    /// Grid footprint passed by the dashboard host (columns × rows).
    public struct Size: Equatable, Sendable {
        public var cols: Int
        public var rows: Int
        public init(cols: Int, rows: Int) {
            self.cols = cols
            self.rows = rows
        }
    }

    /// Canonical registry metadata, matching `registry/maps.ts` `destination-eta`.
    public struct Registry: Sendable {
        public let id = "destination-eta"
        public let category = "maps"
        public let surfaceSlug = "DestinationETAWidget"
        public let titleKeyString = "translation.widget.destinationETA.title"
        public let defaultSize = Size(cols: 2, rows: 2)
        public let minSize = Size(cols: 1, rows: 2)
        public let maxSize = Size(cols: 3, rows: 40)

        /// Localized display title (the registry name), resolved at the render boundary.
        public var titleKey: LocalizedStringKey {
            LocalizedStringKey(titleKeyString)
        }

        /// Clamps a requested footprint to the registry min/max bounds.
        public func clamp(_ size: Size) -> Size {
            Size(
                cols: min(max(size.cols, minSize.cols), maxSize.cols),
                rows: min(max(size.rows, minSize.rows), maxSize.rows)
            )
        }
    }

    public static let registry = Registry()

    @State private var model: DestinationETAWidgetModel
    private let size: Size

    /// Production initializer — binds the shared `VehiclesStore`.
    public init(
        store: VehiclesStore,
        vehicleID: Int64?,
        size: Size,
        unitPreferences: UnitPreferences,
        diagnostics: DestinationETADiagnostics = NoopDestinationETADiagnostics()
    ) {
        _model = State(
            initialValue: DestinationETAWidgetModel(
                store: store,
                vehicleID: vehicleID,
                unitPreferences: unitPreferences,
                diagnostics: diagnostics
            )
        )
        self.size = size
    }

    /// Model-injection initializer for previews, the host, and tests.
    public init(model: DestinationETAWidgetModel, size: Size) {
        _model = State(initialValue: model)
        self.size = size
    }

    private var isCompact: Bool {
        size.cols <= 1
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .task { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: model.freshness) { _, freshness in
                if freshness == .stale { model.refresh() }
            }
    }

    @ViewBuilder
    private var content: some View {
        if model.isInitialLoading {
            loadingChrome
        } else if let error = model.blockingError {
            DestinationETAErrorView(error: error, onRetry: { model.refresh() })
        } else if isCompact {
            compactLayout
        } else {
            standardLayout
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact {
                TSSkeleton(width: 120, height: 10)
            }
            Spacer(minLength: 0)
            TSSkeleton(width: 90, height: 28)
            TSSkeleton(height: 8)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement()
        .accessibilityLabel(Text("translation.widget.destinationETA.title"))
        .accessibilityValue(Text("widget.freshness.live"))
    }

    private var compactLayout: some View {
        DestinationETAShell(
            title: nil,
            freshness: model.freshness,
            onRefresh: { model.refresh() },
            content: {
                if let viewState = model.viewState {
                    if viewState.isNavigating {
                        DestinationETABigCountdown(minutes: viewState.roundedMinutes)
                    } else {
                        DestinationETALocationBadge(location: viewState.location, prominent: false)
                    }
                } else {
                    DestinationETAEmptyView(compact: true)
                }
            }
        )
    }

    private var standardLayout: some View {
        DestinationETAShell(
            title: "translation.widget.destinationETA.title",
            freshness: model.freshness,
            onRefresh: { model.refresh() },
            content: {
                if let viewState = model.viewState {
                    if viewState.isNavigating {
                        DestinationETANavigatingView(
                            viewState: viewState,
                            distance: model.displayDistance(meters: viewState.metersToArrival),
                            distanceUnit: model.unitPreferences.distance
                        )
                    } else {
                        DestinationETAIdleView(location: viewState.location)
                    }
                } else {
                    DestinationETAEmptyView(compact: false)
                }
            }
        )
    }
}

// MARK: - Previews

#if DEBUG
    fileprivate extension DestinationETASnapshot {
        static let previewNavigating = DestinationETASnapshot(
            destinationName: "Tesla Supercharger — Mountain View",
            metersToArrival: 18400,
            minutesToArrival: 23
        )

        static let previewAtHome = DestinationETASnapshot(
            destinationName: nil,
            metersToArrival: 0,
            minutesToArrival: 0,
            locatedAtHome: true
        )
    }

    fileprivate extension View {
        func destinationETAPreviewChrome(width: CGFloat, height: CGFloat) -> some View {
            frame(width: width, height: height)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg))
                .padding()
                .teslaSyncTheme()
        }
    }

    @MainActor
    private func destinationETAPreview(_ state: LoadableState<DestinationETASnapshot>, cols: Int) -> some View {
        DestinationETAWidget(
            model: DestinationETAWidgetModel(state: state, unitPreferences: .metric),
            size: .init(cols: cols, rows: 2)
        )
        .destinationETAPreviewChrome(width: cols <= 1 ? 130 : 240, height: cols <= 1 ? 200 : 220)
    }

    #Preview("Standard — navigating") {
        destinationETAPreview(.loaded(.previewNavigating, stale: false), cols: 2)
    }

    #Preview("Standard — idle at home") {
        destinationETAPreview(.loaded(.previewAtHome, stale: false), cols: 2)
    }

    #Preview("Standard — stale") {
        destinationETAPreview(.loaded(.previewNavigating, stale: true), cols: 2)
    }

    #Preview("Standard — offline (cached)") {
        destinationETAPreview(.failed(.offline, cached: .previewNavigating, stale: true), cols: 2)
    }

    #Preview("Standard — empty") {
        destinationETAPreview(.empty(stale: false), cols: 2)
    }

    #Preview("Standard — error") {
        destinationETAPreview(.failed(.api(status: 500, code: nil, body: nil), cached: nil, stale: false), cols: 2)
    }

    #Preview("Standard — loading") {
        destinationETAPreview(.loading(cached: nil, stale: false), cols: 2)
    }

    #Preview("Compact — countdown") {
        destinationETAPreview(.loaded(.previewNavigating, stale: false), cols: 1)
    }

    #Preview("Compact — location") {
        destinationETAPreview(.loaded(.previewAtHome, stale: false), cols: 1)
    }
#endif
