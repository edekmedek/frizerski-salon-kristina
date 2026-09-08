package hr.salon.kristina.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Keystore-backed persistent storage. The pairing PIN is deliberately not persisted. */
public final class NukiCredentialStore {
    private static final String STORE = "nuki_secure_credentials";
    private static final String KEY_ALIAS = "salon_nuki_credentials_v1";
    private static final String CIPHERTEXT = "ciphertext";
    private static final String IV = "iv";

    private final SharedPreferences preferences;

    public NukiCredentialStore(Context context) {
        preferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    public boolean hasCredentials() {
        return preferences.contains(CIPHERTEXT) && preferences.contains(IV);
    }

    public void save(Credentials credentials) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(serialize(credentials));
        if (!preferences.edit()
                .putString(CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .commit()) {
            throw new GeneralSecurityException("Could not persist Nuki credentials");
        }
    }

    public Credentials load() throws GeneralSecurityException {
        String encrypted = preferences.getString(CIPHERTEXT, null);
        String iv = preferences.getString(IV, null);
        if (encrypted == null || iv == null) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(),
                new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        return deserialize(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)));
    }

    public void clear() {
        preferences.edit().clear().apply();
    }

    private SecretKey getOrCreateKey() throws GeneralSecurityException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        try {
            keyStore.load(null);
        } catch (java.io.IOException error) {
            throw new GeneralSecurityException("Could not load Android Keystore", error);
        }
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private byte[] serialize(Credentials value) {
        byte[] address = value.deviceAddress.getBytes(StandardCharsets.US_ASCII);
        ByteBuffer buffer = ByteBuffer.allocate(1 + address.length + 4 + 4 + 16 + 32)
                .order(ByteOrder.LITTLE_ENDIAN);
        buffer.put((byte) address.length).put(address);
        buffer.putInt((int) value.authorizationId).putInt((int) value.appId);
        buffer.put(value.lockUuid).put(value.sharedKey);
        return buffer.array();
    }

    private Credentials deserialize(byte[] encoded) throws GeneralSecurityException {
        try {
            ByteBuffer buffer = ByteBuffer.wrap(encoded).order(ByteOrder.LITTLE_ENDIAN);
            int addressLength = Byte.toUnsignedInt(buffer.get());
            if (addressLength == 0 || addressLength > 32) throw new IllegalArgumentException();
            byte[] address = new byte[addressLength];
            buffer.get(address);
            long authorizationId = Integer.toUnsignedLong(buffer.getInt());
            long appId = Integer.toUnsignedLong(buffer.getInt());
            byte[] lockUuid = new byte[16];
            byte[] sharedKey = new byte[32];
            buffer.get(lockUuid).get(sharedKey);
            if (buffer.hasRemaining()) throw new IllegalArgumentException();
            return new Credentials(new String(address, StandardCharsets.US_ASCII),
                    authorizationId, appId, lockUuid, sharedKey);
        } catch (RuntimeException error) {
            throw new GeneralSecurityException("Invalid Nuki credential record", error);
        }
    }

    public static final class Credentials {
        public final String deviceAddress;
        public final long authorizationId;
        public final long appId;
        public final byte[] lockUuid;
        public final byte[] sharedKey;

        public Credentials(String deviceAddress, long authorizationId, long appId,
                byte[] lockUuid, byte[] sharedKey) {
            if (lockUuid.length != 16 || sharedKey.length != 32) {
                throw new IllegalArgumentException("Invalid Nuki credential lengths");
            }
            this.deviceAddress = deviceAddress;
            this.authorizationId = authorizationId;
            this.appId = appId;
            this.lockUuid = lockUuid.clone();
            this.sharedKey = sharedKey.clone();
        }
    }
}
