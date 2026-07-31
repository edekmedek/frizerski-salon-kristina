package hr.salon.kristina.companion;

public final class CompanionConfig {
    public static final String TAPO_PACKAGE = "com.tplink.iot";
    public static final String PRIMARY_DEVICE_NAME = "Tapo D235 salon";
    public static final String ALTERNATIVE_DEVICE_NAME = "Tapo D235";

    public static final int FALLBACK_X = 983;
    public static final int FALLBACK_Y = 395;
    public static final String[] FALLBACK_TABLET_MODELS = {"SM-X200", "SM-X205"};
    public static final int FALLBACK_SCREEN_WIDTH = 1200;
    public static final int FALLBACK_SCREEN_HEIGHT = 1920;

    public static final long TAPO_STARTUP_WAIT_MS = 250L;
    public static final long HOME_SETTLE_DELAY_MS = 250L;
    public static final long SEARCH_INTERVAL_MS = 250L;
    public static final long DEVICE_SEARCH_TIMEOUT_MS = 10_000L;
    public static final long LIVE_CONFIRMATION_TIMEOUT_MS = 10_000L;
    public static final int MAX_CLICK_PARENT_DEPTH = 8;
    public static final long FALLBACK_GESTURE_DURATION_MS = 100L;

    public static final int VIDEO_SURFACE_LEFT = 0;
    public static final int VIDEO_SURFACE_TOP = 0;
    public static final int VIDEO_SURFACE_RIGHT = 1200;
    public static final int VIDEO_SURFACE_BOTTOM = 1325;
    public static final int DOUBLE_TAP_X = 600;
    public static final int DOUBLE_TAP_Y = 663;
    public static final long DOUBLE_TAP_AFTER_LIVE_DELAY_MS = 6_000L;
    public static final long TAP_DURATION_MS = 50L;
    public static final long DOUBLE_TAP_GAP_MS = 150L;

    public static final String SALON_URL = "https://frizerskisalonkristina.hr/";
    public static final String[] SALON_WEBAPK_LABELS = {
            "Salon Kristina",
            "Frizerski salon Kristina"
    };
    public static final String DEEP_LINK_SCHEME = "salonkristina";
    public static final String DEEP_LINK_HOST = "door";
    public static final String PATH_LIVE = "/live";
    public static final String PATH_OPEN = "/open";
    public static final String PATH_RETURN = "/return";
    public static final String PATH_STATUS = "/status";
    public static final String PATH_ERROR = "/error";

    public static final String NOTIFICATION_CHANNEL_ID = "return_to_salon_v3_quiet";
    public static final int NOTIFICATION_ID = 235;
    public static final long NOTIFICATION_WATCHDOG_INTERVAL_MS = 2_000L;
    public static final int RETURN_OVERLAY_TOP_MARGIN_DP = 40;
    public static final int RETURN_OVERLAY_END_MARGIN_DP = 16;
    public static final int RETURN_OVERLAY_HORIZONTAL_PADDING_DP = 17;
    public static final int RETURN_OVERLAY_VERTICAL_PADDING_DP = 10;
    public static final int RETURN_OVERLAY_CORNER_RADIUS_DP = 24;
    public static final int RETURN_OVERLAY_MIN_HEIGHT_DP = 48;
    public static final float RETURN_OVERLAY_TEXT_SIZE_SP = 17F;

    private CompanionConfig() {
    }
}
