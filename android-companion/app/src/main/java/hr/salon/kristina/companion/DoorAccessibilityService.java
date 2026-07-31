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
import android.content.res.Configuration;
import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.Button;
import android.widget.LinearLayout;
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

    private enum AutomationState {
        IDLE,
        OPENING,
        LIVE,
        RETURNING
    }

    private static volatile DoorAccessibilityService connectedInstance;
    private static final Handler returnHandler = new Handler(Looper.getMainLooper());
    private static Runnable autoReturnRunnable;
    private static Runnable notificationWatchdogRunnable;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Phase phase = Phase.IDLE;
    private AutomationState automationState = AutomationState.IDLE;
    private long phaseDeadlineMs;
    private boolean commandActive;
    private boolean deviceClicked;
    private boolean doubleTapDispatched;
    private boolean liveZoomKnownActive;
    private String lastWindowClass = "";
    private long automationStartedAtMs;
    private long tapoLaunchedAtMs;
    private long liveTimeoutAtMs;
    private boolean openingFromDoorbell;
    private WindowManager overlayWindowManager;
    private View returnOverlay;

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
            automationState = isLiveUiVisible()
                    ? AutomationState.LIVE
                    : AutomationState.OPENING;
            ensureReturnNotification(this);
            startNotificationWatchdog(this);
            handler.postDelayed(this::restoreOverlayIfLive, 500L);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) {
            return;
        }
        if (event.getEventType() == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
            handleTapoNotification(event);
            return;
        }
        CharSequence packageName = event.getPackageName();
        if (packageName == null || !CompanionConfig.TAPO_PACKAGE.contentEquals(packageName)) {
            return;
        }
        CharSequence className = event.getClassName();
        String observedClass = className == null ? "" : className.toString();
        AutomationLog.step(
                "Tapo AccessibilityEvent",
                "type=" + AccessibilityEvent.eventTypeToString(event.getEventType())
                        + " class=" + observedClass
                        + " commandActive=" + commandActive
                        + " phase=" + phase
                        + " deviceClicked=" + deviceClicked);
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            lastWindowClass = observedClass;
            AutomationLog.step(
                    "Foreground Activity observed",
                    "class=" + lastWindowClass
                            + " commandActive=" + commandActive
                            + " phase=" + phase);
            if (phase == Phase.LIVE_CONFIRMED) {
                if (isLiveViewClass(observedClass)) {
                    showReturnOverlay();
                } else if (isActivityClass(observedClass)) {
                    liveZoomKnownActive = false;
                    removeReturnOverlay("Tapo live activity left");
                }
            }
        }
        if (!commandActive) {
            if (isLiveViewClass(observedClass) && liveTimeoutAtMs > 0L) {
                AutomationLog.error(
                        "Late live activity observed",
                        "class=" + observedClass
                                + " afterTimeoutMs="
                                + (SystemClock.elapsedRealtime() - liveTimeoutAtMs),
                        null);
            }
            return;
        }
        if (phase == Phase.WAITING_FOR_LIVE && isLiveViewClass(observedClass)) {
            confirmLiveView("activity-event");
        }
    }

    private void handleTapoNotification(AccessibilityEvent event) {
        Object payload = event.getParcelableData();
        if (!(payload instanceof Notification)) {
            AutomationLog.step(
                    "DOORBELL_IGNORED",
                    "reason=notification-payload-missing state=" + automationState);
            return;
        }
        Notification notification = (Notification) payload;
        CharSequence eventPackage = event.getPackageName();
        ApplicationInfo applicationInfo = notification.extras == null
                ? null
                : notification.extras.getParcelable("android.appInfo");
        String notificationPackage = applicationInfo == null
                ? null
                : applicationInfo.packageName;
        if (!CompanionConfig.TAPO_PACKAGE.equals(notificationPackage)) {
            AutomationLog.step(
                    "DOORBELL_IGNORED",
                    "reason=package eventPackage=" + eventPackage
                            + " notificationPackage=" + notificationPackage);
            return;
        }
        String channelId = notification.getChannelId();
        CharSequence title = notification.extras == null
                ? null
                : notification.extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = notification.extras == null
                ? null
                : notification.extras.getCharSequence(Notification.EXTRA_TEXT);
        if (!CompanionConfig.TAPO_DOORBELL_CHANNEL_ID.equals(channelId)) {
            AutomationLog.step(
                    "DOORBELL_IGNORED",
                    "reason=channel channelId=" + channelId
                            + " title=" + title);
            return;
        }
        AutomationLog.step(
                "DOORBELL_NOTIFICATION",
                "channelId=" + channelId
                        + " title=" + title
                        + " text=" + text
                        + " state=" + automationState);
        if (!CompanionConfig.ENABLE_DOORBELL_AUTOMATION) {
            AutomationLog.step(
                    "DOORBELL_IGNORED",
                    "reason=automation-disabled-for-manual-comparison");
            return;
        }
        if (automationState != AutomationState.IDLE) {
            AutomationLog.step(
                    "DOORBELL_IGNORED",
                    "reason=automation-active state=" + automationState);
            if (automationState == AutomationState.LIVE) {
                showReturnOverlay();
            }
            return;
        }
        openLiveView("doorbell");
    }

    private AccessibilityNodeInfo findExactTextNode(
            AccessibilityNodeInfo root,
            String expectedText) {
        if (root == null) {
            return null;
        }
        for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(expectedText)) {
            CharSequence text = node.getText();
            CharSequence description = node.getContentDescription();
            if ((text != null && expectedText.equalsIgnoreCase(text.toString().trim()))
                    || (description != null
                    && expectedText.equalsIgnoreCase(description.toString().trim()))) {
                return node;
            }
        }
        return null;
    }

    @Override
    public void onInterrupt() {
        AutomationLog.error(
                "Accessibility service interrupted",
                "commandActive=" + commandActive + " phase=" + phase,
                null);
        if (commandActive) {
            fail("Accessibility service interrupted");
        } else if (isReturnActive(this)) {
            ensureReturnNotification(this);
            startNotificationWatchdog(this);
        }
    }

    @Override
    public void onDestroy() {
        AutomationLog.audit(
                "Accessibility service destroyed",
                "commandActive=" + commandActive
                        + " phase=" + phase
                        + " returnActive=" + isReturnActive(this)
                        + " watchdogActive="
                        + (notificationWatchdogRunnable != null));
        if (connectedInstance == this) {
            connectedInstance = null;
        }
        removeReturnOverlay("Accessibility service destroyed");
        cancelLocalAutomation();
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (returnOverlay != null) {
            overlayWindowManager.updateViewLayout(
                    returnOverlay,
                    createOverlayLayoutParams());
            AutomationLog.step(
                    "Return overlay repositioned",
                    "orientation=" + newConfig.orientation);
        }
    }

    public void openLiveView() {
        openLiveView("button");
    }

    private void openLiveView(String source) {
        cancelPendingWork();
        AutomationLog.begin();
        automationState = AutomationState.OPENING;
        openingFromDoorbell = "doorbell".equals(source);
        AutomationLog.step(
                "doorbell".equals(source)
                        ? "OPENING_FROM_DOORBELL"
                        : "OPENING_FROM_BUTTON");
        automationStartedAtMs = SystemClock.elapsedRealtime();
        tapoLaunchedAtMs = 0L;
        liveTimeoutAtMs = 0L;
        commandActive = true;
        deviceClicked = false;
        doubleTapDispatched = false;
        boolean tapoForeground = isTapoForeground();
        boolean liveAlreadyOpen = tapoForeground
                && (isLiveViewClass(lastWindowClass) || isLiveUiVisible());
        phase = Phase.WAITING_FOR_DEVICE;
        setReturnActive(true);
        showReturnNotification();
        startNotificationWatchdog(this);
        long autoReturnDurationMs = AutoReturnPreferences.load(this);
        if (autoReturnDurationMs == AutoReturnPreferences.NEVER) {
            cancelAutoReturn();
            AutomationLog.step("Auto-return disabled");
        } else {
            scheduleAutoReturn(autoReturnDurationMs);
        }

        if (liveAlreadyOpen) {
            AutomationLog.step(
                    "Existing live accepted",
                    "source=command-start zoomActive=" + isZoomActive());
            adoptExistingLive("command-start");
            return;
        }

        liveZoomKnownActive = false;
        lastWindowClass = "";
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
        if (openingFromDoorbell) {
            AccessibilityNodeInfo ignoreNode = findExactTextNode(getTapoRoot(), "Ignore");
            if (ignoreNode != null) {
                boolean clicked = clickNodeOrParent(ignoreNode);
                AutomationLog.step("Doorbell Ignore ACTION_CLICK", "success=" + clicked);
                if (clicked) {
                    openingFromDoorbell = false;
                    handler.postDelayed(
                            automationRunnable,
                            CompanionConfig.DOORBELL_IGNORE_SETTLE_DELAY_MS);
                    return;
                }
            }
        }
        if (isTapoForeground()
                && (isLiveViewClass(lastWindowClass) || isLiveUiVisible())) {
            AutomationLog.step(
                    "Existing live accepted",
                    "source=post-launch zoomActive=" + isZoomActive());
            adoptExistingLive("post-launch");
            return;
        }
        AccessibilityNodeInfo root = getTapoRoot();
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
            liveTimeoutAtMs = SystemClock.elapsedRealtime();
            AutomationLog.error(
                    "Timeout reason",
                    "live activity not confirmed within "
                            + CompanionConfig.LIVE_CONFIRMATION_TIMEOUT_MS
                            + " ms; lastClass=" + lastWindowClass
                            + " rootClass=" + activeRootClass()
                            + " liveUiVisible=" + isLiveUiVisible(),
                    null);
            AutomationLog.error(
                    "Companion giving up",
                    "phase=" + phase
                            + " deviceClicked=" + deviceClicked
                            + " elapsedMs=" + elapsedSinceAutomationStart(),
                    null);
            fail("Tapo live activity was not confirmed");
            return;
        }
        handler.postDelayed(automationRunnable, CompanionConfig.SEARCH_INTERVAL_MS);
    }

    private String activeRootClass() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        return root == null || root.getClassName() == null
                ? ""
                : root.getClassName().toString();
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
                    if (hasVisibleClickableParent(node)) {
                        return node;
                    }
                    AutomationLog.step(
                            "Device match ignored",
                            "reason=off-screen-or-no-visible-clickable-parent"
                                    + " text=" + readableNodeText(node)
                                    + " bounds=" + nodeBounds(node));
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
                if (hasVisibleClickableParent(node)) {
                    return node;
                }
                AutomationLog.step(
                        "Device match ignored",
                        "reason=off-screen-or-no-visible-clickable-parent"
                                + " text=" + readableNodeText(node)
                                + " bounds=" + nodeBounds(node));
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

    private boolean hasVisibleClickableParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo candidate = node;
        for (int depth = 0;
             candidate != null && depth < CompanionConfig.MAX_CLICK_PARENT_DEPTH;
             depth++) {
            if (candidate.isClickable()) {
                return candidate.isEnabled() && isFullyOnScreen(candidate);
            }
            candidate = candidate.getParent();
        }
        return false;
    }

    private boolean isFullyOnScreen(AccessibilityNodeInfo node) {
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        WindowManager windowManager =
                (WindowManager) getSystemService(WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        return node.isVisibleToUser()
                && !bounds.isEmpty()
                && bounds.left >= 0
                && bounds.top >= 0
                && bounds.right <= metrics.widthPixels
                && bounds.bottom <= metrics.heightPixels;
    }

    private String readableNodeText(AccessibilityNodeInfo node) {
        if (node.getText() != null) {
            return node.getText().toString();
        }
        return node.getContentDescription() == null
                ? "" : node.getContentDescription().toString();
    }

    private String nodeBounds(AccessibilityNodeInfo node) {
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        return bounds.toShortString();
    }

    private boolean clickNodeOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo candidate = node;
        for (int depth = 0;
             candidate != null && depth < CompanionConfig.MAX_CLICK_PARENT_DEPTH;
             depth++) {
            AutomationLog.step(
                    "Click candidate inspected",
                    "depth=" + depth
                            + " class=" + candidate.getClassName()
                            + " viewId=" + candidate.getViewIdResourceName()
                            + " clickable=" + candidate.isClickable()
                            + " enabled=" + candidate.isEnabled()
                            + " bounds=" + nodeBounds(candidate));
            if (candidate.isClickable() && candidate.isEnabled()
                    && isFullyOnScreen(candidate)) {
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
        AccessibilityNodeInfo root = getTapoRoot();
        if (root == null
                || root.getPackageName() == null
                || !CompanionConfig.TAPO_PACKAGE.contentEquals(root.getPackageName())) {
            return false;
        }
        return hasAnyText(root, "Talk", "Razgovor", "Privacy Mode", "Način privatnosti")
                && hasAnyText(root, "Manual Recording", "Snapshot", "Snimka", "Record", "Snimi");
    }

    private boolean isTapoForeground() {
        AccessibilityNodeInfo root = getTapoRoot();
        return root != null
                && root.getPackageName() != null
                && CompanionConfig.TAPO_PACKAGE.contentEquals(root.getPackageName());
    }

    private boolean isZoomActive() {
        if (liveZoomKnownActive) {
            return true;
        }
        AccessibilityNodeInfo root = getTapoRoot();
        if (root == null
                || root.getPackageName() == null
                || !CompanionConfig.TAPO_PACKAGE.contentEquals(root.getPackageName())) {
            return false;
        }
        List<AccessibilityNodeInfo> scaleNodes = root.findAccessibilityNodeInfosByViewId(
                CompanionConfig.TAPO_PACKAGE + ":id/tv_scale_value_1");
        for (AccessibilityNodeInfo node : scaleNodes) {
            if (isZoomValue(node.getText()) || isZoomValue(node.getContentDescription())) {
                liveZoomKnownActive = true;
                return true;
            }
        }
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.removeFirst();
            if (isZoomValue(node.getText()) || isZoomValue(node.getContentDescription())) {
                liveZoomKnownActive = true;
                return true;
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    queue.addLast(child);
                }
            }
        }
        return false;
    }

    private AccessibilityNodeInfo getTapoRoot() {
        AccessibilityNodeInfo activeRoot = getRootInActiveWindow();
        if (activeRoot != null
                && activeRoot.getPackageName() != null
                && CompanionConfig.TAPO_PACKAGE.contentEquals(activeRoot.getPackageName())) {
            return activeRoot;
        }
        for (AccessibilityWindowInfo window : getWindows()) {
            AccessibilityNodeInfo root = window.getRoot();
            if (root != null
                    && root.getPackageName() != null
                    && CompanionConfig.TAPO_PACKAGE.contentEquals(root.getPackageName())) {
                AutomationLog.step(
                        "Tapo window selected behind overlay",
                        "activePackage="
                                + (activeRoot == null ? null : activeRoot.getPackageName()));
                return root;
            }
        }
        return null;
    }

    private boolean isZoomValue(CharSequence value) {
        if (value == null) {
            return false;
        }
        String normalized = value.toString()
                .trim()
                .toLowerCase(Locale.ROOT)
                .replace(',', '.')
                .replace('×', 'x');
        return normalized.startsWith("2.5x");
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

    private boolean isActivityClass(String className) {
        return className.endsWith("Activity");
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
        AutomationLog.step(
                "Live activity confirmed",
                "source=" + source
                        + " class=" + lastWindowClass
                        + " elapsedMs=" + elapsedSinceAutomationStart()
                        + " sinceTapoLaunchMs=" + elapsedSinceTapoLaunch());
        completeLiveEntry(source);
        scheduleDoubleTap();
    }

    private void adoptExistingLive(String source) {
        AutomationLog.step("LIVE_ALREADY_OPEN", "source=" + source);
        deviceClicked = true;
        completeLiveEntry(source);
        if (isZoomActive()) {
            doubleTapDispatched = true;
            commandActive = false;
            AutomationLog.step(
                    "Existing live already zoomed",
                    "source=" + source
                            + " elapsedMs=" + elapsedSinceAutomationStart());
            return;
        }
        AutomationLog.step(
                "Existing live awaiting zoom stabilization",
                "source=" + source
                        + " delayMs=" + CompanionConfig.DOUBLE_TAP_AFTER_LIVE_DELAY_MS);
        scheduleDoubleTap();
    }

    private void completeLiveEntry(String source) {
        phase = Phase.LIVE_CONFIRMED;
        automationState = AutomationState.LIVE;
        handler.removeCallbacks(automationRunnable);
        showReturnOverlay();
        AutomationLog.step("LIVE_READY", "source=" + source);
        AutomationLog.step(
                "Live entry completed",
                "source=" + source
                        + " overlayVisible=" + (returnOverlay != null));
    }

    private void restoreOverlayIfLive() {
        if (isReturnActive(this) && isLiveUiVisible()) {
            automationState = AutomationState.LIVE;
            showReturnOverlay();
        }
    }

    private void showReturnOverlay() {
        if (returnOverlay != null || !isReturnActive(this)) {
            return;
        }
        overlayWindowManager =
                (WindowManager) getSystemService(WINDOW_SERVICE);
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setGravity(Gravity.END);

        Button returnButton = createOverlayButton("← Salon", Color.rgb(109, 76, 65));
        returnButton.setOnClickListener(view -> {
            AutomationLog.step("Return overlay clicked");
            requestManualReturn(this);
        });

        Button openDoorButton = createOverlayButton(
                "🔓 Otvori vrata",
                Color.rgb(111, 103, 98));
        openDoorButton.setAlpha(0.86F);
        openDoorButton.setOnClickListener(view -> {
            AutomationLog.step("Door open placeholder clicked");
            Toast.makeText(
                    this,
                    "Brava još nije povezana.",
                    Toast.LENGTH_SHORT).show();
        });
        LinearLayout.LayoutParams openDoorParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        openDoorParams.topMargin = dp(CompanionConfig.RETURN_OVERLAY_BUTTON_GAP_DP);

        controls.addView(returnButton);
        controls.addView(openDoorButton, openDoorParams);
        returnOverlay = controls;
        try {
            overlayWindowManager.addView(
                    returnOverlay,
                    createOverlayLayoutParams());
            AutomationLog.step("Return overlay shown");
            AutomationLog.step("RETURN_OVERLAY_SHOWN");
        } catch (RuntimeException error) {
            returnOverlay = null;
            AutomationLog.error(
                    "Return overlay show failed",
                    error.getMessage(),
                    error);
        }
    }

    private Button createOverlayButton(String text, int backgroundColor) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(CompanionConfig.RETURN_OVERLAY_TEXT_SIZE_SP);
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinHeight(dp(CompanionConfig.RETURN_OVERLAY_MIN_HEIGHT_DP));
        button.setGravity(Gravity.CENTER);
        button.setPadding(
                dp(CompanionConfig.RETURN_OVERLAY_HORIZONTAL_PADDING_DP),
                dp(CompanionConfig.RETURN_OVERLAY_VERTICAL_PADDING_DP),
                dp(CompanionConfig.RETURN_OVERLAY_HORIZONTAL_PADDING_DP),
                dp(CompanionConfig.RETURN_OVERLAY_VERTICAL_PADDING_DP));
        GradientDrawable background = new GradientDrawable();
        background.setColor(backgroundColor);
        background.setCornerRadius(
                dp(CompanionConfig.RETURN_OVERLAY_CORNER_RADIUS_DP));
        button.setBackground(background);
        button.setElevation(dp(4));
        return button;
    }

    private WindowManager.LayoutParams createOverlayLayoutParams() {
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                android.graphics.PixelFormat.TRANSLUCENT);
        boolean landscape = getResources().getConfiguration().orientation
                == Configuration.ORIENTATION_LANDSCAPE;
        params.gravity = landscape
                ? Gravity.TOP | Gravity.CENTER_HORIZONTAL
                : Gravity.TOP | Gravity.END;
        params.x = landscape
                ? 0
                : dp(CompanionConfig.RETURN_OVERLAY_END_MARGIN_DP);
        params.y = dp(CompanionConfig.RETURN_OVERLAY_TOP_MARGIN_DP);
        return params;
    }

    private void removeReturnOverlay(String reason) {
        if (returnOverlay == null) {
            return;
        }
        try {
            overlayWindowManager.removeViewImmediate(returnOverlay);
            AutomationLog.step("Return overlay removed", "reason=" + reason);
        } catch (RuntimeException error) {
            AutomationLog.error(
                    "Return overlay removal failed",
                    "reason=" + reason,
                    error);
        } finally {
            returnOverlay = null;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
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
        if (isZoomActive()) {
            doubleTapDispatched = true;
            commandActive = false;
            AutomationLog.step(
                    "Double-tap skipped",
                    "zoom already active before gesture elapsedMs="
                            + elapsedSinceAutomationStart());
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
                        liveZoomKnownActive = true;
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
        boolean activeFailure = commandActive || isReturnActive(this);
        automationState = AutomationState.RETURNING;
        commandActive = false;
        phase = Phase.IDLE;
        handler.removeCallbacks(automationRunnable);
        if (!activeFailure) {
            return;
        }
        returnToSalonAfterCommandFailure(this, message);
    }

    public static synchronized void returnToSalonAfterCommandFailure(
            Context context,
            String reason) {
        AutomationLog.error("Camera command failed", "reason=" + reason, null);
        DoorAccessibilityService instance = connectedInstance;
        if (instance != null) {
            instance.automationState = AutomationState.RETURNING;
            instance.cancelLocalAutomation();
            instance.deviceClicked = false;
            instance.doubleTapDispatched = false;
        }
        setReturnActive(context, false);
        cancelAutoReturn(context);
        stopNotificationWatchdog();
        cancelNotification(context);
        AutomationLog.step("Failure cleanup completed", "returningToSalon=true");
        launchSalon(context);
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
        automationState = AutomationState.IDLE;
        openingFromDoorbell = false;
        handler.removeCallbacksAndMessages(null);
        removeReturnOverlay("Automation cancelled");
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
                NotificationManager.IMPORTANCE_LOW));
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
                .setPriority(Notification.PRIORITY_LOW)
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
        cancelNotification(this);
    }

    public static void requestManualReturn(Context context) {
        executeReturn(true, context);
    }

    public static void requestAutoReturn(Context context) {
        if (AutoReturnPreferences.load(context) == AutoReturnPreferences.NEVER) {
            cancelAutoReturn(context);
            if (isReturnActive(context)) {
                ensureReturnNotification(context);
            }
            AutomationLog.step("Stale auto-return ignored", "duration=0");
            return;
        }
        executeReturn(false, context);
    }

    private static synchronized void executeReturn(boolean manual, Context context) {
        boolean activeBefore = isReturnActive(context);
        AutomationLog.audit(
                "Return requested",
                "manual=" + manual + " sessionActive=" + activeBefore);
        if (!activeBefore) {
            AutomationLog.step(
                    "Return request ignored",
                    "manual=" + manual + " active=false");
            return;
        }
        DoorAccessibilityService returningInstance = connectedInstance;
        if (returningInstance != null) {
            returningInstance.automationState = AutomationState.RETURNING;
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
                boolean returnActive = isReturnActive(applicationContext);
                boolean notificationActive =
                        isReturnNotificationActive(applicationContext);
                AutomationLog.step(
                        "Notification watchdog heartbeat",
                        "returnActive=" + returnActive
                                + " notificationActive=" + notificationActive);
                if (!returnActive) {
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
        AutomationLog.audit(
                "Notification watchdog cancellation requested",
                "watchdogActive=" + (notificationWatchdogRunnable != null)
                        + " sessionActive="
                        + (connectedInstance != null
                        && isReturnActive(connectedInstance)));
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
        AutomationLog.audit(
                "Auto-return cancellation requested",
                "timerActive=" + (autoReturnRunnable != null)
                        + " sessionActive=" + isReturnActive(context));
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
        boolean previous = isReturnActive(context);
        AutomationLog.audit(
                "Return session state changed",
                "old=" + previous + " new=" + active);
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
        AutomationLog.audit(
                "Return notification cancellation requested",
                "sessionActive=" + isReturnActive(context)
                        + " notificationActive=" + isReturnNotificationActive(context));
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

    public static void launchSalonWithCompanionStatus(Context context, boolean ready) {
        Uri statusUri = Uri.parse(CompanionConfig.SALON_URL)
                .buildUpon()
                .appendQueryParameter("companion_status", ready ? "ready" : "unavailable")
                .build();
        Intent webApkIntent = findSalonWebApkIntent(context);
        Intent intent = new Intent(Intent.ACTION_VIEW, statusUri)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (webApkIntent != null && webApkIntent.getPackage() != null) {
            intent.setPackage(webApkIntent.getPackage());
        }
        try {
            context.startActivity(intent);
            AutomationLog.step("Companion status returned", "ready=" + ready);
        } catch (RuntimeException error) {
            AutomationLog.error("Companion status return failed", error.getMessage(), error);
            launchSalon(context);
        }
    }
}
