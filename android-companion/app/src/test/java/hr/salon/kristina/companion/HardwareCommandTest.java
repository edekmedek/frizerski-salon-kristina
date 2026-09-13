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
}
