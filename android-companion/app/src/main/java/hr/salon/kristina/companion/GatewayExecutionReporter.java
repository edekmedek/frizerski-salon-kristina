package hr.salon.kristina.companion;

public final class GatewayExecutionReporter {
    public interface Listener { void onResult(String result, String detail); }
    private static String device;
    private static Listener listener;
    private GatewayExecutionReporter() {}
    public static synchronized boolean begin(String nextDevice, Listener nextListener) {
        if (listener != null) return false;
        device = nextDevice; listener = nextListener; return true;
    }
    public static synchronized void report(String sourceDevice, String result, String detail) {
        if (listener == null || !sourceDevice.equals(device)) return;
        Listener completed = listener; listener = null; device = null;
        completed.onResult(result, detail);
    }
    public static synchronized void clear() { listener = null; device = null; }
}
