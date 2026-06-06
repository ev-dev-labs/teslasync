import SwiftUI

/// Root view: an adaptive, HIG-native navigation shell.
///
/// - macOS / iPadOS (regular width): `NavigationSplitView` with a sidebar.
/// - iPhone (compact width): `NavigationStack`.
///
/// The shell is intentionally page-free at P0 — the sidebar destinations,
/// routing graph and deep links are built in P4 (app structure + navigation).
struct ContentView: View {
    var body: some View {
        AdaptiveNavigationShell()
            .teslaSyncTheme()
    }
}

/// Chooses the navigation container that matches the current idiom.
private struct AdaptiveNavigationShell: View {
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    var body: some View {
        #if os(iOS)
            if horizontalSizeClass == .compact {
                NavigationStack {
                    LaunchSurface()
                        .navigationTitle(Text(verbatim: "TeslaSync"))
                }
            } else {
                splitView
            }
        #else
            splitView
        #endif
    }

    private var splitView: some View {
        NavigationSplitView {
            List {
                // Sidebar destinations are populated by P4 (navigation graph).
            }
            .navigationTitle(Text(verbatim: "TeslaSync"))
        } detail: {
            LaunchSurface()
        }
    }
}

/// Branded launch surface for the empty P0 shell.
///
/// A real, app-identity launch view (not a stub): it renders the brand mark
/// centered with adaptive Dynamic Type spacing until the navigation graph and
/// pages land in P4/P7.
private struct LaunchSurface: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "bolt.car.fill")
                .font(.system(size: 56))
                .foregroundStyle(Theme.accent)
                .accessibilityHidden(true)

            Text(verbatim: "TeslaSync")
                .font(.largeTitle.weight(.semibold))
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}

#Preview {
    ContentView()
}
