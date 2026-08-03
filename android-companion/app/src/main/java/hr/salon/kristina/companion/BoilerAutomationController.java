package hr.salon.kristina.companion;

import android.content.Intent;
import android.graphics.Rect;
import android.os.Handler;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/** Isolated state machine for the Tapo boiler card. */
public final class BoilerAutomationController {
    public interface GestureCallback {
        void onCompleted();
        void onCancelled();
    }

    public interface Host {
        boolean sendHome();
        boolean sendBack();
        Intent tapoLaunchIntent();
        void launch(Intent intent);
        AccessibilityNodeInfo tapoRoot();
        Rect visibleScreenBounds();
        boolean dispatchTap(float x, float y, GestureCallback callback);
        void returnResult(String result, String detail, long elapsedMs, boolean clicked);
    }

    private enum State { IDLE, WAITING_FOR_UI, WAITING_FOR_CONFIRMATION }
    private enum Power { ON, OFF, UNKNOWN }

    private final Host host;
    private final Handler handler;
    private State state = State.IDLE;
    private BoilerCommand command = BoilerCommand.UNKNOWN;
    private long startedAt;
    private long deadline;
    private boolean clickSent;
    private boolean actionClickAttempted;
    private boolean actionClickAccepted;
    private boolean gestureDispatched;
    private boolean gestureCompleted;
    private long actionClickSettledAt;
    private Power initialPower = Power.UNKNOWN;
    private int tapoBackNavigationCount;
    private Power lastObserved = Power.UNKNOWN;
    private int stableObservations;

    private final Runnable inspectRunnable = this::inspect;

    public BoilerAutomationController(Host host, Handler handler) {
        this.host = host;
        this.handler = handler;
    }

    public boolean isActive() {
        return state != State.IDLE;
    }

    public void start(BoilerCommand nextCommand) {
        if (isActive()) {
            host.returnResult("error", "busy", 0L, false);
            return;
        }
        command = nextCommand;
        state = State.WAITING_FOR_UI;
        startedAt = SystemClock.elapsedRealtime();
        deadline = SystemClock.uptimeMillis() + CompanionConfig.BOILER_UI_TIMEOUT_MS;
        clickSent = false;
        actionClickAttempted = false;
        actionClickAccepted = false;
        gestureDispatched = false;
        gestureCompleted = false;
        actionClickSettledAt = 0L;
        initialPower = Power.UNKNOWN;
        tapoBackNavigationCount = 0;
        resetStability();
        AutomationLog.step("Boiler command started", "command=" + command);
        host.sendHome();
        handler.postDelayed(() -> {
            if (!isActive()) return;
            Intent launchIntent = host.tapoLaunchIntent();
            if (launchIntent == null) {
                finish("error", "tapo_unavailable");
                return;
            }
            host.launch(launchIntent);
            handler.postDelayed(inspectRunnable, CompanionConfig.TAPO_STARTUP_WAIT_MS);
        }, CompanionConfig.HOME_SETTLE_DELAY_MS);
    }

    public void onTapoUiChanged() {
        if (!isActive()) return;
        handler.removeCallbacks(inspectRunnable);
        handler.postDelayed(inspectRunnable, CompanionConfig.BOILER_STABLE_DELAY_MS);
    }

    public void cancelForDoorFlow() {
        if (isActive()) finish("error", "busy_door");
    }

    public void cancelSilently() {
        handler.removeCallbacks(inspectRunnable);
        state = State.IDLE;
        command = BoilerCommand.UNKNOWN;
    }

    private void inspect() {
        if (!isActive()) return;
        CardMatch match = findCard(host.tapoRoot());
        if (match.count != 1 || match.card == null || match.power == Power.UNKNOWN) {
            AccessibilityNodeInfo currentRoot = host.tapoRoot();
            if (!clickSent
                    && currentRoot != null
                    && currentRoot.getPackageName() != null
                    && CompanionConfig.TAPO_PACKAGE.contentEquals(currentRoot.getPackageName())
                    && tapoBackNavigationCount < CompanionConfig.BOILER_MAX_TAPO_BACK_NAVIGATION
                    && host.sendBack()) {
                tapoBackNavigationCount++;
                AutomationLog.step("Boiler navigating to Tapo Home",
                        "backCount=" + tapoBackNavigationCount);
                handler.removeCallbacks(inspectRunnable);
                handler.postDelayed(inspectRunnable, CompanionConfig.BOILER_BACK_SETTLE_MS);
                return;
            }
            if (SystemClock.uptimeMillis() >= deadline) {
                finish(clickSent ? "timeout" : "unknown",
                        match.count > 1 ? "multiple_cards" : "unreadable_state");
            } else {
                scheduleNextInspection();
            }
            return;
        }

        if (match.power == lastObserved) {
            stableObservations++;
        } else {
            lastObserved = match.power;
            stableObservations = 1;
        }
        if (stableObservations < 2) {
            scheduleNextInspection();
            return;
        }
        if (initialPower == Power.UNKNOWN) {
            initialPower = match.power;
        }

        if (state == State.WAITING_FOR_CONFIRMATION) {
            Power expected = command == BoilerCommand.ON ? Power.ON : Power.OFF;
            if (match.power == expected) {
                finish(result(match.power), "confirmed");
            } else if (!gestureDispatched
                    && SystemClock.uptimeMillis() >= actionClickSettledAt) {
                dispatchValidatedFallback(match);
            } else if (SystemClock.uptimeMillis() >= deadline) {
                finish("timeout", "state_not_confirmed");
            } else {
                scheduleNextInspection();
            }
            return;
        }

        if (command == BoilerCommand.STATUS
                || (command == BoilerCommand.ON && match.power == Power.ON)
                || (command == BoilerCommand.OFF && match.power == Power.OFF)) {
            finish(result(match.power), command == BoilerCommand.STATUS ? "status" : "already_set");
            return;
        }

        SwitchTarget target = validateSwitchTarget(match);
        if (!target.valid) {
            finish("unknown", target.failure);
            return;
        }
        actionClickAttempted = true;
        actionClickAccepted = target.node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        clickSent = actionClickAccepted;
        state = State.WAITING_FOR_CONFIRMATION;
        deadline = SystemClock.uptimeMillis() + CompanionConfig.BOILER_CONFIRM_TIMEOUT_MS;
        actionClickSettledAt = SystemClock.uptimeMillis()
                + (actionClickAccepted ? CompanionConfig.BOILER_ACTION_CLICK_SETTLE_MS : 0L);
        resetStability();
        AutomationLog.step("Boiler ACTION_CLICK result",
                "command=" + command + " accepted=" + actionClickAccepted);
        if (!actionClickAccepted) {
            dispatchValidatedFallback(findCard(host.tapoRoot()));
            return;
        }
        scheduleNextInspection();
    }

    private void dispatchValidatedFallback(CardMatch match) {
        if (gestureDispatched) {
            scheduleNextInspection();
            return;
        }
        if (match.count != 1 || match.card == null || match.power == Power.UNKNOWN) {
            finish("unknown", "fallback_card_unavailable");
            return;
        }
        Power expectedCurrent = command == BoilerCommand.ON ? Power.OFF : Power.ON;
        if (match.power != expectedCurrent) {
            finish("unknown", "fallback_state_changed_unexpectedly");
            return;
        }
        SwitchTarget target = validateSwitchTarget(match);
        if (!target.valid) {
            finish("unknown", "fallback_" + target.failure);
            return;
        }
        final float centerX = target.bounds.exactCenterX();
        final float centerY = target.bounds.exactCenterY();
        gestureDispatched = true;
        clickSent = true;
        AutomationLog.step("Boiler dispatchGesture requested",
                "initialState=" + initialPower
                        + " switchBounds=" + target.bounds.toShortString()
                        + " center=" + centerX + "," + centerY);
        boolean accepted = host.dispatchTap(centerX, centerY, new GestureCallback() {
            @Override
            public void onCompleted() {
                gestureCompleted = true;
                AutomationLog.step("Boiler dispatchGesture result", "completed=true");
                scheduleNextInspection();
            }

            @Override
            public void onCancelled() {
                AutomationLog.step("Boiler dispatchGesture result", "completed=false");
                finish("unknown", "gesture_cancelled");
            }
        });
        if (!accepted) {
            gestureDispatched = false;
            clickSent = false;
            finish("unknown", "gesture_rejected");
        }
    }

    private void scheduleNextInspection() {
        handler.removeCallbacks(inspectRunnable);
        handler.postDelayed(inspectRunnable, CompanionConfig.BOILER_STABLE_DELAY_MS);
    }

    private void resetStability() {
        lastObserved = Power.UNKNOWN;
        stableObservations = 0;
    }

    private CardMatch findCard(AccessibilityNodeInfo root) {
        CardMatch match = new CardMatch();
        if (root == null) return match;
        List<AccessibilityNodeInfo> cards =
                root.findAccessibilityNodeInfosByViewId(CompanionConfig.BOILER_CARD_ID);
        for (AccessibilityNodeInfo node : cards) {
            CharSequence description = node.getContentDescription();
            String value = description == null ? "" : description.toString().trim();
            if (value.startsWith(CompanionConfig.BOILER_DEVICE_NAME + ",")) {
                match.count++;
                match.card = node;
                if ((CompanionConfig.BOILER_DEVICE_NAME + ",On").equals(value)) {
                    match.power = Power.ON;
                } else if ((CompanionConfig.BOILER_DEVICE_NAME + ",Off").equals(value)) {
                    match.power = Power.OFF;
                } else {
                    match.power = Power.UNKNOWN;
                }
            }
        }
        if (match.count != 1) {
            match.card = null;
            match.power = Power.UNKNOWN;
        }
        return match;
    }

    private AccessibilityNodeInfo findUniqueSwitch(AccessibilityNodeInfo card) {
        List<AccessibilityNodeInfo> switches =
                card.findAccessibilityNodeInfosByViewId(CompanionConfig.BOILER_SWITCH_ID);
        AutomationLog.step("Boiler switch lookup", "count=" + switches.size());
        return switches.size() == 1 ? switches.get(0) : null;
    }

    private SwitchTarget validateSwitchTarget(CardMatch match) {
        AccessibilityNodeInfo powerSwitch = findUniqueSwitch(match.card);
        if (powerSwitch == null) return SwitchTarget.failure("switch_missing_or_ambiguous");
        if (!powerSwitch.isVisibleToUser()) return SwitchTarget.failure("switch_not_visible");
        if (!powerSwitch.isEnabled()) return SwitchTarget.failure("switch_disabled");
        Rect switchBounds = new Rect();
        Rect cardBounds = new Rect();
        powerSwitch.getBoundsInScreen(switchBounds);
        match.card.getBoundsInScreen(cardBounds);
        Rect screenBounds = host.visibleScreenBounds();
        if (switchBounds.isEmpty()
                || switchBounds.width() < CompanionConfig.BOILER_SWITCH_MIN_SIZE_PX
                || switchBounds.height() < CompanionConfig.BOILER_SWITCH_MIN_SIZE_PX) {
            return SwitchTarget.failure("switch_bounds_invalid");
        }
        if (screenBounds == null || !screenBounds.contains(switchBounds)) {
            return SwitchTarget.failure("switch_outside_screen");
        }
        if (cardBounds.isEmpty() || !cardBounds.contains(switchBounds)) {
            return SwitchTarget.failure("switch_outside_card");
        }
        float centerX = switchBounds.exactCenterX();
        float centerY = switchBounds.exactCenterY();
        int margin = CompanionConfig.BOILER_SWITCH_MIN_CENTER_MARGIN_PX;
        if (centerX - switchBounds.left < margin
                || switchBounds.right - centerX < margin
                || centerY - switchBounds.top < margin
                || switchBounds.bottom - centerY < margin) {
            return SwitchTarget.failure("switch_center_near_edge");
        }
        AutomationLog.step("Boiler switch validated",
                "visible=true enabled=true cardBounds=" + cardBounds.toShortString()
                        + " switchBounds=" + switchBounds.toShortString()
                        + " screenBounds=" + screenBounds.toShortString());
        return SwitchTarget.valid(powerSwitch, switchBounds);
    }

    private String result(Power power) {
        return power == Power.ON ? "on" : power == Power.OFF ? "off" : "unknown";
    }

    private void finish(String result, String detail) {
        long elapsed = SystemClock.elapsedRealtime() - startedAt;
        boolean clicked = clickSent;
        handler.removeCallbacks(inspectRunnable);
        state = State.IDLE;
        command = BoilerCommand.UNKNOWN;
        AutomationLog.step("Boiler command finished",
                "result=" + result + " detail=" + detail
                        + " initialState=" + initialPower
                        + " actionClickAttempted=" + actionClickAttempted
                        + " actionClickAccepted=" + actionClickAccepted
                        + " gestureDispatched=" + gestureDispatched
                        + " gestureCompleted=" + gestureCompleted
                        + " clicked=" + clicked + " elapsedMs=" + elapsed);
        host.returnResult(result, detail, elapsed, clicked);
    }

    private static final class CardMatch {
        int count;
        AccessibilityNodeInfo card;
        Power power = Power.UNKNOWN;
    }

    private static final class SwitchTarget {
        final boolean valid;
        final String failure;
        final AccessibilityNodeInfo node;
        final Rect bounds;

        private SwitchTarget(
                boolean valid,
                String failure,
                AccessibilityNodeInfo node,
                Rect bounds) {
            this.valid = valid;
            this.failure = failure;
            this.node = node;
            this.bounds = bounds;
        }

        static SwitchTarget valid(AccessibilityNodeInfo node, Rect bounds) {
            return new SwitchTarget(true, "", node, new Rect(bounds));
        }

        static SwitchTarget failure(String reason) {
            return new SwitchTarget(false, reason, null, null);
        }
    }
}
