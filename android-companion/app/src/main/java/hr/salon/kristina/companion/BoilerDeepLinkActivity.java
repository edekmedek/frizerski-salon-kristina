package hr.salon.kristina.companion;

import android.app.Activity;
import android.os.Bundle;

public final class BoilerDeepLinkActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        BoilerCommand command = BoilerCommand.from(
                getIntent() == null ? null : getIntent().getData());
        DoorAccessibilityService service = DoorAccessibilityService.getConnectedInstance();
        if (command == BoilerCommand.UNKNOWN || service == null) {
            DoorAccessibilityService.launchSalonWithBoilerResult(
                    this, "error", service == null ? "service_unavailable" : "invalid_command");
        } else {
            service.executeBoilerCommand(command);
        }
        finish();
    }
}
