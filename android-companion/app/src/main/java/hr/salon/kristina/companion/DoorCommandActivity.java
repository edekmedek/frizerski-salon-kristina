package hr.salon.kristina.companion;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

public final class DoorCommandActivity extends Activity {
    private TextView savedConfirmationView;
    private TextView nukiStatusView;
    private EditText nukiPinView;
    private NukiBleController nukiController;
    private TextView gatewayStatusView;
    private EditText gatewayEmailView;
    private EditText gatewayPasswordView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createSettingsScreen();
    }

    private void createSettingsScreen() {
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        int smallSpacing = Math.round(8 * getResources().getDisplayMetrics().density);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(padding, padding, padding, padding);

        TextView title = new TextView(this);
        title.setText("Companion postavke");
        title.setTextSize(24);
        layout.addView(title, matchWrap());

        TextView preferenceTitle = new TextView(this);
        preferenceTitle.setText("Automatski povratak iz kamere");
        preferenceTitle.setTextSize(18);
        LinearLayout.LayoutParams preferenceTitleParams = matchWrap();
        preferenceTitleParams.topMargin = padding;
        layout.addView(preferenceTitle, preferenceTitleParams);

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
        selectSavedDuration(autoReturnGroup, AutoReturnPreferences.load(this));
        layout.addView(autoReturnGroup, matchWrap());

        savedConfirmationView = new TextView(this);
        savedConfirmationView.setTextSize(14);
        savedConfirmationView.setVisibility(TextView.GONE);
        LinearLayout.LayoutParams confirmationParams = matchWrap();
        confirmationParams.bottomMargin = smallSpacing;
        layout.addView(savedConfirmationView, confirmationParams);

        autoReturnGroup.setOnCheckedChangeListener((group, checkedId) -> {
            RadioButton selected = group.findViewById(checkedId);
            if (selected == null) {
                return;
            }
            AutoReturnPreferences.save(this, (Long) selected.getTag());
            savedConfirmationView.setText("Postavka spremljena");
            savedConfirmationView.setVisibility(TextView.VISIBLE);
        });

        Button openDoorButton = new Button(this);
        openDoorButton.setText("Otvori vrata (uskoro)");
        openDoorButton.setEnabled(false);
        layout.addView(openDoorButton, matchWrap());

        TextView nukiTitle = new TextView(this);
        nukiTitle.setText("Nuki Smart Lock Go (lokalni Bluetooth)");
        nukiTitle.setTextSize(18);
        LinearLayout.LayoutParams nukiTitleParams = matchWrap();
        nukiTitleParams.topMargin = padding;
        layout.addView(nukiTitle, nukiTitleParams);

        nukiStatusView = new TextView(this);
        nukiStatusView.setText(new NukiCredentialStore(this).hasCredentials()
                ? "Nuki autorizacija je spremljena."
                : "Nuki još nije autoriziran.");
        layout.addView(nukiStatusView, matchWrap());

        nukiPinView = new EditText(this);
        nukiPinView.setHint("6-znamenkasti Nuki sigurnosni PIN");
        nukiPinView.setInputType(android.text.InputType.TYPE_CLASS_NUMBER
                | android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        nukiPinView.setSingleLine(true);
        layout.addView(nukiPinView, matchWrap());

        Button pairNukiButton = new Button(this);
        pairNukiButton.setText("Upari i autoriziraj Nuki");
        pairNukiButton.setOnClickListener(view -> startNukiPairing());
        layout.addView(pairNukiButton, matchWrap());

        LinearLayout nukiActions = new LinearLayout(this);
        nukiActions.setOrientation(LinearLayout.HORIZONTAL);
        Button testUnlock = new Button(this);
        testUnlock.setText("Test otključaj");
        testUnlock.setOnClickListener(view -> executeNukiTest(NukiCommand.UNLOCK));
        nukiActions.addView(testUnlock, new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        Button testLock = new Button(this);
        testLock.setText("Test zaključaj");
        testLock.setOnClickListener(view -> executeNukiTest(NukiCommand.LOCK));
        nukiActions.addView(testLock, new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        layout.addView(nukiActions, matchWrap());

        Button clearNuki = new Button(this);
        clearNuki.setText("Izbriši lokalne Nuki vjerodajnice");
        clearNuki.setOnClickListener(view -> {
            new NukiCredentialStore(this).clear();
            nukiPinView.setText("");
            nukiStatusView.setText("Lokalne Nuki vjerodajnice su izbrisane.");
            AutomationLog.step("Nuki credentials cleared");
        });
        layout.addView(clearNuki, matchWrap());

        TextView gatewayTitle = new TextView(this);
        gatewayTitle.setText("Supabase hardware gateway");
        gatewayTitle.setTextSize(18);
        LinearLayout.LayoutParams gatewayTitleParams = matchWrap();
        gatewayTitleParams.topMargin = padding;
        layout.addView(gatewayTitle, gatewayTitleParams);

        gatewayStatusView = new TextView(this);
        gatewayStatusView.setText(HardwareGatewayStore.hasSession(this)
                ? (HardwareGatewayStore.isEnabled(this) ? "Gateway je konfiguriran i uključen." : "Gateway je konfiguriran, ali isključen.")
                : "Gateway račun nije konfiguriran.");
        layout.addView(gatewayStatusView, matchWrap());

        gatewayEmailView = new EditText(this);
        gatewayEmailView.setHint("E-mail zasebnog gateway računa");
        gatewayEmailView.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        layout.addView(gatewayEmailView, matchWrap());

        gatewayPasswordView = new EditText(this);
        gatewayPasswordView.setHint("Lozinka gateway računa");
        gatewayPasswordView.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(gatewayPasswordView, matchWrap());

        Button enableGateway = new Button(this);
        enableGateway.setText("Prijavi i uključi gateway");
        enableGateway.setOnClickListener(view -> configureGateway());
        layout.addView(enableGateway, matchWrap());

        Button disableGateway = new Button(this);
        disableGateway.setText("Isključi gateway");
        disableGateway.setOnClickListener(view -> {
            HardwareGatewayStore.setEnabled(this, false);
            HardwareGatewayService.stop(this);
            gatewayStatusView.setText("Gateway je isključen; spremljena sesija je sačuvana.");
        });
        layout.addView(disableGateway, matchWrap());

        Button accessibilitySettingsButton = new Button(this);
        accessibilitySettingsButton.setText("Otvori postavke pristupačnosti");
        accessibilitySettingsButton.setOnClickListener(view ->
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        layout.addView(accessibilitySettingsButton, matchWrap());

        TextView diagnosticsTitle = new TextView(this);
        diagnosticsTitle.setText("Dijagnostika");
        diagnosticsTitle.setTextSize(16);
        LinearLayout.LayoutParams diagnosticsTitleParams = matchWrap();
        diagnosticsTitleParams.topMargin = padding;
        layout.addView(diagnosticsTitle, diagnosticsTitleParams);

        TextView diagnostics = new TextView(this);
        diagnostics.setText(
                DoorAccessibilityService.getConnectedInstance() == null
                        ? "Usluga pristupačnosti nije povezana."
                        : "Usluga pristupačnosti je povezana.");
        diagnostics.setTextSize(13);
        layout.addView(diagnostics, matchWrap());

        ScrollView scrollView = new ScrollView(this);
        scrollView.addView(layout);
        setContentView(scrollView);
    }

    private void startNukiPairing() {
        if (!NukiPermissions.granted(this)) {
            NukiPermissions.request(this);
            nukiStatusView.setText("Odobrite Bluetooth dopuštenja pa ponovno pritisnite uparivanje.");
            return;
        }
        String pin = nukiPinView.getText().toString();
        nukiController = new NukiBleController(this, nukiListener());
        nukiStatusView.setText("Tražim Nuki u načinu uparivanja…");
        nukiController.pair(pin);
        nukiPinView.setText("");
    }

    private void configureGateway() {
        String email = gatewayEmailView.getText().toString().trim();
        String password = gatewayPasswordView.getText().toString();
        gatewayPasswordView.setText("");
        if (email.isEmpty() || password.isEmpty()) {
            gatewayStatusView.setText("Unesite gateway e-mail i lozinku.");
            return;
        }
        gatewayStatusView.setText("Prijava gateway računa…");
        new Thread(() -> {
            try {
                new HardwareGatewayClient(this).signIn(email, password);
                HardwareGatewayStore.setEnabled(this, true);
                runOnUiThread(() -> {
                    HardwareGatewayService.start(this);
                    gatewayEmailView.setText("");
                    gatewayStatusView.setText("Gateway je konfiguriran i uključen.");
                });
            } catch (Exception error) {
                AutomationLog.error("Gateway sign-in", error.getMessage(), error);
                runOnUiThread(() -> gatewayStatusView.setText("Gateway prijava nije uspjela: " + error.getMessage()));
            }
        }, "salon-gateway-sign-in").start();
    }

    private void executeNukiTest(NukiCommand command) {
        if (!NukiPermissions.granted(this)) {
            NukiPermissions.request(this);
            nukiStatusView.setText("Odobrite Bluetooth dopuštenja pa ponovite test.");
            return;
        }
        nukiController = new NukiBleController(this, nukiListener());
        nukiController.execute(command);
    }

    private NukiBleController.Listener nukiListener() {
        return new NukiBleController.Listener() {
            @Override
            public void onProgress(String message) {
                nukiStatusView.setText(message);
            }

            @Override
            public void onSuccess(String message) {
                nukiStatusView.setText(message);
            }

            @Override
            public void onError(String message, Throwable error) {
                nukiStatusView.setText("Greška: " + message);
            }
        };
    }

    @Override
    protected void onDestroy() {
        if (nukiController != null) nukiController.cancel();
        super.onDestroy();
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private void addAutoReturnOption(
            RadioGroup group,
            String label,
            long durationMs) {
        RadioButton option = new RadioButton(this);
        option.setId(android.view.View.generateViewId());
        option.setText(label);
        option.setTag(durationMs);
        group.addView(option);
    }

    private void selectSavedDuration(RadioGroup group, long selectedDuration) {
        for (int index = 0; index < group.getChildCount(); index++) {
            RadioButton option = (RadioButton) group.getChildAt(index);
            if (((Long) option.getTag()) == selectedDuration) {
                option.setChecked(true);
                return;
            }
        }
    }
}
