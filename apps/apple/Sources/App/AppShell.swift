import SwiftUI

/// The adaptive app shell + route registry host. macOS/iPadOS use a searchable
/// `NavigationSplitView` sidebar + detail; compact iPhone uses a `TabView` with a
/// "More" stack. One `AppRoute` selection drives both idioms, the command palette,
/// recents, and a VoiceOver route announcer.
public struct AppShell: View {
    @Binding private var selection: AppRoute?
    @State private var searchText = ""
    @State private var recents: [AppRoute] = []
    @State private var showsCommandPalette = false

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var isCompact: Bool {
            false
        }
    #endif

    public init(selection: Binding<AppRoute?>) {
        _selection = selection
    }

    public var body: some View {
        Group {
            if isCompact { tabShell } else { splitShell }
        }
        .sheet(isPresented: $showsCommandPalette) {
            TSCommandPalette(commands: paletteCommands, isPresented: $showsCommandPalette)
        }
    }

    // MARK: macOS / iPad split shell

    private var splitShell: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(AppRouteGroup.allCases) { group in
                    let routes = AppRoute.routes(in: group).filter(matchesSearch)
                    if !routes.isEmpty {
                        Section(header: Text(group.titleKey)) {
                            ForEach(routes) { route in
                                Label(route.titleKey, systemImage: route.systemImage).tag(route)
                            }
                        }
                    }
                }
            }
            .navigationTitle(Text(verbatim: "TeslaSync"))
            .searchable(text: $searchText)
        } detail: {
            NavigationStack {
                RouteHost(route: selection)
                    .toolbar { commandPaletteToolbarItem }
            }
        }
        .onChange(of: selection) { _, newValue in handle(newValue) }
    }

    // MARK: iPhone tab shell

    private var tabShell: some View {
        TabView {
            ForEach(AppRoute.primaryTabs) { route in
                NavigationStack {
                    RouteHost(route: route)
                        .toolbar { commandPaletteToolbarItem }
                }
                .tabItem { Label(route.titleKey, systemImage: route.systemImage) }
            }
            NavigationStack {
                moreList
            }
            .tabItem { Label("tab.more", systemImage: "ellipsis.circle") }
        }
    }

    private var moreList: some View {
        List {
            ForEach(AppRouteGroup.allCases) { group in
                let routes = AppRoute.routes(in: group).filter { !AppRoute.primaryTabs.contains($0) }
                if !routes.isEmpty {
                    Section(header: Text(group.titleKey)) {
                        ForEach(routes) { route in
                            NavigationLink {
                                RouteHost(route: route)
                            } label: {
                                Label(route.titleKey, systemImage: route.systemImage)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("tab.more")
    }

    private var commandPaletteToolbarItem: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { showsCommandPalette = true } label: {
                Image(systemName: "command")
            }
            .keyboardShortcut("k", modifiers: .command)
            .accessibilityLabel(Text("command.palette"))
        }
    }

    // MARK: behavior

    private func matchesSearch(_ route: AppRoute) -> Bool {
        searchText.isEmpty || route.rawValue.lowercased().contains(searchText.lowercased())
    }

    private func handle(_ route: AppRoute?) {
        guard let route else { return }
        recents.removeAll { $0 == route }
        recents.insert(route, at: 0)
        if recents.count > 5 { recents.removeLast() }
        let message = String(localized: String.LocalizationValue("route." + route.rawValue))
        AccessibilityNotification.Announcement(message).post()
    }

    private var paletteCommands: [TSCommand] {
        AppRoute.allCases.map { route in
            TSCommand(
                id: route.id,
                title: route.titleKey,
                searchText: route.rawValue,
                systemImage: route.systemImage
            ) {
                selection = route
            }
        }
    }
}

/// Renders the page registered for a route, or a pending state until P7 registers it.
private struct RouteHost: View {
    let route: AppRoute?
    @Environment(\.routeHosts) private var routeHosts

    var body: some View {
        content
            .navigationTitle(route?.titleKey ?? "route.none")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    @ViewBuilder
    private var content: some View {
        if let route {
            if let page = routeHosts.view(for: route) {
                page
            } else {
                TSEmptyState(
                    title: route.titleKey,
                    message: "route.pagePending",
                    systemImage: route.systemImage
                )
            }
        } else {
            TSEmptyState(title: "route.selectPrompt", systemImage: "sidebar.left")
        }
    }
}
