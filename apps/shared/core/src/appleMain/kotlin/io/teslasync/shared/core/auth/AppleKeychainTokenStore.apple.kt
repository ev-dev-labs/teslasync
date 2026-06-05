package io.teslasync.shared.core.auth

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.MemScope
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.allocArray
import kotlinx.cinterop.convert
import kotlinx.cinterop.get
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.set
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import kotlinx.serialization.json.Json
import platform.CoreFoundation.CFDictionaryCreate
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFStringRef
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFAllocatorDefault
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.create
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecItemNotFound
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlock
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData
import platform.posix.memcpy

/**
 * [SecureTokenStore] backed by the Apple Keychain (`kSecClassGenericPassword`). The
 * [TokenSet] JSON is stored as the item's data with
 * `kSecAttrAccessibleAfterFirstUnlock` so it is available to background refreshes but
 * never leaves the device (no iCloud sync). Keyed by ([service], [account]).
 *
 * Constructed by the Apple app module and injected into [AuthService]. Token material
 * is never logged.
 */
@OptIn(ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)
public class AppleKeychainTokenStore(
    private val service: String = DEFAULT_SERVICE,
    private val account: String = DEFAULT_ACCOUNT,
    private val json: Json = defaultAuthJson,
) : SecureTokenStore {
    override suspend fun load(): TokenSet? =
        memScoped {
            val retained = mutableListOf<CFTypeRef?>()
            try {
                val query =
                    cfDictionary(
                        listOf(
                            kSecClass to kSecClassGenericPassword,
                            kSecAttrService to bridge(service, retained),
                            kSecAttrAccount to bridge(account, retained),
                            kSecReturnData to kCFBooleanTrue,
                            kSecMatchLimit to kSecMatchLimitOne,
                        ),
                        retained,
                    )
                val result = alloc<CFTypeRefVar>()
                val status = SecItemCopyMatching(query, result.ptr)
                if (status != errSecSuccess) return@memScoped null
                val data = result.value?.let { cfBridgingReleaseToNSData(it) } ?: return@memScoped null
                val bytes = data.toByteArray()
                if (bytes.isEmpty()) return@memScoped null
                runCatching { json.decodeFromString(TokenSet.serializer(), bytes.decodeToString()) }.getOrNull()
            } finally {
                retained.forEach { CFRelease(it) }
            }
        }

    override suspend fun save(tokens: TokenSet) {
        // Replace any prior item: delete then add keeps the accessibility attribute exact.
        deleteItem()
        val payload = json.encodeToString(TokenSet.serializer(), tokens).encodeToByteArray()
        memScoped {
            val retained = mutableListOf<CFTypeRef?>()
            try {
                val attributes =
                    cfDictionary(
                        listOf(
                            kSecClass to kSecClassGenericPassword,
                            kSecAttrService to bridge(service, retained),
                            kSecAttrAccount to bridge(account, retained),
                            kSecAttrAccessible to kSecAttrAccessibleAfterFirstUnlock,
                            kSecValueData to bridge(payload.toNSData(), retained),
                        ),
                        retained,
                    )
                SecItemAdd(attributes, null)
            } finally {
                retained.forEach { CFRelease(it) }
            }
        }
    }

    override suspend fun clear() {
        deleteItem()
    }

    private fun deleteItem() {
        memScoped {
            val retained = mutableListOf<CFTypeRef?>()
            try {
                val query =
                    cfDictionary(
                        listOf(
                            kSecClass to kSecClassGenericPassword,
                            kSecAttrService to bridge(service, retained),
                            kSecAttrAccount to bridge(account, retained),
                        ),
                        retained,
                    )
                val status = SecItemDelete(query)
                // errSecItemNotFound is fine — clear() is idempotent.
                check(status == errSecSuccess || status == errSecItemNotFound) {
                    "Keychain delete failed: $status"
                }
            } finally {
                retained.forEach { CFRelease(it) }
            }
        }
    }

    /** Bridges a Kotlin value to a retained CoreFoundation ref, tracked for release. */
    private fun bridge(
        value: Any,
        retained: MutableList<CFTypeRef?>,
    ): CFTypeRef? = CFBridgingRetain(value).also { retained.add(it) }

    private fun cfBridgingReleaseToNSData(ref: CFTypeRef): NSData? = platform.Foundation.CFBridgingRelease(ref) as? NSData

    private fun MemScope.cfDictionary(
        pairs: List<Pair<CFStringRef?, CFTypeRef?>>,
        @Suppress("UNUSED_PARAMETER") retained: MutableList<CFTypeRef?>,
    ): CFDictionaryRef? {
        val count = pairs.size
        val keys = allocArray<CFTypeRefVar>(count)
        val values = allocArray<CFTypeRefVar>(count)
        pairs.forEachIndexed { index, (key, value) ->
            keys[index] = key
            values[index] = value
        }
        return CFDictionaryCreate(
            kCFAllocatorDefault,
            keys.reinterpret(),
            values.reinterpret(),
            count.convert(),
            kCFTypeDictionaryKeyCallBacks.ptr,
            kCFTypeDictionaryValueCallBacks.ptr,
        )
    }

    private fun ByteArray.toNSData(): NSData =
        if (isEmpty()) {
            NSData()
        } else {
            usePinned { pinned ->
                NSData.create(bytes = pinned.addressOf(0), length = size.convert())
            }
        }

    private fun NSData.toByteArray(): ByteArray {
        val size = length.toInt()
        if (size == 0) return ByteArray(0)
        val out = ByteArray(size)
        out.usePinned { pinned ->
            memcpy(pinned.addressOf(0), bytes, length)
        }
        return out
    }

    public companion object {
        /** Default Keychain `kSecAttrService` for TeslaSync auth tokens. */
        public const val DEFAULT_SERVICE: String = "io.teslasync.auth"

        /** Default Keychain `kSecAttrAccount` (versioned token entry). */
        public const val DEFAULT_ACCOUNT: String = "token_set.v1"
    }
}
