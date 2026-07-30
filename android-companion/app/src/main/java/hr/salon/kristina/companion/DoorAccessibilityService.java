package hr.salon.kristina.companion;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.graphics.Path;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import java.util.ArrayDeque;
import java.util.List;
import java.util.Locale;

public final class DoorAccessibilityService extends AccessibilityService {
    private enum Phase {
        IDLE,
        WAITING_FOR_DEVICE,
        WAITING_FOR_LIVE,
        LIVE_CONFIRMED
    }

    private static volatile DoorAccessibilityService connectedInstance;
    private static final Handler returnHandler = new Handler(Looper.getMainLooper());
    private static Runnable autoReturnRunnable;
    private static Runnable notificationWatchdogRunnable;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Phase phase = Phase.IDLE;
    private long phaseDeadlineMs;
    private boolean commandActive;
    private boolean deviceClicked;
    private boolean doubleTapDispatched;
    private boolean existingLiveDismissed;
    private String lastWindowClass = "";
    private long automationStartedAtMs;
    private long tapoLaunchedAtMs;

    private final Runnable automationRunnable = new Runnable() {
        @Override
        public void run() {
            if (!commandActive) {
                return;
            }
            if (phase == Phase.WAITING_FOR_DEVICE) {
                searchAndOpenDevice();
            } else if (phase == Phase.WAITING_FOR_LIVE) {
                waitForLiveView();
            }
        }
    };

    public static DoorAccessibilityService getConnectedInstance() {
        return connectedInstance;
    }

    @Override
    protected void onServiceConnected() {
        connectedInstance = this;
        AutomationLog.step("Accessibility service connected");
        if (isReturnActive(this)) {
            ensureReturnNotification(this);
            startNotificationWatchdog(this);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!commandActive || event == null) {
            return;
        }
        CharSequence packageName = event.getPackageName();
        if (packageName == null
                || !CompanionConfig.TAPO_PACKAGE.contentEquals(packageName)
                || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return;
        }
        CharSequence className = event.getClassName();
        lastWindowClass = className == null ? "" : className.toString();
        if (phase == Phase.WAITING_FOR_LIVE && isLiveViewClass(lastWindowClass)) {
            confirmLiveView("activity-event");
        }
    }

    @Override
    public void onInterrupt() {
        fail("Accessibility service interrupted");
    }

    @Override
    public void onDestroy() {
        if (connectedInstance == this) {
            connectedInstance = null;
        }
        cancelLocalAutomation();
        super.onDestroy();
    }

    public void openLiveView() {
        cancelPendingWork();
        AutomationLog.begin();
        automationStartedAtMs = SystemClock.elapsedRealtime();
        tapoLaunchedAtMs = 0L;
        commandActive = true;
        deviceClicked = false;
        doubleTapDispatched = false;
        existingLiveDismissed = false;
        lastWindowClass = "";
        phase = Phase.WAITING_FOR_DEVICE;
        setReturnActive(true);
        showReturnNotification();
        startNotificationWatchdog(this);
        long autoReturnDurationMs = AutoReturnPreferences.load(this);
        if (autoReturnDurationMs == AutoReturnPreferences.NEVER) {
            AutomationLog.step("Auto-return disabled");
        } else {
            scheduleAutoReturn(autoReturnDurationMs);
        }

        if (performGlobalAction(GLOBAL_ACTION_HOME)) {
            AutomationLog.step("Home sent");
        } else {
            AutomationLog.error("Home sent", "global action rejected", null);
        }

        AutomationLog.step(
                "Waiting for Home",
                "delayMs=" + CompanionConfig.HOME_SETTLE_DELAY_MS);
        handler.postDelayed(this::launchTapo, CompanionConfig.HOME_SETTLE_DELAY_MS);
    }

    private void launchTapo() {
        if (!commandActive || phase != Phase.WAITING_FOR_DEVICE) {
            return;
        }
        Intent launchIntent = getPackageManager()
                .getLaunchIntentForPackage(CompanionConfig.TAPO_PACKAGE);
        if (launchIntent == null || launchIntent.getComponent() == null) {
            fail("Tapo launcher activity could not be resolved");
            return;
        }
        launchIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        AutomationLog.step(
                "Tapo launch method",
                "PackageManager front-door component="
                        + launchIntent.getComponent().flattenToShortString()
                        + " elapsedMs=" + elapsedSinceAutomationStart());
        try {
            startActivity(launchIntent);
            tapoLaunchedAtMs = SystemClock.elapsedRealtime();
        } catch (RuntimeException error) {
            AutomationLog.error("Launching Tapo", "startActivity failed", error);
            fail("Tapo application could not be launched");
            return;
        }

        phaseDeadlineMs = SystemClock.uptimeMillis()
                + CompanionConfig.TAPO_STARTUP_WAIT_MS
                + CompanionConfig.DEVICE_SEARCH_TIMEOUT_MS;
        AutomationLog.step(
                "Waiting for Tapo UI",
                "startupDelayMs=" + CompanionConfig.TAPO_STARTUP_WAIT_MS
                        + " timeoutMs=" + CompanionConfig.DEVICE_SEARCH_TIMEOUT_MS);
        handler.postDelayed(automationRunnable, CompanionConfig.TAPO_STARTUP_WAIT_MS);
    }

    private void searchAndOpenDevice() {
        if (!existingLiveDismissed
                && (isLiveViewClass(lastWindowClass) || isLiveUiVisible())) {
            existingLiveDismissed = true;
            AutomationLog.step(
                    "Existing live detected",
                    "sending Back to establish Tapo Home");
            boolean backSent = performGlobalAction(GLOBAL_ACTION_BACK);
            AutomationLog.step("Back to Tapo Home result", "success=" + backSent);
            if (!backSent) {
                fail("Existing live view could not be closed");
                return;
            }
            lastWindowClass = "";
            handler.postDelayed(automationRunnable, CompanionConfig.SEARCH_INTERVAL_MS);
            return;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        AccessibilityNodeInfo device = root == null ? null : findDeviceNode(root);
        if (device != null) {
            AutomationLog.step(
                    "Device text found",
                    "text=" + readableNodeText(device)
                            + " elapsedMs=" + elapsedSinceAutomationStart()
                            + " sinceTapoLaunchMs=" + elapsedSinceTapoLaunch());
            AutomationLog.step(
                    "Tapo Home ready",
                    "elapsedMs=" + elapsedSinceAutomationStart()
                            + " sinceTapoLaunchMs=" + elapsedSinceTapoLaunch());
            if (clickNodeOrParent(device)) {
                deviceClicked = true;
                beginWaitingForLive("accessibility-action");
                return;
            }
            if (useCoordinateFallback("ACTION_CLICK returned false")) {
                return;
            }
            fail("ACTION_CLICK failed and coordinate fallback is unavailable");
            return;
        }

        if (SystemClock.uptimeMillis() >= phaseDeadlineMs) {
            AutomationLog.error(
                    "Timeout reason",
                    "device text not found within "
                            + CompanionConfig.DEVICE_SEARCH_TIMEOUT_MS + " ms",
                    null);
            if (!useCoordinateFallback("device node unavailable after timeout")) {
                fail("Device text timeout and coordinate fallback is unavailable");
            }
            return;
        }
        handler.postDelayed(automationRunnable, CompanionConfig.SEARCH_INTERVAL_MS);
    }

    private void waitForLiveView() {
        if (isLiveViewClass(lastWindowClass)) {
            confirmLiveView("cached-activity-event");
            return;
        }
        if (isLiveUiVisible()) {
            confirmLiveView("live-ui-elements");
            return;
        }
        if (SystemClock.uptimeMillis() >= phaseDeadlineMs) {
            AutomationLog.error(
                    "Timeout reason",
                    "live activity not confirmed within "
                            + CompanionConfig.LIVE_CONFIRMATION_TIMEOUT_MS
                            + " ms; lastClass=" + lastWindowClass,
                    null);
            fail("Tapo live activity was not confirmed");
            return;
        }
        handler.postDelayed(automationRunnable, CompanionConfig.SEARCH_INTERVAL_MS);
    }

    private AccessibilityNodeInfo findDeviceNode(AccessibilityNodeInfo root) {
        String[] names = {
                CompanionConfig.PRIMARY_DEVICE_NAME,
                CompanionConfig.ALTERNATIVE_DEVICE_NAME
        };
        for (String name : names) {
            List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(name);
            for (AccessibilityNodeInfo node : matches) {
                String text = node.getText() == null ? "" : node.getText().toString().trim();
                String description = node.getContentDescription() == null
                        ? "" : node.getContentDescription().toString().trim();
                if (name.equalsIgnoreCase(text)
                        || name.equalsIgnoreCase(description)
                        || text.toLowerCase(Locale.ROOT)
                        .contains(name.toLowerCase(Locale.ROOT))) {
                    return node;
                }
            }
        }

        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            String description = node.getContentDescription() == null
                    ? "" : node.getContentDescription().toString();
            if (description.toLowerCase(Locale.ROOT).contains(
                    CompanionConfig.ALTERNATIVE_DEVICE_NAME.toLowerCase(Locale.ROOT))) {
                return node;
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    queue.addLast(child);
                }
            }
        }
        return null;
    }

    private String readableNodeText(AccessibilityNodeInfo node) {
        if (node.getText() != null) {
            return node.getText().toString();
        }
        return node.getContentDescription() == null
                ? "" : node.getContentDescription().toString();
    }

    private boolean clickNodeOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo candidate = node;
        for (int depth = 0;
             candidate != null && depth < CompanionConfig.MAX_CLICK_PARENT_DEPTH;
             depth++) {
            if (candidate.isClickable()) {
                AutomationLog.step(
                        "Clickable parent found",
                        "depth=" + depth
                                + " class=" + candidate.getClassName()
                                + " viewId=" + candidate.getViewIdResourceName());
                boolean result = candidate.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                AutomationLog.step("ACTION_CLICK result", "success=" + result);
                return result;
            }
            candidate = candidate.getParent();
        }
        AutomationLog.step("Clickable parent found", "success=false");
        AutomationLog.step("ACTION_CLICK result", "success=false reason=no-clickable-parent");
        return false;
    }

    private boolean useCoordinateFallback(String reason) {
        if (!canUseTabletFallback()) {
            return false;
        }
        AutomationLog.step(
                "Coordinate fallback used",
                "reason=" + reason
                        + " x=" + CompanionConfig.FALLBACK_X
                        + " y=" + CompanionConfig.FALLBACK_Y);
        Path path = new Path();
        path.moveTo(CompanionConfig.FALLBACK_X, CompanionConfig.FALLBACK_Y);
        GestureDescription gesture = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(
                        path, 0, CompanionConfig.FALLBACK_GESTURE_DURATION_MS))
                .build();
        boolean accepted = dispatchGesture(
                gesture,
                new GestureResultCallback() {
                    @Override
                    public void onCompleted(GestureDescription gestureDescription) {
                        AutomationLog.step("Coordinate fallback gesture result", "completed");
                    }

                    @Override
                    public void onCancelled(GestureDescription gestureDescription) {
                        AutomationLog.error(
                                "Coordinate fallback gesture result",
                                "cancelled",
                                null);
                    }
                },
                null);
        AutomationLog.step("Coordinate fallback dispatch result", "accepted=" + accepted);
        if (!accepted) {
            return false;
        }
        deviceClicked = true;
        beginWaitingForLive("coordinate-fallback");
        return true;
    }

    private boolean canUseTabletFallback() {
        String model = Build.MODEL == null ? "" : Build.MODEL.toUpperCase(Locale.ROOT);
        boolean supportedModel = false;
        for (String configuredModel : CompanionConfig.FALLBACK_TABLET_MODELS) {
            if (configuredModel.equals(model)) {
                supportedModel = true;
                break;
            }
        }
        if (!supportedModel) {
            return false;
        }
        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        return metrics.widthPixels == CompanionConfig.FALLBACK_SCREEN_WIDTH
                && metrics.heightPixels == CompanionConfig.FALLBACK_SCREEN_HEIGHT;
    }

    private void beginWaitingForLive(String clickMethod) {
        phase = Phase.WAITING_FOR_LIVE;
        phaseDeadlineMs = SystemClock.uptimeMillis()
                + CompanionConfig.LIVE_CONFIRMATION_TIMEOUT_MS;
        AutomationLog.step(
                "Waiting for live confirmation",
                "clickMethod=" + clickMethod
                        + " timeoutMs=" + CompanionConfig.LIVE_CONFIRMATION_TIMEOUT_MS);
        handler.removeCallbacks(automationRunnable);
        handler.postDelayed(automationRunnable, CompanionConfig.SEARCH_INTERVAL_MS);
    }

    private boolean isLiveUiVisible() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null
                || root.getPackageName() == null
                || !CompanionConfig.TAPO_PACKAGE.contentEquals(root.getPackageName())) {
            return false;
        }
        return hasAnyText(root, "Talk", "Razgovor", "Privacy Mode", "Način privatnosti")
                && hasAnyText(root, "Manual Recording", "Snapshot", "Snimka", "Record", "Snimi");
    }

    private boolean hasAnyText(AccessibilityNodeInfo root, String... labels) {
        for (String label : labels) {
            if (!root.findAccessibilityNodeInfosByText(label).isEmpty()) {
                return true;
            }
        }
        return false;
    }

    private boolean isLiveViewClass(String className) {
        return className.contains("TapoPadVideoPlayV3Activity");
    }

    private void confirmLiveView(String source) {
        if (!commandActive
                || phase != Phase.WAITING_FOR_LIVE
                || !deviceClicked) {
            AutomationLog.step(
                    "Live activity ignored",
                    "source=" + source
                            + " phase=" + phase
                            + " deviceClicked=" + deviceClicked);
            return;
        }
        phase = Phase.LIVE_CONFIRMED;
        handler.removeCallbacks(automationRunnable);
        AutomationLog.step(
                "Live activity confirmed",
                "source=" + source
                        + " class=" + lastWindowClass
                        + " elapsedMs=" + elapsedSinceAutomationStart()
                        + " sinceTapoLaunchMs=" + elapsedSinceTapoLaunch());
        Toast.makeText(this, "Live prikaz je otvoren.", Toast.LENGTH_SHORT).show();
        scheduleDoubleTap();
    }

    private void scheduleDoubleTap() {
        if (doubleTapDispatched) {
            AutomationLog.step("Double-tap skipped", "already dispatched for this command");
            return;
        }
        handler.postDelayed(this::dispatchDoubleTap, CompanionConfig.DOUBLE_TAP_AFTER_LIVE_DELAY_MS);
    }

    private void dispatchDoubleTap() {
        if (!commandActive
                || phase != Phase.LIVE_CONFIRMED
                || doubleTapDispatched) {
            AutomationLog.step(
                    "Double-tap skipped",
                    "commandActive=" + commandActive
                            + " phase=" + phase
                            + " alreadyDispatched=" + doubleTapDispatched);
            return;
        }
        doubleTapDispatched = true;
        Path firstTap = new Path();
        firstTap.moveTo(CompanionConfig.DOUBLE_TAP_X, CompanionConfig.DOUBLE_TAP_Y);
        Path secondTap = new Path();
        secondTap.moveTo(CompanionConfig.DOUBLE_TAP_X, CompanionConfig.DOUBLE_TAP_Y);
        long secondStart = CompanionConfig.TAP_DURATION_MS
                + CompanionConfig.DOUBLE_TAP_GAP_MS;
        GestureDescription gesture = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(
                        firstTap, 0, CompanionConfig.TAP_DURATION_MS))
                .addStroke(new GestureDescription.StrokeDescription(
                        secondTap, secondStart, CompanionConfig.TAP_DURATION_MS))
                .build();
        AutomationLog.step(
                "Double-tap dispatched",
                "x=" + CompanionConfig.DOUBLE_TAP_X
                        + " y=" + CompanionConfig.DOUBLE_TAP_Y
                        + " gapMs=" + CompanionConfig.DOUBLE_TAP_GAP_MS
                        + " elapsedMs=" + elapsedSinceAutomationStart()
                        + " sinceTapoLaunchMs=" + elapsedSinceTapoLaunch());
        boolean accepted = dispatchGesture(
                gesture,
                new GestureResultCallback() {
                    @Override
                    public void onCompleted(GestureDescription gestureDescription) {
                        AutomationLog.step("Double-tap gesture result", "completed");
                    }

                    @Override
                    public void onCancelled(GestureDescription gestureDescription) {
                        AutomationLog.error("Double-tap gesture result", "cancelled", null);
                    }
                },
                null);
        if (!accepted) {
            AutomationLog.error(
                    "Double-tap gesture result",
                    "dispatchGesture returned false",
                    null);
        }
    }

    private void fail(String message) {
        AutomationLog.error("Automation failed", message, null);
        commandActive = false;
        phase = Phase.IDLE;
        handler.removeCallbacks(automationRunnable);
        if (isReturnActive(this)) {
            ensureReturnNotification(this);
        }
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        Intent errorIntent = new Intent(this, DoorCommandActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .setData(new Uri.Builder()
                        .scheme(CompanionConfig.DEEP_LINK_SCHEME)
                        .authority(CompanionConfig.DEEP_LINK_HOST)
                        .path(CompanionConfig.PATH_ERROR)
                        .build())
                .putExtra("message", message);
        startActivity(errorIntent);
    }

    private void cancelPendingWork() {
        cancelLocalAutomation();
        cancelAutoReturn();
        stopNotificationWatchdog();
        setReturnActive(false);
        cancelNotification();
    }

    private void cancelLocalAutomation() {
        commandActive = false;
        phase = Phase.IDLE;
        handler.removeCallbacksAndMessages(null);
    }

    private void showReturnNotification() {
        showReturnNotification(this, true);
    }

    private static void showReturnNotification(Context context, boolean log) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(
                CompanionConfig.NOTIFICATION_CHANNEL_ID,
                context.getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_HIGH));
        Intent returnIntent = new Intent(context, ReturnToSalonActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                returnIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(
                context, CompanionConfig.NOTIFICATION_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Salon Kristina")
                .setContentText("Natrag u salon")
                .setCategory(Notification.CATEGORY_SERVICE)
                .setPriority(Notification.PRIORITY_HIGH)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(pendingIntent)
                .addAction(new Notification.Action.Builder(
                        null, "Natrag u salon", pendingIntent).build())
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .build();
        manager.notify(CompanionConfig.NOTIFICATION_ID, notification);
        if (log) {
            AutomationLog.step("Return notification shown");
        }
    }

    private void cancelNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.cancel(CompanionConfig.NOTIFICATION_ID);
    }

    public static void requestManualReturn(Context context) {
        executeReturn(true, context);
    }

    public static void requestAutoReturn(Context context) {
        executeReturn(false, context);
    }

    private static synchronized void executeReturn(boolean manual, Context context) {
        if (!isReturnActive(context)) {
            AutomationLog.step(
                    "Return request ignored",
                    "manual=" + manual + " active=false");
            return;
        }
        setReturnActive(context, false);
        cancelAutoReturn(context);
        stopNotificationWatchdog();
        if (manual) {
            AutomationLog.step("Manual return requested");
            AutomationLog.step("Auto-return cancelled");
        } else {
            AutomationLog.step("Auto-return executed");
        }
        DoorAccessibilityService instance = connectedInstance;
        if (instance != null) {
            instance.cancelLocalAutomation();
            instance.deviceClicked = false;
            instance.doubleTapDispatched = false;
        }
        cancelNotification(context);
        AutomationLog.step("Return notification removed");
        AutomationLog.step("Automation state cleared");
        launchSalon(context);
    }

    private static void startNotificationWatchdog(Context context) {
        Context applicationContext = context.getApplicationContext();
        stopNotificationWatchdog();
        notificationWatchdogRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isReturnActive(applicationContext)) {
                    notificationWatchdogRunnable = null;
                    return;
                }
                ensureReturnNotification(applicationContext);
                returnHandler.postDelayed(
                        this,
                        CompanionConfig.NOTIFICATION_WATCHDOG_INTERVAL_MS);
            }
        };
        returnHandler.postDelayed(
                notificationWatchdogRunnable,
                CompanionConfig.NOTIFICATION_WATCHDOG_INTERVAL_MS);
    }

    private static void stopNotificationWatchdog() {
        if (notificationWatchdogRunnable != null) {
            returnHandler.removeCallbacks(notificationWatchdogRunnable);
            notificationWatchdogRunnable = null;
        }
    }

    private static void ensureReturnNotification(Context context) {
        if (!isReturnNotificationActive(context)) {
            showReturnNotification(context, false);
            AutomationLog.step("Return notification restored");
        }
    }

    private static boolean isReturnNotificationActive(Context context) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        for (StatusBarNotification notification : manager.getActiveNotifications()) {
            if (notification.getId() == CompanionConfig.NOTIFICATION_ID) {
                return true;
            }
        }
        return false;
    }

    private void scheduleAutoReturn(long durationMs) {
        Context applicationContext = getApplicationContext();
        if (autoReturnRunnable != null) {
            returnHandler.removeCallbacks(autoReturnRunnable);
        }
        autoReturnRunnable = () -> requestAutoReturn(applicationContext);
        returnHandler.postDelayed(
                autoReturnRunnable,
                durationMs);

        AlarmManager manager = (AlarmManager) getSystemService(ALARM_SERVICE);
        manager.set(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + durationMs,
                getAutoReturnPendingIntent(this));
        AutomationLog.step(
                "Auto-return scheduled duration=" + durationMs);
    }

    private void cancelAutoReturn() {
        cancelAutoReturn(this);
    }

    private static void cancelAutoReturn(Context context) {
        if (autoReturnRunnable != null) {
            returnHandler.removeCallbacks(autoReturnRunnable);
            autoReturnRunnable = null;
        }
        AlarmManager manager = (AlarmManager) context.getSystemService(ALARM_SERVICE);
        manager.cancel(getAutoReturnPendingIntent(context));
    }

    private static PendingIntent getAutoReturnPendingIntent(Context context) {
        return PendingIntent.getBroadcast(
                context,
                0,
                new Intent(context, AutoReturnReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void setReturnActive(boolean active) {
        setReturnActive(this, active);
    }

    private static void setReturnActive(Context context, boolean active) {
        context.getSharedPreferences("door_return_state", MODE_PRIVATE)
                .edit()
                .putBoolean("active", active)
                .apply();
    }

    private static boolean isReturnActive(Context context) {
        return context.getSharedPreferences("door_return_state", MODE_PRIVATE)
                .getBoolean("active", false);
    }

    private static void cancelNotification(Context context) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        manager.cancel(CompanionConfig.NOTIFICATION_ID);
    }

    private long elapsedSinceAutomationStart() {
        return automationStartedAtMs == 0L
                ? -1L
                : SystemClock.elapsedRealtime() - automationStartedAtMs;
    }

    private long elapsedSinceTapoLaunch() {
        return tapoLaunchedAtMs == 0L
                ? -1L
                : SystemClock.elapsedRealtime() - tapoLaunchedAtMs;
    }

    private static void launchSalon(Context context) {
        Intent webApkIntent = findSalonWebApkIntent(context);
        if (webApkIntent != null) {
            try {
                context.startActivity(webApkIntent);
                AutomationLog.step(
                        "Salon WebAPK launched",
                        "package=" + webApkIntent.getPackage());
                return;
            } catch (RuntimeException error) {
                AutomationLog.error(
                        "Returning to Salon",
                        "WebAPK launch failed; using URL fallback",
                        error);
            }
        } else {
            AutomationLog.step("Salon WebAPK not found", "using URL fallback");
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(CompanionConfig.SALON_URL))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(intent);
        AutomationLog.step("Salon URL launched");
    }

    private static Intent findSalonWebApkIntent(Context context) {
        Intent launcherQuery = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> launchers = context.getPackageManager()
                .queryIntentActivities(launcherQuery, 0);
        for (ResolveInfo info : launchers) {
            String packageName = info.activityInfo.packageName;
            String label = info.loadLabel(context.getPackageManager()).toString();
            for (String expectedLabel : CompanionConfig.SALON_WEBAPK_LABELS) {
                if (expectedLabel.equalsIgnoreCase(label)) {
                    Intent launchIntent = context.getPackageManager()
                            .getLaunchIntentForPackage(packageName);
                    if (launchIntent != null) {
                        return launchIntent.addFlags(
                                Intent.FLAG_ACTIVITY_NEW_TASK
                                        | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    }
                }
            }
        }
        return null;
    }
}
