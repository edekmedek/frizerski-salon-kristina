package hr.salon.kristina.companion;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Vectors copied from the command examples in Nuki Bluetooth API v2.3.1. */
public final class NukiProtocolTest {
    @Test
    public void observedSmartLockGoIBeaconAdvertisement_isAccepted() {
        assertEquals(true, NukiProtocol.isPlausibleNukiAdvertisement(
                "Nuki_4CCA88EC",
                hex("0215A92EE200550111E4916C0800200C9A664CCA88ECC8")));
    }

    @Test
    public void observedSmartLockGoPairingServiceData_isAccepted() {
        assertEquals(true, NukiProtocol.isPlausibleNukiAdvertisement(
                "Nuki_4CCA88EC", null, hex("4CCA88EC")));
    }

    @Test
    public void pairingServiceDataWithWrongLength_isRejected() {
        assertEquals(false, NukiProtocol.isPlausibleNukiAdvertisement(
                "Nuki_4CCA88EC", null, hex("4CCA88")));
    }

    @Test
    public void pairingServiceDataNotMatchingName_isRejected() {
        assertEquals(false, NukiProtocol.isPlausibleNukiAdvertisement(
                "Nuki_4CCA88EC", null, hex("4CCA88ED")));
    }

    @Test
    public void pairingServiceDataWithoutNukiName_isRejected() {
        assertEquals(false, NukiProtocol.isPlausibleNukiAdvertisement(
                "Other_4CCA88EC", null, hex("4CCA88EC")));
    }

    @Test
    public void advertisementWithoutNukiName_isRejected() {
        assertEquals(false, NukiProtocol.isPlausibleNukiAdvertisement(
                "Other_4CCA88EC",
                hex("0215A92EE200550111E4916C0800200C9A664CCA88ECC8")));
    }

    @Test
    public void advertisementWithWrongProximityUuid_isRejected() {
        assertEquals(false, NukiProtocol.isPlausibleNukiAdvertisement(
                "Nuki_4CCA88EC",
                hex("0215A92EE300550111E4916C0800200C9A664CCA88ECC8")));
    }

    @Test
    public void requestPublicKey_matchesFifthGenerationAuthorizationExample() {
        assertArrayEquals(hex("0100030027A7"), NukiProtocol.request(NukiProtocol.PUBLIC_KEY));
    }

    @Test
    public void publicKey_matchesFifthGenerationAuthorizationExample() {
        assertArrayEquals(hex(
                "0300CAD42392DE77329DD8B130419D7B86D228D1901B5DD618C375E6864EF94463283E4D"),
                NukiProtocol.publicKey(hex(
                        "CAD42392DE77329DD8B130419D7B86D228D1901B5DD618C375E6864EF9446328")));
    }

    @Test
    public void authorizationAuthenticator_matchesFifthGenerationExample() {
        assertArrayEquals(hex(
                "050006D99C56E63679964A6C2A60E692F4E1B7BC13B1216F052B0F65BD007BDB90EDE02C"),
                NukiProtocol.authorizationAuthenticator(hex(
                        "06D99C56E63679964A6C2A60E692F4E1B7BC13B1216F052B0F65BD007BDB90ED")));
    }

    @Test
    public void fifthGenerationAuthorizationData_usesUint32Pin() {
        NukiProtocol.ParsedPlain parsed = NukiProtocol.parsePlain(
                NukiProtocol.authorizationData(0, "Testapp", 123456));
        assertEquals(NukiProtocol.AUTHORIZATION_DATA, parsed.command);
        assertEquals(40, parsed.payload.length);
        assertEquals(123456, NukiProtocol.u32(parsed.payload, 36));
    }

    @Test
    public void requestChallengeEncryptedPlaintext_matchesUnlockExample() {
        assertArrayEquals(hex("0200000001000400E804"),
                NukiProtocol.encryptedPlaintext(2, NukiProtocol.REQUEST_DATA,
                        NukiProtocol.le16(NukiProtocol.CHALLENGE)));
    }

    @Test
    public void unlockPlaintext_matchesOfficialExample() {
        byte[] challenge = hex(
                "57D95521BEA186B5A9244F025737924C5B7E33592D0614D5F6EF2E2F142C6D4B");
        byte[] result = NukiProtocol.encryptedPlaintext(2, NukiProtocol.LOCK_ACTION,
                NukiProtocol.lockAction((byte) 1, 0, challenge));
        assertArrayEquals(hex(
                "020000000D0001000000000057D95521BEA186B5A9244F025737924C5B7E33592D0614D5F6EF2E2F142C6D4BCACF"),
                result);
        assertEquals(NukiProtocol.LOCK_ACTION, NukiProtocol.u16(result, 4));
        assertEquals(NukiProtocol.crc(java.util.Arrays.copyOf(result, result.length - 2)),
                NukiProtocol.u16(result, result.length - 2));
    }

    private static byte[] hex(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int index = 0; index < result.length; index++) {
            result[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }
}
