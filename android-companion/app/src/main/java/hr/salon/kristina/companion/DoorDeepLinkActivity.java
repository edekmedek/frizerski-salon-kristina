package hr.salon.kristina.companion;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;

public final class DoorDeepLinkActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleCommand();
        finish();
    }

    private void handleCommand() {
        DoorCommand command = DoorCommand.from(getIntent() == null
                ? null
                : getIntent().getData());
        if (command == DoorCommand.STATUS) {
            boolean ready = isAccessibilityServiceEnabled()
                    && DoorAccessibilityService.getConnectedInstance() != null;
            AutomationLog.step("Companion status requested", "ready=" + ready);
            DoorAccessibilityService.launchSalonWithCompanionStatus(this, ready);
            return;
        }
        if (command != DoorCommand.LIVE) {
            AutomationLog.step("Reserved deep link received", "command=" + command);
            returnToSalon("Command is not implemented: " + command);
            return;
        }

        AutomationLog.step("Door deep link received", "activityVisible=false");
        if (!isAccessibilityServiceEnabled()) {
            returnToSalon("Accessibility service is disabled");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            returnToSalon("Notification permission is missing");
            return;
        }

        DoorAccessibilityService service =
                DoorAccessibilityService.getConnectedInstance();
        if (service == null) {
            returnToSalon("Accessibility service is not connected");
            return;
        }
        service.openLiveView();
    }

    private void returnToSalon(String reason) {
        DoorAccessibilityService.returnToSalonAfterCommandFailure(this, reason);
    }

    private boolean isAccessibilityServiceEnabled() {
        ComponentName component =
                new ComponentName(this, DoorAccessibilityService.class);
        String enabled = Settings.Secure.getString(
                getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(enabled)) {
            return false;
        }
        TextUtils.SimpleStringSplitter splitter =
                new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        while (splitter.hasNext()) {
            ComponentName candidate =
                    ComponentName.unflattenFromString(splitter.next());
            if (component.equals(candidate)) {
                return true;
            }
        }
        return false;
    }
}
