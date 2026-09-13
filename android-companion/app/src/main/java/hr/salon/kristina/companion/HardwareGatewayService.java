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
    static final long NUKI_AUTO_LOCK_DELAY_MS = 20_000L;
    static final long NUKI_STATE_REFRESH_MS = 600_000L;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean busy;
    private volatile boolean claimInFlight;
    private boolean autoLockScheduled;
    private boolean autoLockInFlight;
    private boolean nukiStateReadInFlight;
    private HardwareGatewayClient client;
    private NukiBleController activeNuki;
    private HardwareRealtimeClient realtime;
    private boolean started;
    private final Runnable poll = this::pollNow;
    private final Runnable heartbeat = this::heartbeatNow;
    private final Runnable nukiAutoLock = this::runNukiAutoLock;
    private final Runnable nukiStateRefresh = this::refreshNukiState;

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
            main.postDelayed(nukiStateRefresh, NUKI_STATE_REFRESH_MS);
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
        if (!busy && !claimInFlight && !autoLockInFlight && !nukiStateReadInFlight) {
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
        if (busy || autoLockInFlight || nukiStateReadInFlight) return;
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
        NukiCommand action = command.schedulesNukiAutoLock()
                ? NukiCommand.OPEN_DOOR
                : NukiCommand.from(android.net.Uri.parse("salonkristina://nuki/" + command.action));
        if (command.schedulesNukiAutoLock()) cancelPendingNukiAutoLock();
        activeNuki = new NukiBleController(this, new NukiBleController.Listener() {
            private String confirmedState = "unknown";
            @Override public void onProgress(String message) {}
            @Override public void onState(String state) { confirmedState = state; }
            @Override public void onActionSuccess() {
                if (command.schedulesNukiAutoLock()) {
                    main.post(() -> {
                        AutomationLog.step("Gateway Nuki unlock successful", "command=" + command.id);
                        scheduleNukiAutoLock();
                    });
                }
            }
            @Override public void onSuccess(String message) {
                activeNuki = null;
                finish(command, "succeeded", "confirmed", message, confirmedState);
            }
            @Override public void onError(String message, Throwable error) { activeNuki = null; finish(command, "failed", "nuki_error", message, null); }
        });
        activeNuki.executeAndReadState(action);
    }
    private void cancelPendingNukiAutoLock() {
        if (!autoLockScheduled) return;
        main.removeCallbacks(nukiAutoLock);
        autoLockScheduled = false;
        AutomationLog.step("Gateway Nuki auto-lock timer reset", "new unlock received");
    }
    private void scheduleNukiAutoLock() {
        main.removeCallbacks(nukiAutoLock);
        autoLockScheduled = true;
        main.postDelayed(nukiAutoLock, NUKI_AUTO_LOCK_DELAY_MS);
        AutomationLog.step("Gateway Nuki auto-lock scheduled", "delayMs=" + NUKI_AUTO_LOCK_DELAY_MS);
    }
    private void runNukiAutoLock() {
        autoLockScheduled = false;
        if (busy || activeNuki != null) {
            autoLockScheduled = true;
            main.postDelayed(nukiAutoLock, 1_000L);
            return;
        }
        if (!NukiPermissions.granted(this)) {
            AutomationLog.error("Gateway Nuki auto-lock result", "Bluetooth/location permission missing", null);
            return;
        }
        autoLockInFlight = true;
        AutomationLog.step("Gateway Nuki auto-lock started");
        activeNuki = new NukiBleController(this, new NukiBleController.Listener() {
            private String confirmedState = "unknown";
            @Override public void onProgress(String message) {}
            @Override public void onState(String state) { confirmedState = state; }
            @Override public void onSuccess(String message) {
                activeNuki = null;
                autoLockInFlight = false;
                AutomationLog.step("Gateway Nuki auto-lock result", "success: " + message);
                publishNukiState(confirmedState, "auto-lock: " + message);
                requestImmediatePoll();
            }
            @Override public void onError(String message, Throwable error) {
                activeNuki = null;
                autoLockInFlight = false;
                AutomationLog.error("Gateway Nuki auto-lock result", message, error);
                requestImmediatePoll();
            }
        });
        activeNuki.executeAndReadState(NukiCommand.LOCK);
    }
    private void refreshNukiState() {
        main.removeCallbacks(nukiStateRefresh);
        main.postDelayed(nukiStateRefresh, NUKI_STATE_REFRESH_MS);
        if (busy || claimInFlight || autoLockInFlight || nukiStateReadInFlight
                || activeNuki != null || !NukiPermissions.granted(this)) return;
        nukiStateReadInFlight = true;
        activeNuki = new NukiBleController(this, new NukiBleController.Listener() {
            private String state = "unknown";
            @Override public void onProgress(String message) {}
            @Override public void onState(String value) { state = value; }
            @Override public void onSuccess(String message) {
                activeNuki = null;
                nukiStateReadInFlight = false;
                publishNukiState(state, message);
                requestImmediatePoll();
            }
            @Override public void onError(String message, Throwable error) {
                activeNuki = null;
                nukiStateReadInFlight = false;
                AutomationLog.error("Gateway periodic Nuki state read", message, error);
                requestImmediatePoll();
            }
        });
        activeNuki.readState();
    }
    private void publishNukiState(String state, String detail) {
        worker.execute(() -> {
            try { client.reportNukiState(state, detail); }
            catch (Exception error) { AutomationLog.error("Gateway Nuki state publish", error.getMessage(), error); }
        });
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
