import SwiftUI

/// Navigation registration for the **unrouted** `ConflictWarnings` parity unit.
///
/// The web source is `(unrouted)` — a section the automation builder renders inline, not a
/// standalone route. So rather than claim a top-level `AppRoute`, this exposes the screen as a
/// typed `NavigationDestination` (a deep-link value) any `NavigationStack`/`NavigationSplitView`
/// can host: a builder/automations route adopts `.conflictWarningsDestination()` and pushes a
/// `ConflictWarningsLink` to surface the full-screen conflict list. The `make(source:)` factory
/// lets a production host inject its conflict-detection query source (default = representative local
/// state), keeping the destination closure free of business logic — the seam shape the sibling
/// unrouted pages use.
public struct ConflictWarningsLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers the `ConflictWarnings` screen as a `NavigationDestination` for a
    /// `ConflictWarningsLink` value, so any host stack can deep-link into it (default local source).
    func conflictWarningsDestination() -> some View {
        navigationDestination(for: ConflictWarningsLink.self) { _ in
            ConflictWarningsPage()
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column) — optionally over a custom conflict source.
public enum ConflictWarningsRouteRegistration {
    /// Builds the screen, optionally over a custom conflict-detection source (default = local state).
    @MainActor
    public static func make(
        source: any ConflictWarningsSource = ConflictWarningsPageModel.defaultSource()
    ) -> ConflictWarningsPage {
        ConflictWarningsPage(model: ConflictWarningsPageModel(source: source))
    }
}
