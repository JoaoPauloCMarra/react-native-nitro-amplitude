#pragma once

#include "HybridAmplitudeContextSpec.hpp"
#include "../core/NativeAmplitudeAdapter.hpp"
#include <memory>

namespace margelo::nitro::NitroAmplitude {

class HybridAmplitudeContext : public HybridAmplitudeContextSpec {
public:
  HybridAmplitudeContext();
  ~HybridAmplitudeContext() override = default;

  void prefetch() override;
  std::string getApplicationContextJson(const std::string& optionsJson) override;
  std::string getLegacySessionDataJson(const std::string& instanceName) override;
  std::vector<std::string> getLegacyEventsJson(
      const std::string& instanceName,
      const std::string& eventKind) override;
  void removeLegacyEvent(
      const std::string& instanceName,
      const std::string& eventKind,
      double eventId) override;

private:
  std::shared_ptr<::NitroAmplitude::NativeAmplitudeAdapter> adapter_;
};

} // namespace margelo::nitro::NitroAmplitude
