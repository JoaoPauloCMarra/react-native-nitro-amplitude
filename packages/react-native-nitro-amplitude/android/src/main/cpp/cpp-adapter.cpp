#include <jni.h>
#include <fbjni/fbjni.h>
#include "../../../nitrogen/generated/android/NitroAmplitudeOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::NitroAmplitude::registerAllNatives();
  });
}
