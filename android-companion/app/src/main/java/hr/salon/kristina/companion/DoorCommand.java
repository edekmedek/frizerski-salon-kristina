package hr.salon.kristina.companion;

import android.net.Uri;

public enum DoorCommand {
    LIVE,
    OPEN,
    RETURN,
    STATUS,
    ERROR,
    UNKNOWN;

    public static DoorCommand from(Uri uri) {
        if (uri == null
                || !CompanionConfig.DEEP_LINK_SCHEME.equals(uri.getScheme())
                || !CompanionConfig.DEEP_LINK_HOST.equals(uri.getHost())) {
            return UNKNOWN;
        }
        String path = uri.getPath();
        if (CompanionConfig.PATH_LIVE.equals(path)) {
            return LIVE;
        }
        if (CompanionConfig.PATH_OPEN.equals(path)) {
            return OPEN;
        }
        if (CompanionConfig.PATH_RETURN.equals(path)) {
            return RETURN;
        }
        if (CompanionConfig.PATH_STATUS.equals(path)) {
            return STATUS;
        }
        if (CompanionConfig.PATH_ERROR.equals(path)) {
            return ERROR;
        }
        return UNKNOWN;
    }
}
