import SwiftUI

/// Registers the native SQL Playground surface for the `.powerSql` route so the app shell's route
/// host renders it (web `/power/sql`). Mirrors the sibling `*RouteRegistration` enums: the
/// `@Observable` model is built on the main actor here and captured, so the escaping registry
/// closure never constructs an isolated type.
///
/// `AppRouteParser` aliases `/power/sql` → `.powerSql`, keeping the page reachable + deep-linkable
/// and surfacing it in the System (power-user tools) sidebar group.
public enum SqlPlaygroundRouteRegistration {
    @MainActor
    public static func registry(base: AppRouteHostRegistry = AppRouteHostRegistry()) -> AppRouteHostRegistry {
        var registry = base
        let model = SqlPlaygroundPageModel()
        registry.register(.powerSql) {
            SqlPlaygroundPage(model: model)
        }
        return registry
    }
}
