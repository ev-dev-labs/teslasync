import Foundation
import Shared

/// Native Swift error taxonomy for everything thrown across the KMP facade.
///
/// Mirrors the shared core's `ApiError` (`io.teslasync.shared.core.net.ApiError`)
/// plus the facade-only `auth` / `offline` / `cancelled` cases the spec requires,
/// so SwiftUI features branch on one Swift `Error` instead of raw Kotlin types.
///
/// > KMP interop note: Kotlin/Native exports the framework's types with the
/// > framework-name prefix, so `ApiError.Http` is `Shared.ApiError.Http` in Swift.
/// > These symbol names are inferred from the Kotlin source; they are pinned on
/// > the macOS Xcode build (see logs/p4-p1-0001-shared-facade.log).
public enum FacadeError: Swift.Error, Equatable, Sendable {
    /// Transport failure before any HTTP response was produced.
    case network(message: String)
    /// The request exceeded the client's configured timeout.
    case timeout(message: String)
    /// A non-2xx HTTP response (status + optional machine code + raw body).
    case api(status: Int, code: String?, body: String?)
    /// A 2xx response whose body could not be decoded into the expected type.
    case decode(message: String)
    /// The circuit breaker is open; the call was fast-failed.
    case circuitOpen
    /// Authentication is required or refresh failed (mapped from a 401 envelope).
    case auth(message: String)
    /// The device is offline and no cached value is available.
    case offline
    /// The surrounding Swift `Task` was cancelled; upstream work was torn down.
    case cancelled
    /// Any failure that did not match a known shape.
    case unknown(message: String)

    /// Whether retrying the operation could plausibly succeed.
    public var isRetryable: Bool {
        switch self {
        case .network, .timeout, .circuitOpen, .offline:
            true
        case let .api(status, _, _):
            status >= 500 || status == 429
        case .decode, .auth, .cancelled, .unknown:
            false
        }
    }
}

public extension FacadeError {
    /// Maps any error surfaced from the KMP framework into a `FacadeError`.
    ///
    /// Handles both direct bridging (`error as? Shared.ApiError`) and the
    /// `NSError.userInfo["KotlinException"]` wrapping Kotlin/Native uses for
    /// `@Throws` suspend functions.
    static func from(_ error: Swift.Error) -> FacadeError {
        if error is CancellationError {
            return .cancelled
        }
        if let apiError = unwrapApiError(error) {
            return map(apiError)
        }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            if nsError.code == NSURLErrorNotConnectedToInternet {
                return .offline
            }
            return .network(message: nsError.localizedDescription)
        }
        return .unknown(message: nsError.localizedDescription)
    }

    /// Maps a Kotlin `Throwable` into a `FacadeError`.
    ///
    /// `Resource.Error` carries its failure as a `Shared.KotlinThrowable`, which
    /// Kotlin/Native does not bridge to Swift's `Error`, so it can't flow through
    /// `from(_:Swift.Error)`. The throwable may still be an `ApiError` subclass.
    static func from(_ throwable: Shared.KotlinThrowable) -> FacadeError {
        if let apiError = throwable as? Shared.ApiError {
            return map(apiError)
        }
        return .unknown(message: throwable.message ?? "Unknown error")
    }

    private static func unwrapApiError(_ error: Swift.Error) -> Shared.ApiError? {
        if let direct = error as? Shared.ApiError {
            return direct
        }
        let nsError = error as NSError
        return nsError.userInfo["KotlinException"] as? Shared.ApiError
    }

    private static func map(_ apiError: Shared.ApiError) -> FacadeError {
        switch apiError {
        case let http as Shared.ApiError.Http:
            let status = Int(http.status)
            if status == 401 {
                return .auth(message: http.message ?? "Authentication required")
            }
            return .api(status: status, code: http.code, body: http.body)
        case is Shared.ApiError.Timeout:
            return .timeout(message: apiError.message ?? "Request timed out")
        case is Shared.ApiError.Decode:
            return .decode(message: apiError.message ?? "Failed to decode response")
        case is Shared.ApiError.CircuitOpen:
            return .circuitOpen
        case is Shared.ApiError.Network:
            return .network(message: apiError.message ?? "Network request failed")
        default:
            return .unknown(message: apiError.message ?? "Unknown error")
        }
    }
}
