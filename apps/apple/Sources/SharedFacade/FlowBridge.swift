import Foundation
import Shared

/// Bridges a Kotlin `Flow` / `StateFlow` into a Swift `AsyncThrowingStream`.
///
/// Kotlin/Native exposes a suspend `collect(collector:)` on `Flow`; collecting
/// inside a Swift `Task` means cancelling that task cancels the upstream Kotlin
/// coroutine. `onTermination` cancels the task when the consumer stops iterating
/// (e.g. the SwiftUI view disappears), so upstream collectors are always closed.
///
/// > KMP interop note: `Flow` / `FlowCollector` map to
/// > `SharedKotlinx_coroutines_coreFlow` / `…FlowCollector`. Names inferred from
/// > the framework convention; pinned on the macOS build.
public enum FlowBridge {
    /// Streams the raw (type-erased) elements emitted by a Kotlin flow.
    public static func stream(
        from flow: SharedKotlinx_coroutines_coreFlow
    ) -> AsyncThrowingStream<Any, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let collector = YieldingCollector { continuation.yield($0) }
                    try await flow.collect(collector: collector)
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: FacadeError.from(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Streams elements cast to `Element`, dropping any that do not match.
    public static func stream<Element>(
        from flow: SharedKotlinx_coroutines_coreFlow,
        as _: Element.Type = Element.self
    ) -> AsyncThrowingStream<Element, Error> {
        let raw = stream(from: flow)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await value in raw {
                        if let typed = value as? Element {
                            continuation.yield(typed)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// `FlowCollector` adapter that forwards each emitted value to a closure.
private final class YieldingCollector: NSObject, SharedKotlinx_coroutines_coreFlowCollector {
    private let onEach: (Any) -> Void

    init(onEach: @escaping (Any) -> Void) {
        self.onEach = onEach
    }

    func emit(value: Any?, completionHandler: @escaping (Error?) -> Void) {
        if let value {
            onEach(value)
        }
        completionHandler(nil)
    }
}
