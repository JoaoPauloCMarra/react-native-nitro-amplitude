#include "HybridAmplitudeContext.hpp"

#include "../core/PlatformAdapterFactory.hpp"

#include <cmath>
#include <stdexcept>

namespace margelo::nitro::NitroAmplitude {

HybridAmplitudeContext::HybridAmplitudeContext()
    : HybridObject(TAG), HybridAmplitudeContextSpec() {
  adapter_ = ::NitroAmplitude::getSharedPlatformAdapters().context;
}

HybridAmplitudeContext::HybridAmplitudeContext(
    std::shared_ptr<::NitroAmplitude::ContextAdapter> adapter)
    : HybridObject(TAG), HybridAmplitudeContextSpec(), adapter_(std::move(adapter)) {}

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
    const std::string&) {
  return "{}";
}

std::vector<std::string> HybridAmplitudeContext::getLegacyEventsJson(
    const std::string&,
    const std::string&) {
  return {};
}

void HybridAmplitudeContext::removeLegacyEvent(
    const std::string&,
    const std::string&,
    double eventId) {
  const double int64Limit = std::ldexp(1.0, 63);
  if (!std::isfinite(eventId) ||
      std::trunc(eventId) != eventId ||
      eventId < -int64Limit ||
      eventId >= int64Limit) {
    throw std::runtime_error("NitroAmplitude: Invalid eventId");
  }
}

} // namespace margelo::nitro::NitroAmplitude
