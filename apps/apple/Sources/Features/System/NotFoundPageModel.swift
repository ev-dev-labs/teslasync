import Foundation
import Observation

/// Native SwiftUI model for `NotFoundPage` — parity of
/// `web/src/features/system/pages/NotFoundPage.tsx` (catch-all 404 route `/*`).
///
/// Unlike the web version which uses React Router's location state + Levenshtein
/// route matching, this native model receives the unmatched path as an initializer
/// parameter. The model is intentionally minimal: no async loading (the page is
/// fully static), no error states (this **is** the error state), just navigation
/// actions and optional route suggestions for future enhancement.
@Observable
public final class NotFoundPageModel {
    /// The unmatched path that triggered this 404 page (e.g., "/unknown/route").
    public let currentPath: String

    /// Optional list of suggested routes based on closest string match.
    /// For now, this is empty in the native implementation; future enhancement
    /// could port the web's `closestRoutes()` Levenshtein logic + ROUTE_REGISTRY.
    public let suggestions: [RouteSuggestion]

    /// Callback to navigate back in the navigation stack (web: `window.history.back()`).
    public var onGoBack: (() -> Void)?

    /// Callback to navigate to the home/dashboard screen (web: `navigate('/')`).
    public var onGoHome: (() -> Void)?

    /// Callback to open the command palette (web: `toggle-command-palette` event).
    /// This may not have a 1:1 native equivalent; can be omitted if unsupported.
    public var onOpenSearch: (() -> Void)?

    /// Initializes the NotFoundPage model with the unmatched path.
    ///
    /// - Parameters:
    ///   - currentPath: The route that did not match any known destination.
    ///   - suggestions: Optional list of suggested alternative routes.
    public init(
        currentPath: String,
        suggestions: [RouteSuggestion] = []
    ) {
        self.currentPath = currentPath
        self.suggestions = suggestions
    }

    /// Executes the "go back" action (delegates to caller-provided closure).
    public func goBack() {
        onGoBack?()
    }

    /// Executes the "go home" action (delegates to caller-provided closure).
    public func goHome() {
        onGoHome?()
    }

    /// Executes the "open search" action (delegates to caller-provided closure).
    public func openSearch() {
        onOpenSearch?()
    }
}

/// Represents a suggested route alternative (web: `closestRoutes()` result).
public struct RouteSuggestion: Identifiable {
    public let id: String
    public let path: String
    public let label: String
    public let i18nKey: String

    public init(id: String, path: String, label: String, i18nKey: String) {
        self.id = id
        self.path = path
        self.label = label
        self.i18nKey = i18nKey
    }
}
