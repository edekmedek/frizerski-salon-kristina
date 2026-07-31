package hr.salon.kristina.companion;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

public final class DoorCommandActivity extends Activity {
    private TextView savedConfirmationView;

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
