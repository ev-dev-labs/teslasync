import Foundation
import Observation

// Native SwiftUI page model for the standalone, deep-linkable `ConflictWarnings` screen — the
// parity of `web/src/features/automations/pages/ConflictWarnings.tsx`. The web source is an
// unrouted presentational leaf the automation builder renders inline (and renders `null` when the
// conflict list is empty). The canonical, fully-stated native surface already ships as the P4
// feature view `ConflictWarnings` (+ `ConflictWarningsModel`, the `ConflictWarningsSource` S8 seam,
// the severity→banner projection, and every loading / empty / error / stale / offline state). This
// P7 PAGE unit hosts that surface unchanged (DRY — no second copy) inside an adaptive navigable
// scaffold, owning the surface model so the screen has a single stable state holder. No networking
// lives here (ADR-004).

// MARK: - Page model

/// The page's state holder. Owns the reused feature-view `ConflictWarningsModel` (`surface`),
/// built over an injectable `ConflictWarningsSource` (default = representative local conflicts, the
/// navigation/local-state values the web parent would pass). The page renders `surface` through the
/// shared `ConflictWarnings` view; `load()` / `refresh()` drive the underlying conflict-detection
/// query (mount + error-state retry / pull-to-refresh).
@MainActor
@Observable
public final class ConflictWarningsPageModel {
    /// The reused P4 feature-view surface model the page renders via `ConflictWarnings(model:)`.
    /// It owns the conflicts / empty / error / loading render branches and the stale/offline chrome.
    public let surface: ConflictWarningsModel

    public init(source: any ConflictWarningsSource = ConflictWarningsPageModel.defaultSource()) {
        surface = ConflictWarningsModel(source: source)
    }

    /// The representative local-state source for the standalone screen — two conflicts (one
    /// `warning`, one `info`) mirroring the feature-view previews, so the navigable page shows the
    /// banner list without networking.
    public static func defaultSource() -> any ConflictWarningsSource {
        InMemoryConflictWarningsSource(
            initial: ConflictWarningsInput(
                phase: .loaded([
                    AutomationConflict(
                        automationId: 12,
                        automationName: "Morning Charge",
                        reason: "Overlaps with Nightly Precondition on weekday mornings at 06:00",
                        severity: .warning
                    ),
                    AutomationConflict(
                        automationId: 34,
                        automationName: "Arrive Home Climate",
                        reason: "Shares the geofence trigger with Garage Lights",
                        severity: .info
                    )
                ])
            )
        )
    }

    /// Begins the underlying conflict-detection query (web parent mount). Idempotent — the hosted
    /// `ConflictWarnings` view also starts the surface on appear; this is the explicit page entry.
    public func load() {
        surface.start()
    }

    /// Re-requests the conflict-detection query (error-state retry / pull-to-refresh).
    public func refresh() {
        surface.refresh()
    }
}
