package hr.salon.kristina.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class AutoReturnReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        DoorAccessibilityService.requestAutoReturn(context);
    }
}
