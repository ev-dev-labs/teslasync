import Foundation
import Security

/// Persists the OIDC token set in OS-native secure storage. The only sanctioned
/// place tokens are written at rest (ADR-008): never `UserDefaults`, files, or logs.
public protocol TokenStoring: Sendable {
    func save(_ tokens: AuthTokens) throws
    func load() throws -> AuthTokens?
    func clear() throws
}

/// Keychain item accessibility / protection class.
public enum KeychainAccessibility: Equatable, Sendable {
    /// Readable after the first unlock following boot; never leaves this device.
    case afterFirstUnlockThisDeviceOnly
    /// Readable only while the device is unlocked; never leaves this device.
    case whenUnlockedThisDeviceOnly
    /// Gated by a `SecAccessControl` requiring biometry/passcode on every read.
    case biometricCurrentSet

    var secAttribute: CFString {
        switch self {
        case .afterFirstUnlockThisDeviceOnly: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        case .whenUnlockedThisDeviceOnly, .biometricCurrentSet: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        }
    }

    var requiresAccessControl: Bool {
        self == .biometricCurrentSet
    }
}

/// Identifies and protects the Keychain item holding the token set.
public struct KeychainConfiguration: Equatable, Sendable {
    public let service: String
    public let account: String
    public let accessGroup: String?
    public let accessibility: KeychainAccessibility
    public let synchronizable: Bool

    public init(
        service: String = "io.teslasync.app.auth",
        account: String = "oidc-token-set",
        accessGroup: String? = nil,
        accessibility: KeychainAccessibility = .afterFirstUnlockThisDeviceOnly,
        synchronizable: Bool = false
    ) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
        self.accessibility = accessibility
        self.synchronizable = synchronizable
    }

    public static let `default` = KeychainConfiguration()
}

/// `TokenStoring` backed by the iOS/macOS Keychain (generic password item).
public final class KeychainTokenStore: TokenStoring {
    private let configuration: KeychainConfiguration

    public init(configuration: KeychainConfiguration = .default) {
        self.configuration = configuration
    }

    public func save(_ tokens: AuthTokens) throws {
        let data: Data
        do {
            data = try JSONEncoder().encode(tokens)
        } catch {
            throw AuthError.decoding(String(describing: error))
        }
        // Delete-then-add is the simplest correct upsert and avoids stale
        // protection attributes lingering from a prior accessibility class.
        SecItemDelete(baseQuery() as CFDictionary)
        var attributes = baseQuery()
        attributes[kSecValueData as String] = data
        try applyProtection(to: &attributes)
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw AuthError.keychain(status)
        }
    }

    public func load() throws -> AuthTokens? {
        var query = baseQuery()
        query[kSecReturnData as String] = kCFBooleanTrue as Any
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { return nil }
            do {
                return try JSONDecoder().decode(AuthTokens.self, from: data)
            } catch {
                throw AuthError.decoding(String(describing: error))
            }
        case errSecItemNotFound:
            return nil
        default:
            throw AuthError.keychain(status)
        }
    }

    public func clear() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw AuthError.keychain(status)
        }
    }

    private func baseQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: configuration.service,
            kSecAttrAccount as String: configuration.account
        ]
        if let accessGroup = configuration.accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        if configuration.synchronizable {
            query[kSecAttrSynchronizable as String] = kCFBooleanTrue as Any
        }
        return query
    }

    private func applyProtection(to attributes: inout [String: Any]) throws {
        guard configuration.accessibility.requiresAccessControl else {
            attributes[kSecAttrAccessible as String] = configuration.accessibility.secAttribute
            return
        }
        var cfError: Unmanaged<CFError>?
        let control = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.biometryCurrentSet],
            &cfError
        )
        guard let control else {
            cfError?.release()
            throw AuthError.keychain(errSecParam)
        }
        attributes[kSecAttrAccessControl as String] = control
    }
}

/// In-memory `TokenStoring` for previews and unit tests — deterministic and never
/// touching the real Keychain, while honoring the same contract.
public final class InMemoryTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: AuthTokens?

    public init(_ initial: AuthTokens? = nil) {
        stored = initial
    }

    public func save(_ tokens: AuthTokens) throws {
        lock.lock()
        defer { lock.unlock() }
        stored = tokens
    }

    public func load() throws -> AuthTokens? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    public func clear() throws {
        lock.lock()
        defer { lock.unlock() }
        stored = nil
    }
}
