#include "HybridAmplitudeContext.hpp"

#include "../core/PlatformAdapterFactory.hpp"

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

} // namespace margelo::nitro::NitroAmplitude
