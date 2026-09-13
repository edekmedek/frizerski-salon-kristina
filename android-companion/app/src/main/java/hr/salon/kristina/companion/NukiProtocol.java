package hr.salon.kristina.companion;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

/** Packet formats from Nuki Smart Lock Bluetooth API 2.3.1. */
public final class NukiProtocol {
    public static final int IBEACON_MANUFACTURER_ID = 0x004C;
    private static final byte[] NUKI_IBEACON_PREFIX = new byte[]{
            0x02, 0x15,
            (byte) 0xA9, 0x2E, (byte) 0xE2, 0x00,
            0x55, 0x01, 0x11, (byte) 0xE4,
            (byte) 0x91, 0x6C, 0x08, 0x00,
            0x20, 0x0C, (byte) 0x9A, 0x66
    };
    public static final UUID PAIRING_SERVICE = uuid("a92ee300-5501-11e4-916c-0800200c9a66");
    public static final UUID PAIRING_GDIO = uuid("a92ee301-5501-11e4-916c-0800200c9a66");
    public static final UUID KEYTURNER_SERVICE = uuid("a92ee200-5501-11e4-916c-0800200c9a66");
    public static final UUID KEYTURNER_USDIO = uuid("a92ee202-5501-11e4-916c-0800200c9a66");
    public static final UUID CLIENT_CONFIGURATION = uuid("00002902-0000-1000-8000-00805f9b34fb");

    public static final int REQUEST_DATA = 0x0001;
    public static final int PUBLIC_KEY = 0x0003;
    public static final int CHALLENGE = 0x0004;
    public static final int AUTHORIZATION_AUTHENTICATOR = 0x0005;
    public static final int AUTHORIZATION_DATA = 0x0006;
    public static final int AUTHORIZATION_ID = 0x0007;
    public static final int KEYTURNER_STATES = 0x000C;
    public static final int LOCK_ACTION = 0x000D;
    public static final int STATUS = 0x000E;
    public static final int AUTHORIZATION_INFO = 0x004C;
    public static final long PAIRING_AUTHORIZATION_ID = 0x7FFFFFFFL;

    private NukiProtocol() {}

    public static boolean isPlausibleNukiAdvertisement(String deviceName,
            byte[] manufacturerData) {
        return isPlausibleNukiAdvertisement(deviceName, manufacturerData, null);
    }

    public static boolean isPlausibleNukiAdvertisement(String deviceName,
            byte[] manufacturerData, byte[] pairingServiceData) {
        if (deviceName == null || !deviceName.matches("Nuki_[0-9A-Fa-f]{8}")) return false;
        if (manufacturerData != null
                && manufacturerData.length >= NUKI_IBEACON_PREFIX.length) {
            boolean prefixMatches = true;
            for (int index = 0; index < NUKI_IBEACON_PREFIX.length; index++) {
                if (manufacturerData[index] != NUKI_IBEACON_PREFIX[index]) {
                    prefixMatches = false;
                    break;
                }
            }
            if (prefixMatches) return true;
        }
        if (pairingServiceData == null || pairingServiceData.length != 4) return false;
        String expectedSuffix = deviceName.substring("Nuki_".length());
        StringBuilder actualSuffix = new StringBuilder(8);
        for (byte value : pairingServiceData) {
            actualSuffix.append(String.format("%02X", value & 0xFF));
        }
        return expectedSuffix.equalsIgnoreCase(actualSuffix.toString());
    }

    public static byte[] request(int command) {
        return plain(REQUEST_DATA, le16(command));
    }

    public static byte[] publicKey(byte[] key) {
        requireLength(key, 32, "public key");
        return plain(PUBLIC_KEY, key);
    }

    public static byte[] authorizationAuthenticator(byte[] authenticator) {
        requireLength(authenticator, 32, "authenticator");
        return plain(AUTHORIZATION_AUTHENTICATOR, authenticator);
    }

    public static byte[] authorizationData(long appId, String name, long securityPin) {
        return plain(AUTHORIZATION_DATA, authorizationDataPayload(appId, name, securityPin));
    }

    public static byte[] authorizationDataPayload(long appId, String name, long securityPin) {
        if (securityPin < 0 || securityPin > 999999) {
            throw new IllegalArgumentException("Security PIN must contain six decimal digits");
        }
        byte[] fixedName = new byte[32];
        byte[] encoded = name.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(encoded, 0, fixedName, 0, Math.min(encoded.length, fixedName.length));
        return concat(le32(appId), fixedName, le32(securityPin));
    }

    public static byte[] lockAction(byte action, long appId, byte[] challenge) {
        requireLength(challenge, 32, "challenge");
        return concat(new byte[]{action}, le32(appId), new byte[]{0x00}, challenge);
    }

    public static String confirmedLockState(byte[] payload) {
        if (payload == null || payload.length < 2) {
            throw new IllegalArgumentException("Bad keyturner states payload");
        }
        int lockState = Byte.toUnsignedInt(payload[1]);
        if (lockState == 0x01) return "locked";
        if (lockState == 0x03) return "unlocked";
        return "unknown";
    }

    public static boolean isTransitionalLockState(byte[] payload) {
        if (payload == null || payload.length < 2) {
            throw new IllegalArgumentException("Bad keyturner states payload");
        }
        int state = Byte.toUnsignedInt(payload[1]);
        return state == 0x02 || state == 0x04 || state == 0x05
                || state == 0x06 || state == 0x07;
    }

    public static byte[] plain(int command, byte[] payload) {
        byte[] withoutCrc = concat(le16(command), payload);
        return concat(withoutCrc, le16(crc(withoutCrc)));
    }

    public static ParsedPlain parsePlain(byte[] message) {
        if (message.length < 4 || crc(Arrays.copyOf(message, message.length - 2))
                != u16(message, message.length - 2)) {
            throw new IllegalArgumentException("Invalid Nuki CRC");
        }
        return new ParsedPlain(u16(message, 0), Arrays.copyOfRange(message, 2, message.length - 2));
    }

    public static byte[] encryptedPlaintext(long authorizationId, int command, byte[] payload) {
        byte[] body = concat(le32(authorizationId), le16(command), payload);
        return concat(body, le16(crc(body)));
    }

    public static long u32(byte[] value, int offset) {
        return Integer.toUnsignedLong(ByteBuffer.wrap(value, offset, 4)
                .order(ByteOrder.LITTLE_ENDIAN).getInt());
    }

    public static int u16(byte[] value, int offset) {
        return Short.toUnsignedInt(ByteBuffer.wrap(value, offset, 2)
                .order(ByteOrder.LITTLE_ENDIAN).getShort());
    }

    public static byte[] le16(int value) {
        return ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort((short) value).array();
    }

    public static byte[] le32(long value) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt((int) value).array();
    }

    public static int crc(byte[] data) {
        int remainder = 0xFFFF;
        for (byte item : data) {
            remainder ^= (item & 0xFF) << 8;
            for (int bit = 0; bit < 8; bit++) {
                remainder = (remainder & 0x8000) != 0
                        ? ((remainder << 1) ^ 0x1021) & 0xFFFF
                        : (remainder << 1) & 0xFFFF;
            }
        }
        return remainder;
    }

    public static byte[] concat(byte[]... values) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (byte[] value : values) output.write(value, 0, value.length);
        return output.toByteArray();
    }

    private static void requireLength(byte[] value, int length, String label) {
        if (value == null || value.length != length) {
            throw new IllegalArgumentException(label + " must be " + length + " bytes");
        }
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }

    public static final class ParsedPlain {
        public final int command;
        public final byte[] payload;

        ParsedPlain(int command, byte[] payload) {
            this.command = command;
            this.payload = payload;
        }
    }
}
