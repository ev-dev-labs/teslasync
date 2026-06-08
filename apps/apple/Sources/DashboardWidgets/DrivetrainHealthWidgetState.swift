import Observation
import os

// MARK: - View state + data seam

/// Cache-then-network state the view switches over (ADR-013). Mirrors the facade
/// `LoadableState` semantics (cached value stays visible behind a refresh) while
/// staying Shared-free so the surface host-compiles and host-tests in isolation.
public enum DrivetrainHealthViewState: Equatable {
    case loading(cached: DrivetrainHealthProjection?)
    case loaded(DrivetrainHealthProjection, freshness: WidgetFreshness)
    case empty(freshness: WidgetFreshness)
    case failed(message: String?, cached: DrivetrainHealthProjection?)
}

/// The data seam: the view binds to an injected provider (a state holder), never
/// to HTTP. Production wiring adapts the shared KMP `DrivingStore` /
/// `VehiclesStore` feeds; previews and tests inject a controlled provider.
@MainActor
public protocol DrivetrainHealthProvider: AnyObject {
    func start(onState: @escaping (DrivetrainHealthViewState) -> Void)
    func stop()
    func refresh()
}

/// `@Observable` model the SwiftUI view renders. It owns no networking — it simply
/// republishes whatever its injected provider emits, on the main actor.
@MainActor
@Observable
public final class DrivetrainHealthWidgetModel {
    public private(set) var state: DrivetrainHealthViewState

    @ObservationIgnored private let provider: DrivetrainHealthProvider

    public init(
        provider: DrivetrainHealthProvider,
        initialState: DrivetrainHealthViewState = .loading(cached: nil)
    ) {
        self.provider = provider
        state = initialState
    }

    public func start() {
        provider.start { [weak self] newState in
            self?.state = newState
        }
    }

    public func stop() {
        provider.stop()
    }

    public func refresh() {
        provider.refresh()
    }
}

// MARK: - Diagnostics

/// Diagnostics seam for the P1/S11 `view.opened` contract.
@MainActor
public protocol DashboardWidgetTelemetry: AnyObject {
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` os_log event. The surface
/// slug is a static, non-identifying constant logged verbatim; no payload, VIN,
/// or location is ever recorded.
@MainActor
public final class OSLogDashboardWidgetTelemetry: DashboardWidgetTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Freshness presentation

/// Presentation attributes for a freshness chip — derived from the reusable
/// `WidgetFreshness` so the dashboard surface matches the WidgetKit honesty model.
struct DrivetrainFreshnessInfo: Equatable {
    let iconName: String
    let labelKey: String
    let tone: TSTone
}

enum DrivetrainHealthFreshness {
    static func info(for freshness: WidgetFreshness) -> DrivetrainFreshnessInfo {
        switch freshness {
        case .fresh:
            DrivetrainFreshnessInfo(iconName: "clock", labelKey: "widget.freshness.live", tone: .success)
        case .stale:
            DrivetrainFreshnessInfo(
                iconName: "clock.badge.exclamationmark",
                labelKey: "widget.freshness.stale",
                tone: .warning
            )
        case .offline:
            DrivetrainFreshnessInfo(iconName: "wifi.slash", labelKey: "widget.freshness.offline", tone: .neutral)
        }
    }
}
