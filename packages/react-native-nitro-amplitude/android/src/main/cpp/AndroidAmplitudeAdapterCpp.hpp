#pragma once

#include "ContextAdapter.hpp"
#include "HttpAdapter.hpp"
#include "JsonlSegmentStore.hpp"
#include "LegacyDiskMigration.hpp"
#include "StorageAdapter.hpp"
#include <fbjni/fbjni.h>
#include <memory>
#include <mutex>

namespace NitroAmplitude {

struct AndroidAmplitudeAdapterJava : facebook::jni::JavaClass<AndroidAmplitudeAdapterJava> {
  static constexpr auto kJavaDescriptor = "Lcom/nitroamplitude/AndroidAmplitudeAdapter;";
};

class AndroidAmplitudeAdapterCpp
    : public ContextAdapter,
      public StorageAdapter,
      public HttpAdapter {
public:
  AndroidAmplitudeAdapterCpp();
  ~AndroidAmplitudeAdapterCpp() override = default;

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
  std::mutex diskStoreMutex_;
  std::shared_ptr<JsonlSegmentStore> diskStore_;
  MigratingStorage storage_;

  std::shared_ptr<JsonlSegmentStore> EnsureDiskStore();
};

} // namespace NitroAmplitude
