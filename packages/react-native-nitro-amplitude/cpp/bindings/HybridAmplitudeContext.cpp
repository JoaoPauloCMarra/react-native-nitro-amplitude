#include "HybridAmplitudeContext.hpp"

#include "../core/PlatformAdapterFactory.hpp"

#include <cmath>
#include <stdexcept>

namespace margelo::nitro::NitroAmplitude {

HybridAmplitudeContext::HybridAmplitudeContext()
    : HybridObject(TAG), HybridAmplitudeContextSpec() {
  adapter_ = ::NitroAmplitude::getSharedPlatformAdapter();
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
  const double int64Limit = std::ldexp(1.0, 63);
  if (!std::isfinite(eventId) ||
      std::trunc(eventId) != eventId ||
      eventId < -int64Limit ||
      eventId >= int64Limit) {
    throw std::runtime_error("NitroAmplitude: Invalid eventId");
  }
  if (!adapter_) {
    return;
  }
  adapter_->removeLegacyEvent(instanceName, eventKind, static_cast<int64_t>(eventId));
}

} // namespace margelo::nitro::NitroAmplitude
