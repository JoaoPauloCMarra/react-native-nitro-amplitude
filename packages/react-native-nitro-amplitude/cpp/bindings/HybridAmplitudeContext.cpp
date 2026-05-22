#include "HybridAmplitudeContext.hpp"

#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
#include "../../ios/IOSAmplitudeAdapterCpp.hpp"
#elif __ANDROID__
#include "../../android/src/main/cpp/AndroidAmplitudeAdapterCpp.hpp"
#include <fbjni/fbjni.h>
#endif
#endif

#include <cmath>
#include <stdexcept>

namespace margelo::nitro::NitroAmplitude {

namespace {
std::shared_ptr<::NitroAmplitude::NativeAmplitudeAdapter> createPlatformAdapter() {
#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
  return std::make_shared<::NitroAmplitude::IOSAmplitudeAdapterCpp>();
#elif __ANDROID__
  auto context = ::NitroAmplitude::AndroidAmplitudeAdapterJava::getContext();
  return std::make_shared<::NitroAmplitude::AndroidAmplitudeAdapterCpp>(context);
#else
  return nullptr;
#endif
#else
  return nullptr;
#endif
}
} // namespace

HybridAmplitudeContext::HybridAmplitudeContext()
    : HybridObject(TAG), HybridAmplitudeContextSpec() {
  adapter_ = createPlatformAdapter();
}

void HybridAmplitudeContext::prefetch() {
  if (adapter_) {
    adapter_->prefetchContext();
  }
}

std::string HybridAmplitudeContext::getApplicationContextJson(
    const std::string& optionsJson) {
  if (!adapter_) {
    return "{}";
  }
  return adapter_->getApplicationContextJson(optionsJson);
}

std::string HybridAmplitudeContext::getLegacySessionDataJson(
    const std::string& instanceName) {
  if (!adapter_) {
    return "{}";
  }
  return adapter_->getLegacySessionDataJson(instanceName);
}

std::vector<std::string> HybridAmplitudeContext::getLegacyEventsJson(
    const std::string& instanceName,
    const std::string& eventKind) {
  if (!adapter_) {
    return {};
  }
  return adapter_->getLegacyEventsJson(instanceName, eventKind);
}

void HybridAmplitudeContext::removeLegacyEvent(
    const std::string& instanceName,
    const std::string& eventKind,
    double eventId) {
  if (!adapter_) {
    return;
  }
  if (std::isnan(eventId) || std::isinf(eventId)) {
    throw std::runtime_error("NitroAmplitude: Invalid eventId");
  }
  adapter_->removeLegacyEvent(instanceName, eventKind, static_cast<int64_t>(eventId));
}

} // namespace margelo::nitro::NitroAmplitude
