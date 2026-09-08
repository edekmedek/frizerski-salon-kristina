package hr.salon.kristina.companion;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;

public final class NukiDeepLinkActivity extends Activity implements NukiBleController.Listener {
    private NukiBleController controller;
    private NukiCommand command;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        status = new TextView(this);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        status.setPadding(padding, padding, padding, padding);
        status.setTextSize(18);
        setContentView(status);

        command = NukiCommand.from(getIntent() == null ? null : getIntent().getData());
        AutomationLog.step("Nuki deep link received", "command=" + command);
        if (command == NukiCommand.UNKNOWN) {
            returnToSalon("error", "invalid_command");
            return;
        }
        if (!NukiPermissions.granted(this)) {
            returnToSalon("error", "bluetooth_permission_missing");
            return;
        }
        controller = new NukiBleController(this, this);
        controller.execute(command);
    }

    @Override
    public void onProgress(String message) {
        status.setText(message);
    }

    @Override
    public void onSuccess(String message) {
        returnToSalon("success", command == NukiCommand.LOCK ? "locked" : "unlocked");
    }

    @Override
    public void onError(String message, Throwable error) {
        returnToSalon("error", sanitize(message));
    }

    @Override
    protected void onDestroy() {
        if (controller != null) controller.cancel();
        super.onDestroy();
    }

    private void returnToSalon(String result, String detail) {
        Uri uri = Uri.parse(CompanionConfig.SALON_URL).buildUpon()
                .appendQueryParameter("nuki_result", result)
                .appendQueryParameter("nuki_detail", detail)
                .build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        finish();
    }

    private String sanitize(String value) {
        return value.toLowerCase(java.util.Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "_").replaceAll("^_|_$", "");
    }
}
