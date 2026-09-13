package hr.salon.kristina.companion;

import android.net.Uri;

public enum NukiCommand {
    LOCK((byte) 0x02),
    UNLOCK((byte) 0x01),
    OPEN_DOOR((byte) 0x03),
    UNKNOWN((byte) 0x00);

    final byte action;

    NukiCommand(byte action) {
        this.action = action;
    }

    public static NukiCommand from(Uri uri) {
        if (uri == null
                || !CompanionConfig.DEEP_LINK_SCHEME.equals(uri.getScheme())
                || !CompanionConfig.NUKI_DEEP_LINK_HOST.equals(uri.getHost())) {
            return UNKNOWN;
        }
        if (CompanionConfig.NUKI_PATH_LOCK.equals(uri.getPath())) return LOCK;
        if (CompanionConfig.NUKI_PATH_UNLOCK.equals(uri.getPath())) return UNLOCK;
        return UNKNOWN;
    }
}
