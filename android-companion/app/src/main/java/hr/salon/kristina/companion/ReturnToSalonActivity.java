package hr.salon.kristina.companion;

import android.app.Activity;
import android.os.Bundle;

public final class ReturnToSalonActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        DoorAccessibilityService.requestManualReturn(this);
        finish();
    }
}
