import Foundation
import Shared

/// Native, value-typed projection of the shared core's cache-then-network
/// `Resource<T>` (`io.teslasync.shared.core.data.repo.Resource`).
///
/// SwiftUI views switch over this to render loading / loaded / empty / error
/// while still honoring the `stale` flag (ADR-013) and any `cached` value that
/// should stay visible behind a refresh.
public enum LoadableState<Value> {
    /// No load has been requested yet.
    case idle
    /// A load is in flight; `cached` is the last value to keep on screen, if any.
    case loading(cached: Value?, stale: Bool)
    /// A value is available.
    case loaded(Value, stale: Bool)
    /// The load succeeded but produced no content (e.g. an empty collection).
    case empty(stale: Bool)
    /// The load failed; `cached` is the last value to keep on screen, if any.
    case failed(FacadeError, cached: Value?, stale: Bool)

    /// The most recent value to display, whether fresh, cached, or absent.
    public var value: Value? {
        switch self {
        case .idle, .empty:
            nil
        case let .loading(cached, _):
            cached
        case let .loaded(value, _):
            value
        case let .failed(_, cached, _):
            cached
        }
    }

    /// Whether a spinner should be shown (in flight with nothing to display yet).
    public var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    /// Whether the displayed value is older than the freshness window.
    public var isStale: Bool {
        switch self {
        case .idle:
            false
        case let .loading(_, stale), let .loaded(_, stale),
             let .empty(stale), let .failed(_, _, stale):
            stale
        }
    }

    /// The error, when the state is a failure.
    public var error: FacadeError? {
        if case let .failed(error, _, _) = self { return error }
        return nil
    }
}

public extension LoadableState {
    /// Projects a KMP `Resource<T>` into a `LoadableState`.
    ///
    /// - Parameters:
    ///   - resource: the shared-core resource (generics are erased across the
    ///     Obj-C boundary, so the raw payload is handed to `transform`).
    ///   - transform: maps the raw Kotlin payload to `Value` (returning `nil`
    ///     marks the state empty).
    static func from(
        _ resource: Shared.Resource,
        transform: (Any) -> Value?
    ) -> LoadableState {
        let stale = resource.stale
        switch resource {
        case let success as Shared.ResourceSuccess<AnyObject>:
            if let mapped = transform(success.data) {
                return .loaded(mapped, stale: stale)
            }
            return .empty(stale: stale)
        case let loading as Shared.ResourceLoading<AnyObject>:
            return .loading(cached: loading.cached.flatMap(transform), stale: stale)
        case let failure as Shared.ResourceError<AnyObject>:
            return .failed(
                FacadeError.from(failure.error),
                cached: failure.cached.flatMap(transform),
                stale: stale
            )
        default:
            return .idle
        }
    }
}
