package hr.salon.kristina.companion;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.SparseArray;

import java.io.ByteArrayOutputStream;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import java.util.Map;

/** One-shot BLE pairing/action state machine for Nuki Smart Lock Go (5th generation). */
public final class NukiBleController {
    public interface Listener {
        void onProgress(String message);
        void onSuccess(String message);
        void onError(String message, Throwable error);
    }

    private enum Mode { PAIR, ACTION }
    private enum Phase {
        SCANNING, CONNECTING, DISCOVERING, ENABLING_INDICATIONS,
        WAIT_PUBLIC_KEY, WAIT_PAIR_CHALLENGE, WAIT_AUTH_INFO, WAIT_AUTH_ID,
        WAIT_ACTION_CHALLENGE, WAIT_ACTION_RESULT, FINISHED
    }

    private final Context context;
    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final NukiCrypto crypto = new NukiCrypto();
    private final NukiCredentialStore store;
    private final ByteArrayOutputStream incoming = new ByteArrayOutputStream();
    private Mode mode;
    private Phase phase;
    private BluetoothLeScanner scanner;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic io;
    private NukiCrypto.KeyPair keyPair;
    private byte[] lockPublicKey;
    private byte[] sharedKey;
    private NukiCredentialStore.Credentials credentials;
    private long appId;
    private long pin;
    private byte action;
    private String deviceAddress;

    public NukiBleController(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.store = new NukiCredentialStore(context);
    }

    @SuppressLint("MissingPermission")
    public void pair(String sixDigitPin) {
        if (!sixDigitPin.matches("\\d{6}")) {
            fail("Nuki PIN mora imati točno 6 znamenki", null);
            return;
        }
        mode = Mode.PAIR;
        pin = Long.parseLong(sixDigitPin);
        appId = Integer.toUnsignedLong(new java.security.SecureRandom().nextInt());
        if (appId == 0) appId = 1;
        scan(NukiProtocol.PAIRING_SERVICE);
    }

    @SuppressLint("MissingPermission")
    public void execute(NukiCommand command) {
        try {
            credentials = store.load();
        } catch (GeneralSecurityException error) {
            fail("Nuki vjerodajnice se ne mogu dešifrirati", error);
            return;
        }
        if (credentials == null) {
            fail("Nuki nije uparen s Companion aplikacijom", null);
            return;
        }
        mode = Mode.ACTION;
        action = command.action;
        connect(BluetoothAdapter.getDefaultAdapter().getRemoteDevice(credentials.deviceAddress));
    }

    @SuppressLint("MissingPermission")
    public void cancel() {
        if (scanner != null) scanner.stopScan(scanCallback);
        scanner = null;
        handler.removeCallbacksAndMessages(null);
        if (gatt != null) {
            gatt.disconnect();
            gatt.close();
            gatt = null;
        }
    }

    @SuppressLint("MissingPermission")
    private void scan(java.util.UUID serviceUuid) {
        BluetoothManager manager = context.getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            fail("Bluetooth nije uključen", null);
            return;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            fail("BLE skener nije dostupan", null);
            return;
        }
        phase = Phase.SCANNING;
        progress("Nuki BLE skeniranje", "service=" + serviceUuid);
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        scanner.startScan(null, settings, scanCallback);
        handler.postDelayed(() -> fail("Nuki nije pronađen tijekom BLE skeniranja", null),
                CompanionConfig.NUKI_SCAN_TIMEOUT_MS);
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onScanResult(int callbackType, ScanResult result) {
            logScanResult(callbackType, result);
            if (phase != Phase.SCANNING) return;
            ScanRecord record = result.getScanRecord();
            String name = record == null ? null : record.getDeviceName();
            if (name == null) name = result.getDevice().getName();
            byte[] manufacturerData = record == null ? null
                    : record.getManufacturerSpecificData(NukiProtocol.IBEACON_MANUFACTURER_ID);
            byte[] pairingServiceData = record == null ? null
                    : record.getServiceData(new ParcelUuid(NukiProtocol.PAIRING_SERVICE));
            if (!NukiProtocol.isPlausibleNukiAdvertisement(
                    name, manufacturerData, pairingServiceData)) return;
            scanner.stopScan(this);
            scanner = null;
            progress("Nuki kandidat pronađen", "name=" + name
                    + " address=" + result.getDevice().getAddress()
                    + " rssi=" + result.getRssi()
                    + " validation=gatt-required");
            connect(result.getDevice());
        }

        @Override
        public void onScanFailed(int errorCode) {
            fail("Nuki BLE skeniranje nije uspjelo (" + errorCode + ")", null);
        }
    };

    @SuppressLint("MissingPermission")
    private void logScanResult(int callbackType, ScanResult result) {
        if (result == null) {
            AutomationLog.step("Nuki BLE ScanResult", "callbackType=" + callbackType
                    + " result=null");
            return;
        }

        BluetoothDevice device = result.getDevice();
        ScanRecord record = result.getScanRecord();
        String deviceName = record == null ? null : record.getDeviceName();
        if (deviceName == null && device != null) deviceName = device.getName();

        StringBuilder manufacturerData = new StringBuilder("{");
        SparseArray<byte[]> manufacturers = record == null
                ? null : record.getManufacturerSpecificData();
        if (manufacturers != null) {
            for (int index = 0; index < manufacturers.size(); index++) {
                if (index > 0) manufacturerData.append(", ");
                manufacturerData.append(String.format("0x%04X", manufacturers.keyAt(index)))
                        .append('=')
                        .append(hex(manufacturers.valueAt(index)));
            }
        }
        manufacturerData.append('}');

        StringBuilder serviceData = new StringBuilder("{");
        Map<ParcelUuid, byte[]> services = record == null ? null : record.getServiceData();
        if (services != null) {
            boolean first = true;
            for (Map.Entry<ParcelUuid, byte[]> entry : services.entrySet()) {
                if (!first) serviceData.append(", ");
                first = false;
                serviceData.append(entry.getKey()).append('=').append(hex(entry.getValue()));
            }
        }
        serviceData.append('}');

        AutomationLog.step("Nuki BLE ScanResult",
                "callbackType=" + callbackType
                        + " name=" + deviceName
                        + " address=" + (device == null ? null : device.getAddress())
                        + " rssi=" + result.getRssi()
                        + " scanRecord=" + record
                        + " serviceUuids=" + (record == null ? null : record.getServiceUuids())
                        + " solicitationUuids=" + (record == null || android.os.Build.VERSION.SDK_INT < 29
                        ? null : record.getServiceSolicitationUuids())
                        + " manufacturerData=" + manufacturerData
                        + " serviceData=" + serviceData
                        + " advertiseFlags=" + (record == null ? null : record.getAdvertiseFlags())
                        + " txPower=" + (record == null ? null : record.getTxPowerLevel()));
    }

    private static String hex(byte[] value) {
        if (value == null) return "null";
        StringBuilder output = new StringBuilder(value.length * 3);
        for (int index = 0; index < value.length; index++) {
            if (index > 0) output.append(' ');
            output.append(String.format("%02X", value[index] & 0xFF));
        }
        return output.toString();
    }

    @SuppressLint("MissingPermission")
    private void connect(BluetoothDevice device) {
        phase = Phase.CONNECTING;
        deviceAddress = device.getAddress();
        progress("Nuki povezivanje", "address=" + deviceAddress + " mode=" + mode);
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
        handler.postDelayed(() -> fail("Nuki BLE operacija je istekla", null),
                CompanionConfig.NUKI_OPERATION_TIMEOUT_MS);
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt current, int status, int newState) {
            if (status != BluetoothGatt.GATT_SUCCESS || newState != BluetoothProfile.STATE_CONNECTED) {
                if (phase != Phase.FINISHED) fail("Nuki BLE veza je prekinuta (" + status + ")", null);
                return;
            }
            progress("Nuki BLE povezan", "requestingMtu=517");
            if (!current.requestMtu(517)) discover(current);
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onMtuChanged(BluetoothGatt current, int mtu, int status) {
            progress("Nuki MTU", "mtu=" + mtu + " status=" + status);
            discover(current);
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt current, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail("Nuki GATT servisi nisu otkriveni (" + status + ")", null);
                return;
            }
            java.util.UUID serviceId = mode == Mode.PAIR
                    ? NukiProtocol.PAIRING_SERVICE : NukiProtocol.KEYTURNER_SERVICE;
            java.util.UUID characteristicId = mode == Mode.PAIR
                    ? NukiProtocol.PAIRING_GDIO : NukiProtocol.KEYTURNER_USDIO;
            BluetoothGattService service = current.getService(serviceId);
            io = service == null ? null : service.getCharacteristic(characteristicId);
            if (io == null) {
                fail("Nuki 5. generacije nema očekivani GATT servis", null);
                return;
            }
            progress("Nuki GATT potvrđen", "service=" + serviceId
                    + " characteristic=" + characteristicId);
            enableIndications(current);
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt current, BluetoothGattDescriptor descriptor,
                int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail("Nuki indikacije nisu omogućene (" + status + ")", null);
                return;
            }
            progress("Nuki indikacije omogućene", "mode=" + mode);
            if (mode == Mode.PAIR) {
                phase = Phase.WAIT_PUBLIC_KEY;
                write(NukiProtocol.request(NukiProtocol.PUBLIC_KEY));
            } else {
                phase = Phase.WAIT_ACTION_CHALLENGE;
                write(crypto.encrypt(credentials.authorizationId, NukiProtocol.REQUEST_DATA,
                        NukiProtocol.le16(NukiProtocol.CHALLENGE), credentials.sharedKey));
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt current,
                BluetoothGattCharacteristic characteristic) {
            accept(characteristic.getValue());
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt current,
                BluetoothGattCharacteristic characteristic, byte[] value) {
            accept(value);
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt current,
                BluetoothGattCharacteristic characteristic, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                fail("Nuki GATT zapis nije uspio (" + status + ")", null);
            }
        }
    };

    @SuppressLint("MissingPermission")
    private void discover(BluetoothGatt current) {
        phase = Phase.DISCOVERING;
        progress("Nuki otkrivanje GATT servisa", null);
        if (!current.discoverServices()) fail("Nuki otkrivanje GATT servisa nije pokrenuto", null);
    }

    @SuppressLint("MissingPermission")
    private void enableIndications(BluetoothGatt current) {
        phase = Phase.ENABLING_INDICATIONS;
        BluetoothGattDescriptor descriptor = io.getDescriptor(NukiProtocol.CLIENT_CONFIGURATION);
        if (descriptor == null || !current.setCharacteristicNotification(io, true)) {
            fail("Nuki GDIO indikacije nisu dostupne", null);
            return;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            current.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_INDICATION_VALUE);
        } else {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE);
            current.writeDescriptor(descriptor);
        }
    }

    @SuppressLint("MissingPermission")
    private void write(byte[] value) {
        progress("Nuki GATT zapis", "bytes=" + value.length + " phase=" + phase);
        int result;
        if (Build.VERSION.SDK_INT >= 33) {
            result = gatt.writeCharacteristic(io, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        } else {
            io.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            io.setValue(value);
            result = gatt.writeCharacteristic(io) ? BluetoothGatt.GATT_SUCCESS : -1;
        }
        if (result != BluetoothGatt.GATT_SUCCESS) fail("Nuki GATT zapis nije prihvaćen", null);
    }

    private synchronized void accept(byte[] chunk) {
        if (phase == Phase.FINISHED || chunk == null) return;
        incoming.write(chunk, 0, chunk.length);
        byte[] data = incoming.toByteArray();
        try {
            if (mode == Mode.ACTION || phase == Phase.WAIT_AUTH_ID) {
                if (data.length < 30) return;
                int total = 30 + NukiProtocol.u16(data, 28);
                if (data.length < total) return;
                byte[] message = Arrays.copyOf(data, total);
                resetIncoming(data, total);
                if (mode == Mode.ACTION) {
                    handleActionMessage(crypto.decrypt(message, credentials.authorizationId,
                            credentials.sharedKey));
                } else {
                    handlePairMessage(crypto.decrypt(message,
                            NukiProtocol.PAIRING_AUTHORIZATION_ID, sharedKey));
                }
            } else {
                for (int length = 4; length <= data.length; length++) {
                    try {
                        NukiProtocol.ParsedPlain parsed = NukiProtocol.parsePlain(
                                Arrays.copyOf(data, length));
                        resetIncoming(data, length);
                        handlePairMessage(parsed);
                        return;
                    } catch (IllegalArgumentException ignored) {
                        // Indications can fragment a packet; wait until a complete CRC-valid prefix exists.
                    }
                }
            }
        } catch (RuntimeException error) {
            fail("Nevažeća Nuki poruka", error);
        }
    }

    private void resetIncoming(byte[] data, int consumed) {
        incoming.reset();
        if (data.length > consumed) incoming.write(data, consumed, data.length - consumed);
    }

    private void handlePairMessage(NukiProtocol.ParsedPlain message) {
        if (message.command == NukiProtocol.PUBLIC_KEY && phase == Phase.WAIT_PUBLIC_KEY) {
            if (message.payload.length != 32) throw new IllegalArgumentException("Bad public key");
            lockPublicKey = message.payload;
            keyPair = crypto.generateKeyPair();
            sharedKey = crypto.sharedSecret(keyPair.privateKey, lockPublicKey);
            phase = Phase.WAIT_PAIR_CHALLENGE;
            progress("Nuki razmjena ključeva", "generation=5");
            write(NukiProtocol.publicKey(keyPair.publicKey));
            return;
        }
        if (message.command == NukiProtocol.CHALLENGE && phase == Phase.WAIT_PAIR_CHALLENGE) {
            if (message.payload.length != 32) throw new IllegalArgumentException("Bad challenge");
            byte[] authenticationData = NukiProtocol.concat(
                    keyPair.publicKey, lockPublicKey, message.payload);
            phase = Phase.WAIT_AUTH_INFO;
            progress("Nuki autorizacija", "phase=authenticator");
            write(NukiProtocol.authorizationAuthenticator(
                    crypto.authenticate(sharedKey, authenticationData)));
            return;
        }
        if (message.command == NukiProtocol.AUTHORIZATION_INFO && phase == Phase.WAIT_AUTH_INFO) {
            phase = Phase.WAIT_AUTH_ID;
            progress("Nuki autorizacija", "phase=authorization-data pin=redacted");
            write(crypto.encrypt(NukiProtocol.PAIRING_AUTHORIZATION_ID,
                    NukiProtocol.AUTHORIZATION_DATA,
                    NukiProtocol.authorizationDataPayload(appId, "Salon Companion", pin),
                    sharedKey));
            pin = 0;
            return;
        }
        if (message.command == NukiProtocol.AUTHORIZATION_ID && phase == Phase.WAIT_AUTH_ID) {
            if (message.payload.length != 20) throw new IllegalArgumentException("Bad authorization ID");
            long authorizationId = NukiProtocol.u32(message.payload, 0);
            byte[] lockUuid = Arrays.copyOfRange(message.payload, 4, 20);
            try {
                store.save(new NukiCredentialStore.Credentials(deviceAddress,
                        authorizationId, appId, lockUuid, sharedKey));
            } catch (GeneralSecurityException error) {
                fail("Nuki autorizacija je uspjela, ali spremanje vjerodajnica nije", error);
                return;
            }
            succeed("Nuki autorizacija i sigurno spremanje uspješni");
            return;
        }
        throw new IllegalArgumentException("Unexpected pairing command 0x"
                + Integer.toHexString(message.command) + " in " + phase);
    }

    private void handleActionMessage(NukiProtocol.ParsedPlain message) {
        if (message.command == NukiProtocol.CHALLENGE && phase == Phase.WAIT_ACTION_CHALLENGE) {
            if (message.payload.length != 32) throw new IllegalArgumentException("Bad challenge");
            phase = Phase.WAIT_ACTION_RESULT;
            progress("Nuki akcija", "action=" + actionName());
            write(crypto.encrypt(credentials.authorizationId, NukiProtocol.LOCK_ACTION,
                    NukiProtocol.lockAction(action, credentials.appId, message.payload),
                    credentials.sharedKey));
            return;
        }
        if (message.command == NukiProtocol.STATUS && phase == Phase.WAIT_ACTION_RESULT) {
            if (message.payload.length != 1) throw new IllegalArgumentException("Bad status");
            int status = Byte.toUnsignedInt(message.payload[0]);
            progress("Nuki status akcije", "status=" + status);
            if (status == 0x00) succeed("Nuki " + actionName() + " uspješno izvršen");
            else if (status != 0x01) fail("Nepoznat Nuki status akcije " + status, null);
            return;
        }
        if (message.command == 0x0012) {
            int code = message.payload.length == 0 ? -1 : Byte.toUnsignedInt(message.payload[0]);
            fail("Nuki je vratio grešku 0x" + Integer.toHexString(code), null);
            return;
        }
        // Keyturner-state indications can arrive between ACCEPTED and COMPLETE.
        progress("Nuki indikacija", "command=0x" + Integer.toHexString(message.command));
    }

    private String actionName() {
        return action == 0x01 ? "unlock" : "lock";
    }

    private void progress(String message, String detail) {
        AutomationLog.step(message, detail);
        handler.post(() -> listener.onProgress(message));
    }

    private synchronized void succeed(String message) {
        if (phase == Phase.FINISHED) return;
        phase = Phase.FINISHED;
        AutomationLog.step(message);
        cancelTransport();
        handler.post(() -> listener.onSuccess(message));
    }

    private synchronized void fail(String message, Throwable error) {
        if (phase == Phase.FINISHED) return;
        phase = Phase.FINISHED;
        pin = 0;
        AutomationLog.error("Nuki operation failed", message, error);
        cancelTransport();
        handler.post(() -> listener.onError(message, error));
    }

    @SuppressLint("MissingPermission")
    private void cancelTransport() {
        if (scanner != null) scanner.stopScan(scanCallback);
        scanner = null;
        handler.removeCallbacksAndMessages(null);
        if (gatt != null) {
            gatt.disconnect();
            gatt.close();
            gatt = null;
        }
    }
}
