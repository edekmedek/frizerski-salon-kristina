package hr.salon.kristina.companion;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;
import org.junit.Test;

public class HardwareCommandTest {
    @Test public void validatesStrictDeviceActionPairs() {
        assertTrue(HardwareCommand.valid("camera", "open_live"));
        assertTrue(HardwareCommand.valid("boiler", "status"));
        assertTrue(HardwareCommand.valid("nuki", "unlock"));
        assertFalse(HardwareCommand.valid("camera", "unlock"));
        assertFalse(HardwareCommand.valid("nuki", "on"));
    }
    @Test public void usesConservativeGatewayIntervalsAndBoundedBackoff() {
        assertEquals(120_000L, HardwareGatewayService.FALLBACK_POLL_MS);
        assertEquals(60_000L, HardwareGatewayService.HEARTBEAT_MS);
        assertEquals(5_000L, HardwareRealtimeClient.reconnectDelay(0));
        assertEquals(120_000L, HardwareRealtimeClient.reconnectDelay(99));
    }
    @Test public void schedulesAutoLockOnlyForGatewayNukiUnlock() {
        assertTrue(new HardwareCommand("1", "nuki", "unlock").schedulesNukiAutoLock());
        assertFalse(new HardwareCommand("2", "nuki", "lock").schedulesNukiAutoLock());
        assertFalse(new HardwareCommand("3", "boiler", "on").schedulesNukiAutoLock());
        assertEquals(20_000L, HardwareGatewayService.NUKI_AUTO_LOCK_DELAY_MS);
    }
    @Test public void localUnlockRemainsPlainUnlock() {
        assertEquals(0x01, Byte.toUnsignedInt(NukiCommand.UNLOCK.action));
        assertFalse(NukiCommand.UNLOCK == NukiCommand.OPEN_DOOR);
    }
}
