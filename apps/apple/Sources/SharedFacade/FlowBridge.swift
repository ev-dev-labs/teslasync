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
/// > `Shared.Kotlinx_coroutines_coreFlow` / `…FlowCollector`. Names inferred from
/// > the framework convention; pinned on the macOS build.
public enum FlowBridge {
    /// Streams the raw (type-erased) elements emitted by a Kotlin flow.
    public static func stream(
        from flow: Shared.Kotlinx_coroutines_coreFlow
    ) -> AsyncThrowingStream<Any, Swift.Error> {
        let flowBox = UncheckedSendable(flow)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let collector = YieldingCollector { value in
                        // Kotlin emits an immutable DTO and retains no mutable
                        // reference past `emit`, so handing it to the consumer is race-free.
                        nonisolated(unsafe) let element = value
                        continuation.yield(element)
                    }
                    try await flowBox.value.collect(collector: collector)
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
        from flow: Shared.Kotlinx_coroutines_coreFlow,
        as _: Element.Type = Element.self
    ) -> AsyncThrowingStream<Element, Swift.Error> {
        let raw = stream(from: flow)
        let rawBox = UncheckedSendable(raw)
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await value in rawBox.value {
                        if let typed = value as? Element {
                            nonisolated(unsafe) let element = typed
                            continuation.yield(element)
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

/// Boxes a non-`Sendable` Kotlin handle so the bridging `Task` closure can capture
/// it. Sound because the flow is collected by exactly one task and never mutated.
private struct UncheckedSendable<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) {
        self.value = value
    }
}

/// `FlowCollector` adapter that forwards each emitted value to a closure.
private final class YieldingCollector: NSObject, Shared.Kotlinx_coroutines_coreFlowCollector {
    private let onEach: (Any) -> Void

    init(onEach: @escaping (Any) -> Void) {
        self.onEach = onEach
    }

    func emit(value: Any?, completionHandler: @escaping (Swift.Error?) -> Void) {
        if let value {
            onEach(value)
        }
        completionHandler(nil)
    }
}
