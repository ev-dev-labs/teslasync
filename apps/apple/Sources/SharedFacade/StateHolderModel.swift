import Foundation
import Observation
import Shared

/// Generic, `@Observable` adapter that republishes a Kotlin `StateFlow` into
/// SwiftUI on the main actor.
///
/// This is the single mechanism every one of the shared core's ~114 state
/// holders binds through: a view model owns a `StateHolderModel`, points it at a
/// holder's `StateFlow`, and renders `state`. All UI-affecting mutations happen
/// on `@MainActor`; cancelling (or `stop()`) closes the upstream collector.
@MainActor
@Observable
public final class StateHolderModel<State> {
    /// The latest projected state, or `nil` before the first emission.
    public private(set) var state: State?

    @ObservationIgnored private let flow: Shared.Kotlinx_coroutines_coreStateFlow
    @ObservationIgnored private let transform: (Any) -> State?
    @ObservationIgnored private var task: Task<Void, Never>?

    /// - Parameters:
    ///   - flow: the holder's `StateFlow` (already constructed by the container).
    ///   - transform: maps each raw Kotlin snapshot to `State` (`nil` is ignored).
    public init(
        flow: Shared.Kotlinx_coroutines_coreStateFlow,
        transform: @escaping (Any) -> State?
    ) {
        self.flow = flow
        self.transform = transform
        if let initial = flow.value {
            state = transform(initial)
        }
    }

    /// Begins collecting. Idempotent: a second call while running is a no-op.
    public func start() {
        guard task == nil else { return }
        task = Task { [weak self, flow, transform] in
            do {
                for try await value in FlowBridge.stream(from: flow) {
                    if Task.isCancelled { break }
                    guard let mapped = transform(value) else { continue }
                    self?.state = mapped
                }
            } catch {
                // A `StateFlow` never completes or fails; this guards the throwing
                // bridge signature. Terminal errors simply stop the subscription.
            }
        }
    }

    /// Stops collecting and closes the upstream subscription.
    public func stop() {
        task?.cancel()
        task = nil
    }
}
