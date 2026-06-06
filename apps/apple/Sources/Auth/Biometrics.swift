import Foundation
import LocalAuthentication

/// Which device authentication is available for the optional unlock gate.
public enum BiometricKind: Equatable, Sendable {
    case none
    case touchID
    case faceID
    case opticID
    case passcodeOnly

    /// SF Symbol representing the biometry kind (for the unlock affordance).
    public var systemImage: String {
        switch self {
        case .faceID: "faceid"
        case .touchID: "touchid"
        case .opticID: "opticid"
        case .passcodeOnly: "lock.fill"
        case .none: "lock.slash"
        }
    }
}

/// Snapshot of whether (and how) the device can authenticate the owner.
public struct BiometricAvailability: Equatable, Sendable {
    public let isAvailable: Bool
    public let kind: BiometricKind

    public init(isAvailable: Bool, kind: BiometricKind) {
        self.isAvailable = isAvailable
        self.kind = kind
    }

    public static let unavailable = BiometricAvailability(isAvailable: false, kind: .none)
}

/// Optional Face ID / Touch ID / Optic ID / passcode gate (`LocalAuthentication`).
public protocol BiometricAuthenticating: Sendable {
    func availability() -> BiometricAvailability
    func evaluate(reason: String) async throws
}

/// `BiometricAuthenticating` over `LAContext`. A fresh context per call avoids
/// reusing a previously-evaluated (already-unlocked) context.
public final class BiometricGate: BiometricAuthenticating {
    private let allowsPasscodeFallback: Bool

    public init(allowsPasscodeFallback: Bool = true) {
        self.allowsPasscodeFallback = allowsPasscodeFallback
    }

    private var policy: LAPolicy {
        allowsPasscodeFallback ? .deviceOwnerAuthentication : .deviceOwnerAuthenticationWithBiometrics
    }

    public func availability() -> BiometricAvailability {
        let context = LAContext()
        let kind = Self.kind(from: context.biometryType)
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) {
            return BiometricAvailability(isAvailable: true, kind: kind)
        }
        if allowsPasscodeFallback, context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
            return BiometricAvailability(isAvailable: true, kind: kind == .none ? .passcodeOnly : kind)
        }
        return .unavailable
    }

    public func evaluate(reason: String) async throws {
        let context = LAContext()
        var policyError: NSError?
        guard context.canEvaluatePolicy(policy, error: &policyError) else {
            throw AuthError.biometricUnavailable
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            context.evaluatePolicy(policy, localizedReason: reason) { success, evaluationError in
                if success {
                    continuation.resume()
                } else {
                    let message = evaluationError?.localizedDescription ?? "evaluation failed"
                    continuation.resume(throwing: AuthError.biometricFailed(message))
                }
            }
        }
    }

    static func kind(from type: LABiometryType) -> BiometricKind {
        switch type {
        case .faceID: .faceID
        case .touchID: .touchID
        case .opticID: .opticID
        default: .none
        }
    }
}

/// Persists ONLY the user's "unlock with biometrics" preference flag (a Bool).
/// Tokens never touch this store — they live exclusively in the Keychain.
public protocol BiometricPreferenceStoring: Sendable {
    var isEnabled: Bool { get }
    func setEnabled(_ enabled: Bool)
}

public final class BiometricPreferenceStore: BiometricPreferenceStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key = "auth.biometricUnlock.enabled"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var isEnabled: Bool {
        defaults.bool(forKey: key)
    }

    public func setEnabled(_ enabled: Bool) {
        defaults.set(enabled, forKey: key)
    }
}
