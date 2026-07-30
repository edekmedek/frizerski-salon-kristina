package hr.salon.kristina.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

public final class DoorCommandActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 17;
    private TextView statusView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createStatusScreen();
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void createStatusScreen() {
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(padding, padding, padding, padding);

        statusView = new TextView(this);
        statusView.setTextSize(20);
        statusView.setGravity(Gravity.CENTER);
        layout.addView(statusView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView preferenceTitle = new TextView(this);
        preferenceTitle.setText("Automatski povratak iz kamere");
        preferenceTitle.setTextSize(18);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = padding;
        layout.addView(preferenceTitle, titleParams);

        RadioGroup autoReturnGroup = new RadioGroup(this);
        addAutoReturnOption(autoReturnGroup, "Nikad", AutoReturnPreferences.NEVER);
        addAutoReturnOption(
                autoReturnGroup,
                "30 sekundi",
                AutoReturnPreferences.THIRTY_SECONDS);
        addAutoReturnOption(
                autoReturnGroup,
                "1 minuta",
                AutoReturnPreferences.ONE_MINUTE);
        addAutoReturnOption(
                autoReturnGroup,
                "2 minute",
                AutoReturnPreferences.TWO_MINUTES);
        addAutoReturnOption(
                autoReturnGroup,
                "5 minuta",
                AutoReturnPreferences.FIVE_MINUTES);
        long selectedDuration = AutoReturnPreferences.load(this);
        for (int index = 0; index < autoReturnGroup.getChildCount(); index++) {
            RadioButton option = (RadioButton) autoReturnGroup.getChildAt(index);
            if (((Long) option.getTag()) == selectedDuration) {
                option.setChecked(true);
                break;
            }
        }
        autoReturnGroup.setOnCheckedChangeListener((group, checkedId) -> {
            RadioButton selected = group.findViewById(checkedId);
            if (selected != null) {
                AutoReturnPreferences.save(this, (Long) selected.getTag());
            }
        });
        layout.addView(autoReturnGroup, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        Button settingsButton = new Button(this);
        settingsButton.setText("Otvori postavke pristupačnosti");
        settingsButton.setOnClickListener(view ->
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        layout.addView(settingsButton);
        setContentView(layout);
    }

    private void addAutoReturnOption(RadioGroup group, String label, long durationMs) {
        RadioButton option = new RadioButton(this);
        option.setId(android.view.View.generateViewId());
        option.setText(label);
        option.setTag(durationMs);
        group.addView(option);
    }

    private void handleIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        DoorCommand command = DoorCommand.from(data);
        switch (command) {
            case ERROR:
                statusView.setText(intent.getStringExtra("message"));
                return;
            case OPEN:
                showReservedCommand("Otvori vrata");
                return;
            case RETURN:
                showReservedCommand("Povratak u salon");
                return;
            case STATUS:
                showReservedCommand("Status vrata");
                return;
            case LIVE:
                startLiveCommand();
                return;
            case UNKNOWN:
            default:
                statusView.setText("Za prikaz kamere otvorite salonkristina://door/live.");
        }
    }

    private void startLiveCommand() {
        if (!isAccessibilityServiceEnabled()) {
            statusView.setText("Uključite uslugu „Salon Kristina – vrata”, zatim ponovno dodirnite gumb u salonu.");
            new AlertDialog.Builder(this)
                    .setTitle("Potrebna je pristupačnost")
                    .setMessage("Companion treba dopuštenje za pronalaženje i otvaranje kamere Tapo D235.")
                    .setPositiveButton("Otvori postavke", (dialog, which) ->
                            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)))
                    .setNegativeButton("Odustani", null)
                    .show();
            return;
        }

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            statusView.setText("Dopustite obavijesti za ručni povratak u Salon Kristina.");
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST);
            return;
        }
        launchAutomation();
    }

    private void launchAutomation() {
        statusView.setText("Otvaram prikaz kamere…");
        DoorAccessibilityService service = DoorAccessibilityService.getConnectedInstance();
        if (service == null) {
            showError("Usluga pristupačnosti još nije spremna. Isključite je i ponovno uključite u postavkama.");
            return;
        }
        service.openLiveView();
        finish();
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) {
            return;
        }
        if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            launchAutomation();
        } else {
            showError("Obavijesti su potrebne za ručni povratak u Salon Kristina.");
        }
    }

    private void showReservedCommand(String name) {
        String message = "Naredba „" + name + "” pripremljena je za buduću verziju.";
        statusView.setText(message);
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    private boolean isAccessibilityServiceEnabled() {
        ComponentName component = new ComponentName(this, DoorAccessibilityService.class);
        String enabled = Settings.Secure.getString(
                getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (TextUtils.isEmpty(enabled)) {
            return false;
        }
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabled);
        while (splitter.hasNext()) {
            ComponentName candidate = ComponentName.unflattenFromString(splitter.next());
            if (component.equals(candidate)) {
                return true;
            }
        }
        return false;
    }

    private void showError(String message) {
        statusView.setText(message);
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
