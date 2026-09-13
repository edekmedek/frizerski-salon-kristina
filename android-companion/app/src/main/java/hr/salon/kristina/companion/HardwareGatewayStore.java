package hr.salon.kristina.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class HardwareGatewayStore {
    private static final String STORE = "hardware_gateway_secure_v1";
    private static final String ALIAS = "salon_hardware_gateway_v1";
    private static final String DATA = "data";
    private static final String IV = "iv";
    private static final String ENABLED = "enabled";

    public static final class Session {
        public final String accessToken;
        public final String refreshToken;
        Session(String accessToken, String refreshToken) { this.accessToken = accessToken; this.refreshToken = refreshToken; }
    }
    private HardwareGatewayStore() {}
    public static boolean hasSession(Context context) { return prefs(context).contains(DATA); }
    public static boolean isEnabled(Context context) { return prefs(context).getBoolean(ENABLED, false); }
    public static void setEnabled(Context context, boolean enabled) { prefs(context).edit().putBoolean(ENABLED, enabled).apply(); }
    public static void save(Context context, String access, String refresh) throws Exception {
        JSONObject json = new JSONObject().put("access", access).put("refresh", refresh);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(json.toString().getBytes(StandardCharsets.UTF_8));
        if (!prefs(context).edit().putString(DATA, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) throw new Exception("Session save failed");
    }
    public static Session load(Context context) throws Exception {
        String data = prefs(context).getString(DATA, null), iv = prefs(context).getString(IV, null);
        if (data == null || iv == null) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        JSONObject json = new JSONObject(new String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), StandardCharsets.UTF_8));
        return new Session(json.getString("access"), json.getString("refresh"));
    }
    public static void clear(Context context) { prefs(context).edit().clear().apply(); }
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(STORE, Context.MODE_PRIVATE); }
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        java.security.Key existing = store.getKey(ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
}
