package com.teslasync.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ServerConnectionStoreTest {
    private static final String NAMESPACE = "teslasync_connection_test";
    private static final String CONNECTION = "{\"url\":\"https://test.example\",\"token\":\"ts_test_only\"}";
    private Context context;
    private ServerConnectionStore store;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        store = new ServerConnectionStore(context, NAMESPACE);
        store.clear();
    }

    @After
    public void tearDown() throws Exception {
        store.clear();
    }

    @Test
    public void restoresEncryptedConnectionFromANewStoreInstance() throws Exception {
        store.save(CONNECTION);
        String encoded = context.getSharedPreferences(NAMESPACE, Context.MODE_PRIVATE).getString("connection", "");
        assertFalse(encoded.contains("ts_test_only"));
        assertFalse(encoded.contains("https://test.example"));
        assertEquals(CONNECTION, new ServerConnectionStore(context, NAMESPACE).load());
    }

    @Test
    public void disconnectRemovesConnectionAndKeystoreKey() throws Exception {
        store.save(CONNECTION);
        store.clear();
        assertNull(new ServerConnectionStore(context, NAMESPACE).load());
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        assertFalse(keyStore.containsAlias("com.teslasync.app." + NAMESPACE));
    }

    @Test
    public void refusesTamperedCiphertext() throws Exception {
        store.save(CONNECTION);
        android.content.SharedPreferences preferences = context.getSharedPreferences(NAMESPACE, Context.MODE_PRIVATE);
        String[] parts = preferences.getString("connection", "").split(":", 2);
        byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
        ciphertext[0] ^= 1;
        assertTrue(preferences.edit().putString("connection",
            parts[0] + ":" + Base64.encodeToString(ciphertext, Base64.NO_WRAP)).commit());
        assertThrows(GeneralSecurityException.class, () -> store.load());
    }
}
