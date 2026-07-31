package hr.salon.kristina.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class AutoReturnReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        AutomationLog.audit(
                "Auto-return receiver invoked",
                "action=" + (intent == null ? "" : intent.getAction()));
        DoorAccessibilityService.requestAutoReturn(context);
    }
}
