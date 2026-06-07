import Foundation
import Observation
import Shared

/// App-level dependency container: the composition root that owns shared-core
/// singletons (networking, auth, cache, SSE) and vends native facades + models.
///
/// The concrete shared-core graph (`ApiHttpClient`, repositories, the 114 state
/// holders) is wired in `bootstrap(baseURL:)`. That wiring is the single place
/// that names shared-core constructors, so it is finalized against the built
/// `Shared.xcframework` on the macOS Xcode build (see the prompt log). Everything
/// else in the facade depends only on this container, never on raw KMP symbols.
@MainActor
@Observable
public final class AppContainer {
    /// The user's active display-unit preferences (drives all `Units` formatting).
    public var unitPreferences: UnitPreferences

    public init(unitPreferences: UnitPreferences = .metric) {
        self.unitPreferences = unitPreferences
    }

    /// The app's auth provider once connected (P4/P5). The auth coordinator
    /// implements the `AuthTokenProviding` (bearer header) + `AuthChallengeHandling`
    /// (single-flight 401 refresh) seams; the future `bootstrap(baseURL:)` hands
    /// this to the KMP `ApiHttpClient` and the SSE `LiveConnection` so networking
    /// and live reconnect re-authenticate centrally (ADR-008/ADR-009).
    @ObservationIgnored public private(set) var auth: (any AuthTokenProviding & AuthChallengeHandling)?

    /// Connects the auth coordinator's networking/SSE seams to the container.
    public func connectAuth(_ provider: any AuthTokenProviding & AuthChallengeHandling) {
        auth = provider
    }

    /// Host platform identity from the shared core — also proves the link works.
    public var platformName: String {
        Shared.Platform.shared.name
    }

    /// Wraps any holder `StateFlow` into an `@Observable` model. Domain facades
    /// call this so every screen binds through one consistent adapter.
    public func model<State>(
        from flow: Shared.Kotlinx_coroutines_coreStateFlow,
        transform: @escaping (Any) -> State?
    ) -> StateHolderModel<State> {
        StateHolderModel(flow: flow, transform: transform)
    }

    /// Convenience: project a holder's `StateFlow<Resource<T>>` straight into an
    /// observable `LoadableState` model.
    public func loadable<Value>(
        from flow: Shared.Kotlinx_coroutines_coreStateFlow,
        as _: Value.Type = Value.self,
        map: @escaping (Any) -> Value?
    ) -> StateHolderModel<LoadableState<Value>> {
        StateHolderModel(flow: flow) { raw in
            guard let resource = raw as? Shared.Resource else { return nil }
            return LoadableState.from(resource, transform: map)
        }
    }
}

public extension UnitPreferences {
    /// Metric/SI display defaults (km, km/h, °C, kPa, Wh, h, W).
    static let metric = UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "Wh",
        duration: "h",
        power: "W",
        locale: "en-US"
    )

    /// Imperial display defaults (mi, mph, °F, psi, kWh, min, kW).
    static let imperial = UnitPreferences(
        distance: "mi",
        speed: "mph",
        temperature: "°F",
        pressure: "psi",
        energy: "kWh",
        duration: "min",
        power: "kW",
        locale: "en-US"
    )
}
