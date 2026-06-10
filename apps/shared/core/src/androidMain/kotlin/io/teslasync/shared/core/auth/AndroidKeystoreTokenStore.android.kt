package io.teslasync.shared.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * [SecureTokenStore] backed by the Android Keystore. The [TokenSet] JSON is encrypted
 * with an AES-256/GCM key that lives in the `AndroidKeyStore` (non-exportable), and
 * the IV-prefixed ciphertext is kept in private [Context.MODE_PRIVATE]
 * `SharedPreferences`. No third-party dependency is required.
 *
 * Constructed by the Android app module (which holds the [Context]) and injected into
 * [AuthService]. Token material is never logged.
 */
public class AndroidKeystoreTokenStore(
    context: Context,
    prefsName: String = DEFAULT_PREFS_NAME,
    private val keyAlias: String = DEFAULT_KEY_ALIAS,
    private val json: Json = defaultAuthJson,
) : SecureTokenStore {
    private val prefs = context.applicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    override suspend fun load(): TokenSet? {
        val stored = prefs.getString(ENTRY_KEY, null) ?: return null
        return try {
            val combined = Base64.decode(stored, Base64.NO_WRAP)
            val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
            val ciphertext = combined.copyOfRange(GCM_IV_LENGTH, combined.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, loadOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            val plaintext = cipher.doFinal(ciphertext)
            json.decodeFromString(TokenSet.serializer(), plaintext.decodeToString())
        } catch (e: Throwable) {
            null
        }
    }

    override suspend fun save(tokens: TokenSet) {
        val plaintext = json.encodeToString(TokenSet.serializer(), tokens).encodeToByteArray()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, loadOrCreateKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        val combined = iv + ciphertext
        prefs.edit().putString(ENTRY_KEY, Base64.encodeToString(combined, Base64.NO_WRAP)).apply()
    }

    override suspend fun clear() {
        prefs.edit().remove(ENTRY_KEY).apply()
    }

    private fun loadOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getEntry(keyAlias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec
                .Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    public companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_BITS = 128
        private const val ENTRY_KEY = "token_set.v1"

        /** Default private preferences file name for the encrypted token blob. */
        public const val DEFAULT_PREFS_NAME: String = "io.teslasync.auth"

        /** Default `AndroidKeyStore` alias for the AES/GCM wrapping key. */
        public const val DEFAULT_KEY_ALIAS: String = "io.teslasync.auth.token_key"
    }
}
