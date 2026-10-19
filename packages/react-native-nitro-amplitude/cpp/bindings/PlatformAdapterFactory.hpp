#pragma once

#include "../core/ContextAdapter.hpp"
#include "../core/HttpAdapter.hpp"
#include "../core/StorageAdapter.hpp"
#include <memory>

#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
#include "../../ios/IOSAmplitudeAdapterCpp.hpp"
#elif __ANDROID__
#include "../../android/src/main/cpp/AndroidAmplitudeAdapterCpp.hpp"
#endif
#endif

namespace NitroAmplitude {

struct PlatformAdapters {
  std::shared_ptr<ContextAdapter> context;
  std::shared_ptr<StorageAdapter> storage;
  std::shared_ptr<HttpAdapter> http;
};

inline PlatformAdapters getSharedPlatformAdapters() {
#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
  static std::shared_ptr<IOSAmplitudeAdapterCpp> adapter =
      std::make_shared<IOSAmplitudeAdapterCpp>();
  return PlatformAdapters{adapter, adapter, adapter};
#elif __ANDROID__
  static std::shared_ptr<AndroidAmplitudeAdapterCpp> adapter =
      std::make_shared<AndroidAmplitudeAdapterCpp>();
  return PlatformAdapters{adapter, adapter, adapter};
#endif
#endif
  return PlatformAdapters{nullptr, nullptr, nullptr};
}

} // namespace NitroAmplitude
