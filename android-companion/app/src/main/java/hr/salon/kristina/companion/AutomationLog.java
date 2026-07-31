package hr.salon.kristina.companion;

import android.util.Log;
import android.os.SystemClock;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;

public final class AutomationLog {
    private static final String TAG = "SalonDoorAutomation";
    private static final AtomicLong SESSION_SEQUENCE = new AtomicLong();

    private static volatile long sessionId;
    private static volatile String currentStep = "Idle";

    private AutomationLog() {
    }

    public static void begin() {
        sessionId = SESSION_SEQUENCE.incrementAndGet();
        step("Command received", "command=door/live");
    }

    public static void step(String step) {
        step(step, null);
    }

    public static void step(String step, String detail) {
        currentStep = step;
        Log.i(TAG, format("INFO", step, detail));
    }

    public static void error(String step, String detail, Throwable error) {
        currentStep = step;
        String message = format("ERROR", step, detail);
        if (error == null) {
            Log.e(TAG, message);
        } else {
            Log.e(TAG, message, error);
        }
    }

    public static void audit(String step, String detail) {
        currentStep = step;
        Log.w(
                TAG,
                format(
                        "AUDIT",
                        step,
                        "elapsedRealtimeMs=" + SystemClock.elapsedRealtime()
                                + " " + detail),
                new Throwable("Return lifecycle call stack"));
    }

    public static String getCurrentStep() {
        return currentStep;
    }

    private static String format(String level, String step, String detail) {
        return String.format(
                Locale.ROOT,
                "session=%d level=%s step=\"%s\"%s",
                sessionId,
                level,
                step,
                detail == null || detail.isEmpty() ? "" : " detail=\"" + detail + "\"");
    }
}
