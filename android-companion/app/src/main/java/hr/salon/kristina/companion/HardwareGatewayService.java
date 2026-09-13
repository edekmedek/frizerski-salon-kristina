package hr.salon.kristina.companion;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class HardwareGatewayService extends Service {
    private static final String CHANNEL = "hardware_gateway_v1";
    private static final int NOTIFICATION = 236;
    static final long FALLBACK_POLL_MS = 120_000L;
    static final long HEARTBEAT_MS = 60_000L;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean busy;
    private volatile boolean claimInFlight;
    private HardwareGatewayClient client;
    private NukiBleController activeNuki;
    private HardwareRealtimeClient realtime;
    private boolean started;
    private final Runnable poll = this::pollNow;
    private final Runnable heartbeat = this::heartbeatNow;

    public static void start(Context context) {
        context.startForegroundService(new Intent(context, HardwareGatewayService.class));
    }
    public static void stop(Context context) {
        context.stopService(new Intent(context, HardwareGatewayService.class));
    }
    @Override public void onCreate() {
        super.onCreate(); client = new HardwareGatewayClient(this); startForeground(NOTIFICATION, notification());
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!started) {
            started = true;
            realtime = new HardwareRealtimeClient(client, main, new HardwareRealtimeClient.Listener() {
                @Override public void onReady() { main.post(HardwareGatewayService.this::requestImmediatePoll); }
                @Override public void onCommandChanged() { main.post(HardwareGatewayService.this::requestImmediatePoll); }
                @Override public void onDisconnected(String detail) { AutomationLog.step("Gateway Realtime disconnected", "detail=" + detail); }
            });
            realtime.start();
            main.post(heartbeat);
            main.post(poll);
        }
        return START_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (realtime != null) realtime.stop();
        if (activeNuki != null) activeNuki.cancel();
        GatewayExecutionReporter.clear(); worker.shutdownNow(); super.onDestroy();
    }
    private void pollNow() {
        if (!busy && !claimInFlight) {
            claimInFlight = true;
            worker.execute(() -> {
            try {
                HardwareCommand command = client.claim();
                if (command != null) {
                    busy = true; client.running(command.id); main.post(() -> execute(command));
                }
            } catch (Exception error) { AutomationLog.error("Hardware gateway poll", error.getMessage(), error); }
            finally {
                claimInFlight = false;
                main.removeCallbacks(poll); main.postDelayed(poll, FALLBACK_POLL_MS);
            }
        });
        } else main.postDelayed(poll, FALLBACK_POLL_MS);
    }
    private void requestImmediatePoll() {
        if (busy) return;
        main.removeCallbacks(poll); main.post(poll);
    }
    private void heartbeatNow() {
        worker.execute(() -> {
            try { client.heartbeat(null); }
            catch (Exception error) { AutomationLog.error("Hardware gateway heartbeat", error.getMessage(), error); }
            finally { main.removeCallbacks(heartbeat); main.postDelayed(heartbeat, HEARTBEAT_MS); }
        });
    }
    private void execute(HardwareCommand command) {
        AutomationLog.step("Gateway command", "device=" + command.device + " action=" + command.action + " id=" + command.id);
        if ("nuki".equals(command.device)) { executeNuki(command); return; }
        DoorAccessibilityService service = DoorAccessibilityService.getConnectedInstance();
        if (service == null) { finish(command, "failed", "service_unavailable", "Accessibility service is not connected", null); return; }
        if (!GatewayExecutionReporter.begin(command.device, (result, detail) -> {
            String confirmed = "boiler".equals(command.device) && ("on".equals(result) || "off".equals(result)) ? result : null;
            String status = ("on".equals(result) || "off".equals(result) || "live".equals(result)) ? "succeeded"
                    : "timeout".equals(result) ? "timed_out" : "failed";
            finish(command, status, result, detail, confirmed);
        })) { finish(command, "failed", "busy", "Another local hardware command is active", null); return; }
        if ("camera".equals(command.device)) service.openLiveView();
        else service.executeBoilerCommand(BoilerCommand.from(android.net.Uri.parse("salonkristina://boiler/" + command.action)));
    }
    private void executeNuki(HardwareCommand command) {
        if (!NukiPermissions.granted(this)) { finish(command, "failed", "permission_missing", "Bluetooth/location permission missing", null); return; }
        NukiCommand action = NukiCommand.from(android.net.Uri.parse("salonkristina://nuki/" + command.action));
        activeNuki = new NukiBleController(this, new NukiBleController.Listener() {
            @Override public void onProgress(String message) {}
            @Override public void onSuccess(String message) { activeNuki = null; finish(command, "succeeded", "confirmed", message, null); }
            @Override public void onError(String message, Throwable error) { activeNuki = null; finish(command, "failed", "nuki_error", message, null); }
        });
        activeNuki.execute(action);
    }
    private void finish(HardwareCommand command, String status, String code, String detail, String confirmed) {
        worker.execute(() -> uploadCompletion(command, status, code, detail, confirmed, 0));
    }
    private void uploadCompletion(HardwareCommand command, String status, String code, String detail, String confirmed, int attempt) {
        try {
            client.complete(command.id, status, code, detail == null ? "" : detail, confirmed);
            busy = false; requestImmediatePoll();
        } catch (Exception error) {
            AutomationLog.error("Gateway result upload", error.getMessage(), error);
            long delay = Math.min(120_000L, 5_000L << Math.min(attempt, 4));
            main.postDelayed(() -> worker.execute(() -> uploadCompletion(command, status, code, detail, confirmed, attempt + 1)), delay);
        }
    }
    private Notification notification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Salon hardware gateway", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, DoorCommandActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Salon hardware gateway aktivan").setContentText("Čeka sigurne naredbe iz Admin panela")
                .setOngoing(true).setContentIntent(pending).build();
    }
}
