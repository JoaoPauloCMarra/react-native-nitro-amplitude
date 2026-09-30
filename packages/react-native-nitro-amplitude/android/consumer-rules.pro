# NitroAmplitude - JNI-callable methods must survive R8/ProGuard shrinking

-keep class com.nitroamplitude.AndroidAmplitudeAdapter {
    public static <methods>;
}

-keep class com.nitroamplitude.NitroAmplitudePackage {
    <init>();
    <clinit>();
    *;
}

-keep class com.margelo.nitro.com.nitroamplitude.NitroAmplitudeOnLoad {
    public static *** initializeNative(...);
}
