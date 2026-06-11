#pragma once

#include "NativeAmplitudeAdapter.hpp"
#include <memory>

#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
#include "../../ios/IOSAmplitudeAdapterCpp.hpp"
#elif __ANDROID__
#include "../../android/src/main/cpp/AndroidAmplitudeAdapterCpp.hpp"
#include <fbjni/fbjni.h>
#endif
#endif

namespace NitroAmplitude {

inline std::shared_ptr<NativeAmplitudeAdapter> getSharedPlatformAdapter() {
#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
  static std::shared_ptr<NativeAmplitudeAdapter> adapter =
      std::make_shared<IOSAmplitudeAdapterCpp>();
  return adapter;
#elif __ANDROID__
  static std::shared_ptr<NativeAmplitudeAdapter> adapter =
      std::make_shared<AndroidAmplitudeAdapterCpp>(AndroidAmplitudeAdapterJava::getContext());
  return adapter;
#else
  return nullptr;
#endif
#else
  return nullptr;
#endif
}

} // namespace NitroAmplitude
