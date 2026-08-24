#pragma once

#include "../../cpp/core/ContextAdapter.hpp"
#include "../../cpp/core/HttpAdapter.hpp"
#include "../../cpp/core/JsonlSegmentStore.hpp"
#include "../../cpp/core/StorageAdapter.hpp"

#include <map>
#include <mutex>
#include <string>

namespace NitroAmplitude {

class IOSAmplitudeAdapterCpp
    : public ContextAdapter,
      public StorageAdapter,
      public HttpAdapter {
public:
  IOSAmplitudeAdapterCpp();
  ~IOSAmplitudeAdapterCpp() override = default;

  void prefetchContext() override;
  std::string getApplicationContextJson(const std::string& optionsJson) override;

  void setDisk(const std::string& key, const std::string& value) override;
  std::optional<std::string> getDisk(const std::string& key) override;
  void deleteDisk(const std::string& key) override;
  bool hasDisk(const std::string& key) override;
  std::vector<std::string> getAllDiskKeys() override;

  HttpResult performHttpRequest(
      const std::string& url,
      const std::string& method,
      const std::unordered_map<std::string, std::string>& headers,
      const std::string& body,
      int timeoutMillis) override;

private:
  std::mutex contextCacheMutex_;
  std::map<std::string, std::string> contextCache_;
  std::shared_ptr<JsonlSegmentStore> diskStore_;

  void MigrateLegacyDisk();
};

} // namespace NitroAmplitude
