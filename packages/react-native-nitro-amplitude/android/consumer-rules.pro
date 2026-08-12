# NitroAmplitude - JNI-callable methods must survive R8/ProGuard shrinking

-keep class com.nitroamplitude.AndroidAmplitudeAdapter {
    public static *** setContext(...);
    public static *** getContext(...);
    public static *** prefetchContext(...);
    public static *** getApplicationContextJson(...);
    public static *** setDisk(...);
    public static *** getDisk(...);
    public static *** deleteDisk(...);
    public static *** hasDisk(...);
    public static *** getAllDiskKeys(...);
    public static *** performHttpRequest(...);
}

-keep class com.nitroamplitude.AndroidAmplitudeAdapter$Companion {
    public <methods>;
}

-keep class com.nitroamplitude.NitroAmplitudePackage {
    <init>();
    <clinit>();
    *;
}

-keep class com.nitroamplitude.NitroAmplitudePackageKt {
    public static *** initializeNitroAmplitude(...);
}

-keep class com.margelo.nitro.com.nitroamplitude.NitroAmplitudeOnLoad {
    public static *** initializeNative(...);
}
