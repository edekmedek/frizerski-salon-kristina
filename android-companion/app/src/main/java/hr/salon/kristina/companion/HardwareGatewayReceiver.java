package hr.salon.kristina.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class HardwareGatewayReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        if (HardwareGatewayStore.isEnabled(context) && HardwareGatewayStore.hasSession(context)) {
            HardwareGatewayService.start(context);
        }
    }
}
