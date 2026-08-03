package hr.salon.kristina.companion;

import android.net.Uri;

public enum BoilerCommand {
    STATUS,
    ON,
    OFF,
    UNKNOWN;

    public static BoilerCommand from(Uri uri) {
        if (uri == null
                || !CompanionConfig.DEEP_LINK_SCHEME.equals(uri.getScheme())
                || !CompanionConfig.BOILER_DEEP_LINK_HOST.equals(uri.getHost())) {
            return UNKNOWN;
        }
        if (CompanionConfig.PATH_STATUS.equals(uri.getPath())) return STATUS;
        if ("/on".equals(uri.getPath())) return ON;
        if ("/off".equals(uri.getPath())) return OFF;
        return UNKNOWN;
    }
}
