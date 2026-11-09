package com.teslasync.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class ServerConnectionStore {
    private static final String PROVIDER = "AndroidKeyStore";
    private static final String VALUE = "connection";
    private final SharedPreferences preferences;
    private final String keyAlias;

    ServerConnectionStore(Context context) {
        this(context, "teslasync_secure_connection");
    }

    ServerConnectionStore(Context context, String namespace) {
        preferences = context.getApplicationContext().getSharedPreferences(namespace, Context.MODE_PRIVATE);
        keyAlias = "com.teslasync.app." + namespace;
    }

    void save(String connection) throws GeneralSecurityException, IOException {
        KeyStore keyStore = keyStore();
        SecretKey key = (SecretKey) keyStore.getKey(keyAlias, null);
        if (key == null) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
            generator.init(new KeyGenParameterSpec.Builder(
                keyAlias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            key = generator.generateKey();
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] ciphertext = cipher.doFinal(connection.getBytes(StandardCharsets.UTF_8));
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP);
        if (!preferences.edit().putString(VALUE, encoded).commit()) {
            throw new IOException("Could not save native connection");
        }
    }

    String load() throws GeneralSecurityException, IOException {
        String encoded = preferences.getString(VALUE, null);
        if (encoded == null) return null;
        String[] parts = encoded.split(":", 2);
        if (parts.length != 2) throw new GeneralSecurityException("Invalid stored connection");
        SecretKey key = (SecretKey) keyStore().getKey(keyAlias, null);
        if (key == null) throw new GeneralSecurityException("Native connection key is unavailable");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    void clear() throws GeneralSecurityException, IOException {
        KeyStore keyStore = keyStore();
        if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias);
        if (!preferences.edit().remove(VALUE).commit()) {
            throw new IOException("Could not clear native connection");
        }
    }

    private KeyStore keyStore() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(PROVIDER);
        keyStore.load(null);
        return keyStore;
    }
}
