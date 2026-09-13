package hr.salon.kristina.companion;

public final class HardwareCommand {
    public final String id;
    public final String device;
    public final String action;
    public HardwareCommand(String id, String device, String action) {
        if (!valid(device, action)) throw new IllegalArgumentException("Unsupported hardware command");
        this.id = id; this.device = device; this.action = action;
    }
    public static boolean valid(String device, String action) {
        return ("camera".equals(device) && "open_live".equals(action))
                || ("boiler".equals(device) && ("status".equals(action) || "on".equals(action) || "off".equals(action)))
                || ("nuki".equals(device) && ("lock".equals(action) || "unlock".equals(action)));
    }
}
