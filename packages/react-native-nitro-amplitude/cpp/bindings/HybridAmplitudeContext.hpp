#pragma once

#include "HybridAmplitudeContextSpec.hpp"
#include "../core/ContextAdapter.hpp"
#include <memory>
#include <string>

namespace margelo::nitro::NitroAmplitude {

class HybridAmplitudeContext : public HybridAmplitudeContextSpec {
public:
  HybridAmplitudeContext();
  explicit HybridAmplitudeContext(std::shared_ptr<::NitroAmplitude::ContextAdapter> adapter);
  ~HybridAmplitudeContext() override = default;

  void prefetch() override;
  std::string getApplicationContextJson(const std::string& optionsJson) override;

private:
  std::shared_ptr<::NitroAmplitude::ContextAdapter> adapter_;
};

} // namespace margelo::nitro::NitroAmplitude
