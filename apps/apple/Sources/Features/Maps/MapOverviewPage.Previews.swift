#if DEBUG
    import SwiftUI

    // Xcode previews for every Map Overview data state — the populated success seed, the
    // empty-panels seed (no fix yet), the no-vehicle page empty, and the retryable error.

    #Preview("Success") {
        NavigationStack {
            MapOverviewPage(model: MapOverviewPageModel())
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("Empty panels") {
        NavigationStack {
            MapOverviewPage(model: MapOverviewPageModel(dataSource: EmptyMapOverviewDataSource()))
        }
        .tsUnits(.imperial)
        .teslaSyncTheme()
    }

    #Preview("No vehicle") {
        NavigationStack {
            MapOverviewPage(model: MapOverviewPageModel(dataSource: NoVehiclesMapOverviewDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            MapOverviewPage(model: MapOverviewPageModel(dataSource: FailingMapOverviewDataSource()))
        }
        .teslaSyncTheme()
    }
#endif
