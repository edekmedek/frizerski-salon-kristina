package hr.salon.kristina.companion;

import android.os.Handler;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class HardwareRealtimeClient {
    public interface Listener {
        void onReady();
        void onCommandChanged();
        void onDisconnected(String detail);
    }
    private static final long[] BACKOFF_MS = {5_000L, 10_000L, 20_000L, 40_000L, 60_000L, 120_000L};
    private final HardwareGatewayClient api;
    private final Handler handler;
    private final Listener listener;
    private final OkHttpClient http = new OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build();
    private WebSocket socket;
    private int reconnectAttempt;
    private boolean stopped;
    private boolean reconnectScheduled;
    private int reference = 2;
    private final Runnable heartbeat = this::sendHeartbeat;

    public HardwareRealtimeClient(HardwareGatewayClient api, Handler handler, Listener listener) {
        this.api = api; this.handler = handler; this.listener = listener;
    }
    public void start() { stopped = false; connect(); }
    public void stop() { stopped = true; handler.removeCallbacksAndMessages(this); handler.removeCallbacks(heartbeat); if (socket != null) socket.close(1000, "service stopped"); }
    private void connect() {
        if (stopped) return;
        reconnectScheduled = false;
        try {
            String url = BuildConfig.SUPABASE_URL.replaceFirst("^https://", "wss://")
                    + "/realtime/v1/websocket?apikey=" + BuildConfig.SUPABASE_PUBLISHABLE_KEY + "&vsn=2.0.0";
            Request request = new Request.Builder().url(url).build();
            socket = http.newWebSocket(request, new WebSocketListener() {
                @Override public void onOpen(WebSocket webSocket, Response response) { join(webSocket); }
                @Override public void onMessage(WebSocket webSocket, String text) { receive(text); }
                @Override public void onFailure(WebSocket webSocket, Throwable error, Response response) { disconnected(error.getMessage()); }
                @Override public void onClosed(WebSocket webSocket, int code, String reason) { if (!stopped) disconnected(reason); }
            });
        } catch (Exception error) { disconnected(error.getMessage()); }
    }
    private void join(WebSocket webSocket) {
        try {
            JSONObject changes = new JSONObject().put("event", "INSERT").put("schema", "public")
                    .put("table", "hardware_commands").put("select", new JSONArray().put("id"));
            JSONObject config = new JSONObject().put("private", false)
                    .put("broadcast", new JSONObject().put("ack", false).put("self", false))
                    .put("presence", new JSONObject().put("enabled", false))
                    .put("postgres_changes", new JSONArray().put(changes));
            JSONObject payload = new JSONObject().put("config", config).put("access_token", api.accessTokenForRealtime());
            webSocket.send(new JSONArray().put("1").put("1").put("realtime:hardware-gateway")
                    .put("phx_join").put(payload).toString());
        } catch (Exception error) { webSocket.cancel(); disconnected(error.getMessage()); }
    }
    private void receive(String text) {
        try {
            JSONArray message = new JSONArray(text);
            String event = message.optString(3);
            if ("phx_reply".equals(event)) {
                JSONObject reply = message.optJSONObject(4);
                if (reply != null && "ok".equals(reply.optString("status"))) {
                    reconnectAttempt = 0; scheduleHeartbeat(); listener.onReady(); return;
                }
                disconnected("join rejected"); return;
            }
            if ("postgres_changes".equals(event)) listener.onCommandChanged();
            else if ("phx_error".equals(event) || "phx_close".equals(event)) disconnected(event);
        } catch (Exception error) { AutomationLog.error("Gateway Realtime message", error.getMessage(), error); }
    }
    private synchronized void disconnected(String detail) {
        if (stopped) return;
        if (reconnectScheduled) return;
        reconnectScheduled = true;
        handler.removeCallbacks(heartbeat);
        listener.onDisconnected(detail == null ? "disconnected" : detail);
        long delay = reconnectDelay(reconnectAttempt++);
        handler.postAtTime(this::connect, this, android.os.SystemClock.uptimeMillis() + delay);
    }
    static long reconnectDelay(int attempt) {
        return BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)];
    }
    private void scheduleHeartbeat() {
        handler.removeCallbacks(heartbeat);
        handler.postDelayed(heartbeat, 30_000L);
    }
    private void sendHeartbeat() {
        WebSocket current = socket;
        if (stopped || current == null) return;
        current.send(new JSONArray().put(JSONObject.NULL).put(String.valueOf(reference++))
                .put("phoenix").put("heartbeat").put(new JSONObject()).toString());
        scheduleHeartbeat();
    }
}
