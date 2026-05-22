#pragma once

#include "../../cpp/core/NativeAmplitudeAdapter.hpp"
#include <fbjni/fbjni.h>

namespace NitroAmplitude {

struct AndroidAmplitudeAdapterJava : facebook::jni::JavaClass<AndroidAmplitudeAdapterJava> {
  static constexpr auto kJavaDescriptor = "Lcom/nitroamplitude/AndroidAmplitudeAdapter;";

  static facebook::jni::alias_ref<facebook::jni::JObject> getContext() {
    static auto method = javaClassStatic()->getStaticMethod<facebook::jni::JObject()>(
        "getContext", "()Landroid/content/Context;");
    return method(javaClassStatic());
  }
};

class AndroidAmplitudeAdapterCpp : public NativeAmplitudeAdapter {
public:
  explicit AndroidAmplitudeAdapterCpp(facebook::jni::alias_ref<facebook::jni::JObject> context);
  ~AndroidAmplitudeAdapterCpp() override = default;

  void prefetchContext() override;
  std::string getApplicationContextJson(const std::string& optionsJson) override;
  std::string getLegacySessionDataJson(const std::string& instanceName) override;
  std::vector<std::string> getLegacyEventsJson(
      const std::string& instanceName,
      const std::string& eventKind) override;
  void removeLegacyEvent(
      const std::string& instanceName,
      const std::string& eventKind,
      int64_t eventId) override;

  void setDisk(const std::string& key, const std::string& value) override;
  std::optional<std::string> getDisk(const std::string& key) override;
  void deleteDisk(const std::string& key) override;
  bool hasDisk(const std::string& key) override;
  std::vector<std::string> getAllDiskKeys() override;

  HttpResult performHttpRequest(
      const std::string& url,
      const std::string& method,
      const std::string& headersJson,
      const std::string& body,
      int timeoutMillis) override;
};

} // namespace NitroAmplitude
