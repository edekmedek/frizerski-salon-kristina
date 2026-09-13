package hr.salon.kristina.companion;

import android.content.Context;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class HardwareGatewayClient {
    private final Context context;
    public HardwareGatewayClient(Context context) { this.context = context.getApplicationContext(); }

    public void signIn(String email, String password) throws Exception {
        JSONObject response = request("/auth/v1/token?grant_type=password", null,
                new JSONObject().put("email", email).put("password", password));
        saveTokens(response);
        try { heartbeat(null); } catch (Exception error) { HardwareGatewayStore.clear(context); throw error; }
    }
    public HardwareCommand claim() throws Exception {
        JSONArray rows = rpc("gateway_claim_next_hardware_command", new JSONObject());
        if (rows.length() == 0) return null;
        JSONObject row = rows.getJSONObject(0);
        return new HardwareCommand(row.getString("id"), row.getString("device"), row.getString("action"));
    }
    public void running(String id) throws Exception { rpc("gateway_mark_hardware_command_running", new JSONObject().put("command_id", id)); }
    public void complete(String id, String status, String code, String detail, String confirmedState) throws Exception {
        rpc("gateway_complete_hardware_command", new JSONObject().put("command_id", id)
                .put("final_status", status).put("final_code", code).put("final_detail", detail)
                .put("confirmed_state", confirmedState == null ? JSONObject.NULL : confirmedState));
    }
    public void reportNukiState(String state, String detail) throws Exception {
        rpc("gateway_report_nuki_state", new JSONObject().put("reported_state", state)
                .put("reported_detail", detail == null ? "" : detail));
    }
    public void heartbeat(String error) throws Exception {
        rpc("gateway_heartbeat", new JSONObject().put("gateway_app_version", BuildConfig.VERSION_NAME)
                .put("gateway_error", error == null ? JSONObject.NULL : error));
    }
    private JSONArray rpc(String name, JSONObject body) throws Exception {
        try { return asArray(request("/rest/v1/rpc/" + name, token(), body)); }
        catch (Unauthorized ignored) { refresh(); return asArray(request("/rest/v1/rpc/" + name, token(), body)); }
    }
    public synchronized String accessTokenForRealtime() throws Exception {
        HardwareGatewayStore.Session session = HardwareGatewayStore.load(context);
        if (session == null) throw new Unauthorized();
        try {
            String[] parts = session.accessToken.split("\\.");
            JSONObject claims = new JSONObject(new String(Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP), StandardCharsets.UTF_8));
            if (claims.getLong("exp") * 1000L - System.currentTimeMillis() < 120_000L) {
                refresh(); session = HardwareGatewayStore.load(context);
            }
        } catch (RuntimeException ignored) { /* Server will reject malformed/expired tokens. */ }
        if (session == null) throw new Unauthorized();
        return session.accessToken;
    }
    private String token() throws Exception { return accessTokenForRealtime(); }
    private synchronized void refresh() throws Exception {
        HardwareGatewayStore.Session session = HardwareGatewayStore.load(context);
        if (session == null) throw new Unauthorized();
        saveTokens(request("/auth/v1/token?grant_type=refresh_token", null,
                new JSONObject().put("refresh_token", session.refreshToken)));
    }
    private void saveTokens(JSONObject json) throws Exception { HardwareGatewayStore.save(context, json.getString("access_token"), json.getString("refresh_token")); }
    private JSONArray asArray(JSONObject wrapper) throws Exception { return wrapper.getJSONArray("rows"); }
    private JSONObject request(String path, String bearer, JSONObject body) throws Exception {
        if (BuildConfig.SUPABASE_URL.isEmpty() || BuildConfig.SUPABASE_PUBLISHABLE_KEY.isEmpty()) throw new Exception("Supabase build configuration missing");
        HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.SUPABASE_URL + path).openConnection();
        connection.setConnectTimeout(10_000); connection.setReadTimeout(15_000); connection.setRequestMethod("POST");
        connection.setRequestProperty("apikey", BuildConfig.SUPABASE_PUBLISHABLE_KEY);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            for (String line; (line = reader.readLine()) != null;) text.append(line);
        }
        if (status == 401) throw new Unauthorized();
        if (status < 200 || status >= 300) throw new Exception("Supabase HTTP " + status + ": " + text);
        String raw = text.toString().trim();
        if (raw.startsWith("[")) return new JSONObject().put("rows", new JSONArray(raw));
        if (raw.isEmpty()) return new JSONObject().put("rows", new JSONArray());
        return new JSONObject(raw);
    }
    private static final class Unauthorized extends Exception {}
}
