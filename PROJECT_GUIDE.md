# Salon Kristina — Technical Project Guide

> **Read this file first before changing this repository.** It documents the repository as verified at commit `912ea50173dfb930ef23af9e89aa1707e097de21` (`Nuki Smart Lock Go integration working`). For a normal change, use this guide to identify the relevant files and inspect only that targeted area; do not repeat a repository-wide discovery/analysis unless the requested work or conflicting evidence genuinely requires it. When code and this guide disagree, inspect the current code and update this guide with the same change.

## 1. Project overview

Salon Kristina is a production salon-management system with two cooperating applications:

- A React/TypeScript web application for the salon administrator and clients. It manages clients, appointments, services/prices, requests, messages, notifications, and treatment-photo archives.
- A small native Android application, **Salon Companion** (`hr.salon.kristina.companion`), installed on the salon tablet. It bridges web UI actions to capabilities that a browser cannot perform directly: opening the Tapo D235 live view through the installed Tapo app, controlling the salon boiler through Tapo UI automation, and controlling a Nuki Smart Lock Go locally over Bluetooth LE.

The web application and Companion communicate through Android deep links using the custom `salonkristina` scheme. Boiler commands use an Android `intent://` URL that explicitly targets the Companion package. Results that must return to the web application are added as query parameters to `https://frizerskisalonkristina.hr/`.

The salon tablet runs:

- the Salon Kristina web application as an installed Chrome WebAPK/PWA;
- Salon Companion;
- the official Tapo app (`com.tplink.iot`);
- Chrome;
- the Android accessibility service supplied by Salon Companion when camera/boiler automation is enabled.

## 2. Repository structure

### Web application

- `src/main.tsx` — React entry point.
- `src/App.tsx` — authentication/bootstrap router; selects access screen, administrator app, or client portal and initializes push/PWA behavior.
- `src/AdminApp.tsx` — main administrator application, calendar and business workflows, tablet hardware controls, Supabase synchronization, inbox, client management, price list, and photo archive.
- `src/ClientPortal.tsx` — authenticated client portal for appointments, requests, messages, prices, photos, and notifications.
- `src/SalonDashboard.tsx` — high-level dashboard using the `DoorbellService` abstraction.
- `src/AdminInboxViews.tsx`, `src/AdminChatView.tsx` — administrator request/message views.
- `src/types.ts`, `src/portalTypes.ts` — local and portal data contracts.
- `src/lib/` — focused business/data/browser adapters. Important files are described below.
- `public/manifest.webmanifest`, `public/push-sw.js` — installable web app and push service worker assets.
- `supabase/migrations/` — chronological production-oriented database migrations.
- `supabase/functions/send-web-push/` — Supabase Edge Function for web push.
- `supabase/manual/`, `supabase/test_data/` — explicitly manual diagnostics/migrations and test seed/cleanup SQL.
- `DATABASE_V2.md` — design and migration guidance. It contains historical/future architecture discussion and is **not** a complete description of the current deployed schema. In particular, its old “smart lock not implemented” section is superseded by the current Android Nuki implementation and this guide.
- `.github/workflows/deploy.yml` — GitHub Pages CI/CD.

### Android Companion

- `android-companion/app/src/main/AndroidManifest.xml` — activities, deep-link filters, accessibility service, and Bluetooth/location/notification permissions.
- `android-companion/app/src/main/java/hr/salon/kristina/companion/` — all Java implementation classes.
- `android-companion/app/src/main/res/xml/accessibility_service_config.xml` — event types, view-ID/window access, and gesture capability required by Tapo automation.
- `android-companion/app/src/test/.../NukiProtocolTest.java` — Nuki advertisement and official protocol-vector tests.
- `android-companion/app/build.gradle` — Android SDK levels and NaCl/JNA/JUnit dependencies.
- `android-companion/gradle/wrapper/` — Gradle 8.9 wrapper; Android Gradle Plugin is 8.7.3.

## 3. Web application

### Architecture and authentication

The web application is a React 19 single-page application written in TypeScript and built by Vite. `App.tsx` observes the Supabase auth session and renders one of:

- `AccessScreen` for login/activation;
- `AdminApp` for an administrator;
- `ClientPortal` for the client associated with the authenticated session.

Supabase is optional at compile time. `src/lib/supabase.ts` creates a client only when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` exist. Auth sessions persist, auto-refresh, and may be detected from the URL. The required public build variables are documented in `.env.example`:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_VAPID_PUBLIC_KEY
```

Never commit real secrets. The publishable key and VAPID public key are intentionally public client configuration; privileged Supabase keys must never enter the frontend.

### Administrator UI

`AdminApp.tsx` is the main operational UI. Its views include the salon dashboard, daily schedule, clients, price list, live request inbox, live messages, treatment archive, settings, and PIN-protected appointment archive. It combines local fallback state with Supabase-backed state, maps database rows into UI models, refreshes server state, and uses realtime/refresh helpers for inbox changes.

Important supporting modules include:

- `lib/adminAuth.ts`, `lib/adminPin.ts`, `lib/calendarAccess.ts` — administrator identity and protected calendar/archive access.
- `lib/adminInbox.ts`, `AdminInboxViews.tsx`, `AdminChatView.tsx` — request and message mapping/actions.
- `lib/adminAppointmentSync.ts` — maps Supabase appointment rows and service snapshots.
- `lib/dayCalendar.ts`, `lib/appointmentDuration.ts`, `lib/appointmentConflicts.test.ts` — calendar layout, duration, and overlap rules.
- `lib/appointmentTreatments.ts`, `lib/requestTreatmentDraft.ts`, `lib/serviceRules.ts` — multi-treatment totals, request drafts, ordering, duration, and pricing rules.
- `lib/treatmentPhotoArchive.ts`, `lib/clientPhoto.ts`, `lib/image.ts` — private before/after photo workflows and client images.

### Appointments and scheduling

The administrator can create, edit, move/reschedule, cancel, and archive appointments. Calendar utilities calculate visible positions, working-hour bands, overlap depth, and candidate times. Multiple treatments use snapshot-aware duration and price calculations so later catalog changes do not silently rewrite an existing appointment’s business values. Overlaps may be surfaced and explicitly handled rather than blindly prohibited. Client-originated requests can be reviewed and turned into proposed/pending appointments.

The authoritative database model is the actually deployed Supabase schema plus the ordered incremental migrations and current TypeScript mappings. Do not apply `supabase/schema.sql` blindly: `DATABASE_V2.md` explicitly identifies it as an older future-oriented draft that diverges from later production migrations.

### Client functionality

`ClientPortal.tsx` provides client-specific sections for the home view, appointment/change/cancellation requests, appointments and proposal responses, public prices, two-way messages, shared treatment photos, and push-notification setup/testing. Client identity is derived through Supabase authentication/RLS and server RPCs; do not trust a client-provided `client_id` as an authorization boundary.

Push-related modules include `lib/pushNotifications.ts`, `lib/clientPush.ts`, `lib/notificationSetup.ts`, and `lib/appBadge.ts`. The Edge Function `send-web-push` performs server-side delivery. Browser subscription secrets/endpoints must remain protected by database policies and server-side code.

### Local fallback/data flow

`lib/storage.ts` and `lib/portalStorage.ts` maintain local browser data/session state used by the UI and fallback/demo paths. Supabase operations in `AdminApp.tsx` and `ClientPortal.tsx` use tables, views, RPC functions, refresh loops, and row mapping helpers. `lib/supabaseTrafficGuard.ts` centralizes refresh/call throttling behavior. Preserve the distinction between local UI persistence and authoritative Supabase operations when editing a workflow.

### Tablet hardware buttons

The floating door controls are rendered only when `isSupportedSalonTablet()` in `lib/tapoApp.ts` detects Android, touch input, a coarse pointer, and a shortest viewport side between 550 and 700 CSS pixels.

#### Camera

- Button label: `Kamera`.
- `AdminApp.openVideoDoorbell()` calls `openSalonDoorCompanion()`.
- Deep link: `salonkristina://door/live`.
- Status link: `salonkristina://door/status`.
- `openSalonDoorCompanion()` watches `visibilitychange` for 1.5 seconds and shows `Companion aplikacija nije instalirana.` when it cannot observe the app opening.

The `DoorbellService` interface and current `MockDoorbellService` in `lib/doorbellService.ts` support dashboard status abstraction, but the production camera button does not stream through that mock. It opens the Android Companion/Tapo flow.

#### Boiler

- Commands: `status`, `on`, `off`.
- Custom-scheme form: `salonkristina://boiler/<command>`.
- Browser launch form used by the web app:

```text
intent://boiler/<command>#Intent;scheme=salonkristina;package=hr.salon.kristina.companion;end
```

`lib/boilerApp.ts` launches commands, consumes result/resume query parameters, caches confirmed on/off state for two minutes, rate-limits automatic status checks, and allows one retry within a 30-second transaction window.

#### Nuki door button

- Button label and appearance at this checkpoint: `🔓 Otvori vrata`.
- It is wired directly in `AdminApp.tsx` with:

```ts
window.location.href = 'salonkristina://nuki/unlock'
```

- The button is not marked `aria-disabled`.
- This web-to-deep-link wiring builds and tests successfully, but the physical Nuki motor action has deliberately not yet been tested.

Because the Nuki URL is a plain custom scheme rather than an `intent://` URL with a package, Android could show an app chooser if another installed application registered the same scheme. It is invoked synchronously from a user click, which is the browser-compatible way to request an external-app launch.

### Build, tests, and deployment

From the repository root:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The build output is `dist/`. At the checkpoint, the suite contained 46 test files and 194 passing tests. Tests cover auth/bootstrap, admin navigation/inbox/chat, scheduling rules, migrations/mappings, portal flows, push behavior, tablet detection, camera-launch behavior, boiler URLs/state/retry, and privacy-sensitive photo behavior.

`.github/workflows/deploy.yml` runs on every push to `main` (and manual dispatch), using Node 22. It runs `npm ci`, lint, tests, and build, then deploys `dist/` to GitHub Pages. Therefore **pushing `main` is a deployment-triggering action**; do not push when the user says not to deploy.

## 4. Android Companion

### Build/application configuration

- Application ID/namespace: `hr.salon.kristina.companion`.
- Version at this checkpoint: `0.1.0` / versionCode `1`.
- Minimum SDK 26; compile/target SDK 35; build tools 35.0.0.
- Java 17 source/target.
- `android:allowBackup="false"` intentionally prevents application backup.

### Components

#### `DoorCommandActivity`

Launcher/configuration activity. It provides:

- camera auto-return choices (`Never`, 30 seconds, 1/2/5 minutes);
- the currently disabled legacy `OTVORI VRATA (USKORO)` placeholder;
- Nuki saved-authorization status, six-digit pairing PIN input, explicit pairing, test lock/unlock buttons, and credential clearing;
- shortcut to accessibility settings and accessibility connection status.

It owns the foreground `NukiBleController` used by manual configuration actions and cancels an active controller in `onDestroy()`.

#### `DoorDeepLinkActivity` and `DoorCommand`

Invisible/no-history entry point for `salonkristina://door/*`:

- `/live` validates accessibility and notification readiness, then calls the connected `DoorAccessibilityService`.
- `/status` returns Companion readiness to the salon URL.
- `/open`, `/return`, and `/error` are parsed/reserved but are not implemented as camera commands here.

Failures return to the salon web application through the shared return/error machinery.

#### `DoorAccessibilityService`

Production-critical state machine for Tapo doorbell/camera automation and host for boiler automation. It receives Tapo window/content/click/notification events, can inspect interactive windows/view IDs, can perform global Home/Back actions, and can dispatch gestures.

It also owns return-to-salon state, the return overlay, notification/watchdog, auto-return scheduling, and recovery after service reconnection.

> **DO NOT casually refactor, simplify, or rewrite this service or its Tapo selectors/timings. The Tapo D235 flow is known-working production behavior.** Make changes only for a confirmed requirement, preserve fallbacks and state transitions, and retest on the salon tablet/Tapo app.

#### Boiler components

- `BoilerDeepLinkActivity` parses `status/on/off`, requires a connected accessibility service, dispatches to it, and finishes.
- `BoilerCommand` strictly parses the boiler host/path.
- `BoilerAutomationController` navigates the installed Tapo UI, finds and validates the configured boiler device card/switch, reads state, clicks/taps when needed, confirms a stable result, and returns a result to the salon URL through its `Host` interface.

#### Return and auto-return components

- `ReturnToSalonActivity` invokes the central return path and finishes.
- `AutoReturnReceiver` receives the scheduled alarm and requests return.
- `AutoReturnPreferences` persists the selected duration. The default in code is `NEVER` (0); the latest observed saved tablet selection was 30 seconds.
- `DoorAccessibilityService` persists active return state, maintains a quiet notification and watchdog, displays an overlay with `← Salon`, and launches the installed Salon WebAPK when resolvable, otherwise `https://frizerskisalonkristina.hr/`.

#### `CompanionConfig`

Central production constants: package/channel/device identifiers, Tapo selectors, validated fallback coordinates and tablet models/resolution, timeouts, live-view markers and zoom gesture coordinates, salon URL/WebAPK labels, deep-link hosts/paths, boiler selectors/timings, Nuki timeouts, notification/overlay dimensions, and return behavior. Changes here can alter production automation even when service code is untouched.

#### Nuki components

- `NukiDeepLinkActivity` — exported/no-history `salonkristina://nuki/*` entry point. Validates the command, permissions, and stored credentials, executes asynchronously, reports errors via UI/logs, and finishes after the result.
- `NukiBleController` — one-shot pairing/action state machine. Handles BLE scanning, strict candidate selection, GATT connection/discovery, indications, pairing messages, encrypted actions, timeouts, logging, and cleanup.
- `NukiProtocol` — Nuki Bluetooth API v2.3.1 UUIDs, command IDs, packet encoding/parsing, little-endian values, CRC, candidate validation, and action payloads.
- `NukiCrypto` — required Curve25519/HSalsa20 precomputation, HMAC-SHA256 authenticators, secure random nonces/keys, and NaCl `secretbox` authenticated encryption through LazySodium/JNA.
- `NukiCredentialStore` — Android-Keystore-backed AES/GCM persistent encrypted storage of the authorized device address, authorization ID, app ID, lock UUID, and shared key. The six-digit pairing PIN is deliberately never persisted.
- `NukiPermissions` — runtime Bluetooth scan/connect and precise-location gate. On Android 12+, Fine and Coarse Location are requested together because Android requires the pair for a precise-location request; the operational condition checks Fine Location.
- `NukiCommand` — strict `/lock` and `/unlock` parsing plus protocol action bytes (`0x02` lock, `0x01` unlock).
- `AutomationLog` — consistent Logcat tag `SalonDoorAutomation`, session IDs, steps, audit entries, and errors. PINs/secrets must remain redacted.

## 5. Tapo D235 camera — known-working production flow

The current production flow is:

```text
Web `Kamera` button
  -> salonkristina://door/live
  -> DoorDeepLinkActivity
  -> connected DoorAccessibilityService
  -> Android Home
  -> launch official Tapo app
  -> find `Tapo D235 salon` (fallback `Tapo D235`)
  -> accessibility ACTION_CLICK on visible clickable card/parent
  -> bounded card-center gesture fallback if needed
  -> SM-X200/SM-X205 1200x1920 coordinate fallback if needed
  -> confirm Tapo live activity/UI
  -> show return overlay/notification and optionally double-tap live video
```

Important assumptions and behavior:

- Tapo package: `com.tplink.iot`.
- Primary device name: `Tapo D235 salon`; alternative: `Tapo D235`.
- Confirmed live activity marker: class containing `TapoPadVideoPlayV3Activity`; localized live-control text is also checked.
- Coordinate fallback is deliberately restricted to tablet models `SM-X200`/`SM-X205` at exactly 1200×1920; current coordinates are production calibration, not generic UI values.
- Once live view is ready, an overlay provides `← Salon`; a quiet notification and watchdog preserve recovery/return state.
- Auto-return uses the user’s saved choice. At the latest observed tablet state it was 30 seconds.
- A delayed double-tap at the configured video center is used for the known live-view zoom behavior and checks for an existing `2.5x` state.
- Tapo doorbell notification automation listens only for package `com.tplink.iot` and channel `tapo_notification_channel_door_bell_ring`. Other motion/person notifications are intentionally ignored. A doorbell event has priority and can cancel an active boiler operation.
- The Tapo app must remain installed, logged in, and configured with the expected camera/device name. Its UI structure, localization, notification channel, and accessibility-visible IDs are operational dependencies.

Known-good rollback checkpoint before Nuki work: commit `d9e0789` (`Tapo D235 live view working on salon tablet`). Complete confirmed Nuki integration checkpoint: `912ea50173dfb930ef23af9e89aa1707e097de21`.

## 6. Boiler

Boiler control is local tablet UI automation through the official Tapo app; it is not a direct device protocol and does not use Home Assistant.

Flow:

```text
Web boiler control
  -> package-targeted intent://boiler/{status|on|off}
  -> BoilerDeepLinkActivity
  -> DoorAccessibilityService
  -> BoilerAutomationController
  -> Tapo app/device card `Bojler u salonu`
  -> inspect/click Tapo switch
  -> confirm stable state
  -> return to salon URL with boiler_result/detail/elapsed/clicked
  -> web consumes result and updates short-lived cache
```

Important configuration is in `CompanionConfig`: device name `Bojler u salonu`, card ID `com.tplink.iot:id/content`, switch ID `com.tplink.iot:id/device_switch`, UI/confirmation timeouts, stability delay, gesture constraints, and bounded Back navigation.

Limitations/state:

- Requires the Tapo app, its current accessible UI, and a connected Companion accessibility service.
- Commands are serialized against camera/return activity; busy state returns an error.
- Doorbell/camera work has priority over boiler work.
- Reported web state is confirmed but cached only for 120 seconds; otherwise it is `unknown` and an automatic status request may run.
- The web retry logic permits one automatic retry within 30 seconds and rate-limits automatic status starts to 10 seconds.
- Treat Tapo selectors, timing, state confirmation, and return query parameters as production integration contracts.

## 7. Nuki Smart Lock Go (5th generation)

### Scope and status

The lock is controlled directly and locally over Bluetooth LE from Salon Companion. It does not require Home Assistant, Nuki Web, paid Remote Access, or Wi-Fi for Companion control. The tablet must remain physically close enough for reliable BLE.

Confirmed device:

- Model/generation: current Nuki Smart Lock Go, 5th generation.
- BLE name: `Nuki_4CCA88EC`.
- Observed BLE address during pairing: `54:D2:72:CA:88:EC` (device addresses can be platform/device-specific; credentials store the authorized address rather than hard-coding it).

Current confirmed status:

- BLE discovery succeeds.
- Pairing GATT service/characteristic verification succeeds.
- Nuki Bluetooth API v2.3.1 authorization succeeds.
- Encrypted authorization credentials are stored successfully.
- The authorization record survives a force-stop and cold app restart; the UI reports `Nuki autorizacija je spremljena.`
- Actual LOCK and UNLOCK motor movement is confirmed with the lock mounted and calibrated.

### BLE discovery behavior on the Samsung tablet

Nuki pairing service and characteristic:

- pairing service (`e300`): `a92ee300-5501-11e4-916c-0800200c9a66`;
- pairing GDIO characteristic (`e301`): `a92ee301-5501-11e4-916c-0800200c9a66`.

The controller uses an **unfiltered** low-latency scan. Do not restore an Android `ScanFilter` that requires an advertised service UUID: on this lock/tablet the relevant UUID is delivered as a service-data key while `ScanRecord.getServiceUuids()` is `null`.

Two strict candidate paths are accepted, both requiring a name matching `Nuki_[0-9A-Fa-f]{8}`:

1. Nuki iBeacon path: Apple manufacturer ID `0x004C`, payload beginning `02 15`, followed by proximity UUID `a92ee200-5501-11e4-916c-0800200c9a66`.
2. Fifth-generation pairing service-data path: service-data UUID `a92ee300-5501-11e4-916c-0800200c9a66`, an exactly four-byte payload, and those bytes must exactly match the eight hexadecimal characters after `Nuki_`. For this lock the payload is `4C CA 88 EC`.

This second path is necessary because Samsung/Android 14 was observed to suppress the location-sensitive iBeacon advertisement with Bluetooth-stack messages `Skipping data matching denylist` and `Skipping client for location deny list`, while still delivering this usable record to Companion:

```text
name=Nuki_4CCA88EC
serviceUuids=null
manufacturerData={}
serviceData={a92ee300-5501-11e4-916c-0800200c9a66=4C CA 88 EC}
```

`BLUETOOTH_SCAN` alone was insufficient for this tablet’s behavior. The manifest declares Fine and Coarse Location, Android location services must be enabled, and the app must have runtime Fine Location. Android requires Fine and Coarse to be requested together for a precise-location runtime request. `android:usesPermissionFlags="neverForLocation"` must not be added back to `BLUETOOTH_SCAN`, because it prevents delivery of location-derived beacon data.

Advertisements are only candidate selection. After connection, `NukiBleController` mandates discovery of `e300/e301` in pairing mode. It will not trust an advertisement as final device validation.

### Authorization flow

The implemented pairing state machine follows Nuki Bluetooth API v2.3.1:

1. Enable indications on `e301` through CCCD `00002902-0000-1000-8000-00805f9b34fb`.
2. Request the lock public key (`REQUEST_DATA`/`PUBLIC_KEY`).
3. Generate an ephemeral Curve25519 key pair and derive the NaCl shared secret using `crypto_box_beforenm` (Curve25519 + HSalsa20).
4. Exchange the client public key and receive the challenge.
5. Send the HMAC-SHA256 authorization authenticator.
6. On authorization info, send encrypted authorization data containing a random app ID, fixed client name `Salon Companion`, and the user-entered six-digit PIN. Logs redact the PIN and the in-memory PIN is cleared.
7. Receive/decrypt the authorization ID and lock UUID and persist the authorized record.

Plain and encrypted packets validate lengths and CRC. Encrypted messages use random 24-byte nonces and NaCl `secretbox` authenticated encryption. Unit tests contain official Nuki API v2.3.1 command vectors plus both advertisement forms and malformed/non-Nuki rejection cases. Never replace protocol details with guessed UUIDs, packet formats, crypto, or older-generation behavior.

### Credential storage

`NukiCredentialStore` serializes device address, authorization ID, app ID, 16-byte lock UUID, and 32-byte shared key. It encrypts the record with AES/GCM using a non-exportable key under Android Keystore alias `salon_nuki_credentials_v1`; only ciphertext and IV are placed in private SharedPreferences `nuki_secure_credentials`. `allowBackup=false` is set. No credential is hard-coded, and the pairing PIN is not stored.

Uninstalling the app removes its private preferences and normally its Android Keystore entry, destroying the authorization record. Prefer `adb install -r` with the compatible signing key. Never uninstall or clear app data without explicit approval and a plan to re-authorize Nuki and restore Tapo/Companion configuration.

### Post-pair action path

After pairing, lock actions connect directly to the stored device address using:

- keyturner service (`e200`): `a92ee200-5501-11e4-916c-0800200c9a66`;
- keyturner USDIO characteristic (`e202`): `a92ee202-5501-11e4-916c-0800200c9a66`.

The controller enables indications, requests an encrypted challenge, sends encrypted `LOCK_ACTION` with the stored authorization/app IDs, action byte and challenge, and waits for status. This path has protocol-vector tests and confirmed physical LOCK/UNLOCK execution on the mounted lock.

Deep links:

```text
salonkristina://nuki/lock
salonkristina://nuki/unlock
```

The web `🔓 Otvori vrata` button currently launches `/unlock` directly. Do not click this button during a test unless physical movement is authorized and safe.

## 8. Salon tablet

Confirmed runtime/device information:

- ADB serial: `R8YW60P92YK`.
- Model: Samsung `SM-X200`.
- Android: 14, API 34.
- Companion targets API 35.
- Relevant installed packages confirmed: `hr.salon.kristina.companion`, `com.tplink.iot`, `com.android.chrome`, and Salon WebAPK `org.chromium.webapk.a0d5e9ae17039681b_v2`.
- A separate package `hr.salon.kristina.nukiblepoc` was also observed; it is not part of this repository’s production Companion flow.

Required Companion permissions/state:

- `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` granted;
- `ACCESS_FINE_LOCATION` granted; Coarse Location is requested/granted with it as required by Android’s precise-location flow;
- Android Location services enabled;
- `POST_NOTIFICATIONS` granted for camera return behavior;
- Salon Companion accessibility service enabled and connected for camera and boiler automation.

At the time of the guide’s final ADB inspection, the device had been force-stopped during a persistence test and `enabled_accessibility_services` returned empty. Before relying on camera/boiler production automation, re-check the configuration screen/Android Accessibility settings and enable the service if needed. Do not infer camera readiness merely because Nuki BLE works; Nuki does not depend on the accessibility service.

State that must survive updates:

- encrypted Nuki authorization and its Android Keystore key;
- auto-return preference (latest observed selection: 30 seconds);
- Bluetooth/location/notification grants;
- accessibility-service enablement;
- Tapo login, device configuration, notification channel behavior, and the exact camera/boiler names;
- installed Salon WebAPK/browser state.

Use `adb install -r` for compatible in-place APK updates. An uninstall or app-data clear loses Companion private configuration and Nuki authorization. An APK signed with a different certificate cannot update the installed package (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`); use the established compatible debug signing setup rather than uninstalling casually.

## 9. Development environment

Confirmed Windows paths on the development machine:

```text
Repository:      C:\Projekti\frizerski-salon-kristina
Android project: C:\Projekti\frizerski-salon-kristina\android-companion
ADB:             C:\Users\edekm\AppData\Local\Android\Sdk\platform-tools\adb.exe
Android SDK:     C:\Users\edekm\AppData\Local\Android\Sdk
JDK used:        C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot
```

### Web commands

Run at repository root:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Use `npm.cmd`, not `npm`, when PowerShell execution policy blocks `npm.ps1`. Vite output is `C:\Projekti\frizerski-salon-kristina\dist`.

### Android commands

Run in `android-companion`:

```powershell
$env:ANDROID_HOME = 'C:\Users\edekm\AppData\Local\Android\Sdk'
.\gradlew.bat testDebugUnitTest assembleDebug
```

Optional proportional checks include:

```powershell
.\gradlew.bat lintDebug
```

Debug APK output:

```text
C:\Projekti\frizerski-salon-kristina\android-companion\app\build\outputs\apk\debug\app-debug.apk
```

Install in place without clearing data:

```powershell
& 'C:\Users\edekm\AppData\Local\Android\Sdk\platform-tools\adb.exe' `
  -s R8YW60P92YK install -r `
  'C:\Projekti\frizerski-salon-kristina\android-companion\app\build\outputs\apk\debug\app-debug.apk'
```

Launch configuration only (does not itself pair or operate the lock):

```powershell
& 'C:\Users\edekm\AppData\Local\Android\Sdk\platform-tools\adb.exe' `
  -s R8YW60P92YK shell am start `
  -n hr.salon.kristina.companion/.DoorCommandActivity
```

Do not invoke Nuki deep links as a harmless smoke test: `/lock` and `/unlock` are real physical commands once credentials exist.

## 10. Supabase hardware gateway

The durable Supabase hardware-command architecture is configured in production. Migration `20260908_hardware_gateway.sql` is applied, and the dedicated non-admin gateway Auth account and `salon-tablet` gateway row are provisioned. Tablet login, heartbeat, Realtime connection, and an empty-queue claim are verified.

- `hardware_commands` is the durable queue; Realtime refreshes Admin panels but is not the source of truth.
- `hardware_device_states` separates the last confirmed state from availability. A failed boiler read never erases the last confirmed `on`/`off` value or its `observed_at`.
- `hardware_gateways.last_seen_at` is the tablet heartbeat; Admin panels derive offline state from a stale heartbeat.
- Only `admin_enqueue_hardware_command` creates commands, after a server-side `public.is_admin()` check.
- The tablet uses a separate non-admin Supabase Auth user tied to one gateway row. Its access/refresh tokens are encrypted with Android Keystore. Never place a service-role key in the APK.
- `HardwareGatewayService` is a `connectedDevice` foreground service that polls the durable queue. Web Admin panels use Supabase Realtime for shared results and state.
- Existing camera, boiler, and Nuki deep links remain local fallbacks on the supported salon tablet.
- Nuki secrets remain exclusively in `NukiCredentialStore`; no Nuki credential is uploaded to Supabase.
- A sent boiler `on`/`off` command is not confirmation. Only feedback from `BoilerAutomationController` may update confirmed state and `observed_at`.
- Existing Logcat evidence showed the frequent local `unknown` display followed `service_unavailable` while the accessibility service was disconnected. Do not bypass Android accessibility settings; restore and verify that service.

Resource-efficiency rules:

- Supabase Realtime is the primary command notification and Admin-state transport. Realtime events are hints; the durable database queue remains authoritative because Realtime does not guarantee delivery.
- The Android gateway subscribes only to `INSERT` events for `hardware_commands` and requests only the inserted `id`. It immediately claims after a Realtime event or reconnect.
- Gateway recovery polling is 120 seconds. Never reduce it to a few seconds; diagnose Realtime instead.
- Database heartbeat is 60 seconds. Admin considers the gateway offline only after 150 seconds, allowing two missed heartbeats.
- Phoenix/WebSocket heartbeats every 30 seconds keep Realtime connected but do not query or write the database.
- Realtime reconnect uses exponential backoff: 5, 10, 20, 40, 60, then at most 120 seconds.
- Admin panels perform one initial gateway/state/recent-command load and then apply Realtime row payloads directly. They must not add periodic hardware-state refetch loops.
- React effect cleanup removes its channel, and one effect owns one channel, preventing duplicate subscriptions across rerenders and Strict Mode remounts.
- Do not write unchanged device state on heartbeat. Device-state writes occur only for a completed command/observation; `observed_at` advances only for genuinely confirmed boiler `on`/`off` feedback.
- `client_request_id` remains unique per requester, and only one queued/claimed/running command per gateway/device is allowed. Never automatically repeat ambiguous Nuki or boiler physical actions; an expired running lease becomes `outcome_unknown`.

Production activation completed for the database and Android gateway. Web Admin deployment is the remaining rollout step at the time this section was updated.

## 11. Change-safety checklist

Before a normal change:

1. Read this guide and inspect only the files relevant to the requested scope.
2. Run `git status`; preserve unrelated user changes.
3. Treat `d9e0789` as the known-good Tapo rollback point and `912ea501...` as the confirmed Nuki integration checkpoint.
4. Do not refactor `DoorAccessibilityService`, Tapo selectors, coordinates, or timing while working on unrelated functionality.
5. Do not uninstall/clear Companion data or replace its signing identity without explicit approval.
6. Never log/store the Nuki PIN, shared key, authorization secrets, Supabase privileged credentials, or push secrets.
7. Do not trigger physical lock/boiler/camera actions during build/unit tests.
8. Remember that pushing `main` triggers the GitHub Pages deployment workflow.
9. Update this guide whenever a change invalidates its architecture, URLs, verified device state, or operational warnings.
