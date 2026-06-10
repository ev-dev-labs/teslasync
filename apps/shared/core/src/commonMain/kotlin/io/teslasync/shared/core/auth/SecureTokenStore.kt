package io.teslasync.shared.core.auth

/**
 * Persistence seam for the signed-in [TokenSet]. The token material is sensitive, so
 * the concrete implementations bind to each platform's secure enclave:
 *  - Android: an `AndroidKeyStore` AES/GCM key encrypting the payload in private
 *    `SharedPreferences` (`AndroidKeystoreTokenStore`).
 *  - Apple: the Keychain with `kSecAttrAccessibleAfterFirstUnlock`
 *    (`AppleKeychainTokenStore`).
 *
 * The shared core depends only on this interface; the platform stores are
 * constructed in the platform app modules (where the Android `Context` / Keychain
 * service name is available) and injected into [AuthService]. Tests use an in-memory
 * fake. Implementations must never log token material and should return `null` from
 * [load] for absent or undecodable data rather than throwing.
 */
public interface SecureTokenStore {
    /** Returns the persisted token set, or `null` if none is stored / it is unreadable. */
    public suspend fun load(): TokenSet?

    /** Persists [tokens], replacing any previously stored set. */
    public suspend fun save(tokens: TokenSet)

    /** Removes any persisted token set. Idempotent. */
    public suspend fun clear()
}
