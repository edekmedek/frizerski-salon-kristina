package hr.salon.kristina.companion;

import android.content.Context;

public final class AutoReturnPreferences {
    public static final long NEVER = 0L;
    public static final long THIRTY_SECONDS = 30_000L;
    public static final long ONE_MINUTE = 60_000L;
    public static final long TWO_MINUTES = 120_000L;
    public static final long FIVE_MINUTES = 300_000L;

    private static final String PREFERENCES_NAME = "companion_settings";
    private static final String AUTO_RETURN_DURATION_KEY = "auto_return_duration_ms";

    private AutoReturnPreferences() {
    }

    public static long load(Context context) {
        long duration = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .getLong(AUTO_RETURN_DURATION_KEY, NEVER);
        AutomationLog.step(
                "Auto-return preference loaded",
                "duration=" + duration);
        return duration;
    }

    public static void save(Context context, long duration) {
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .putLong(AUTO_RETURN_DURATION_KEY, duration)
                .apply();
        AutomationLog.step(
                "Auto-return preference changed",
                "duration=" + duration);
    }
}
