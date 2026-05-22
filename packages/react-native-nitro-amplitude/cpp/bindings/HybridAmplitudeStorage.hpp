#pragma once

#include "HybridAmplitudeStorageSpec.hpp"
#include "../core/NativeAmplitudeAdapter.hpp"
#include <memory>
#include <mutex>
#include <unordered_map>

namespace margelo::nitro::NitroAmplitude {

class HybridAmplitudeStorage : public HybridAmplitudeStorageSpec {
public:
  HybridAmplitudeStorage();
  ~HybridAmplitudeStorage() override = default;

  void set(const std::string& key, const std::string& value, bool persist) override;
  std::optional<std::string> get(const std::string& key, bool persist) override;
  void remove(const std::string& key, bool persist) override;
  void clear(bool persist) override;
  bool has(const std::string& key, bool persist) override;
  std::vector<std::string> getAllKeys(bool persist) override;
  std::vector<std::string> getKeysByPrefix(const std::string& prefix, bool persist) override;
  void setBatch(
      const std::vector<std::string>& keys,
      const std::vector<std::string>& values,
      bool persist) override;
  std::vector<std::string> getBatch(
      const std::vector<std::string>& keys,
      bool persist) override;
  void removeBatch(const std::vector<std::string>& keys, bool persist) override;

private:
  std::shared_ptr<::NitroAmplitude::NativeAmplitudeAdapter> adapter_;
  std::unordered_map<std::string, std::string> memoryStore_;
  std::mutex memoryMutex_;
};

} // namespace margelo::nitro::NitroAmplitude
