#pragma once

#include <optional>
#include <string>
#include <vector>

namespace NitroAmplitude {

struct HttpResult {
  int statusCode = 0;
  std::string body;
  std::string error;
};

class NativeAmplitudeAdapter {
public:
  virtual ~NativeAmplitudeAdapter() = default;

  virtual void prefetchContext() = 0;
  virtual std::string getApplicationContextJson(const std::string& optionsJson) = 0;
  virtual std::string getLegacySessionDataJson(const std::string& instanceName) = 0;
  virtual std::vector<std::string> getLegacyEventsJson(
      const std::string& instanceName,
      const std::string& eventKind) = 0;
  virtual void removeLegacyEvent(
      const std::string& instanceName,
      const std::string& eventKind,
      int64_t eventId) = 0;

  virtual void setDisk(const std::string& key, const std::string& value) = 0;
  virtual std::optional<std::string> getDisk(const std::string& key) = 0;
  virtual void deleteDisk(const std::string& key) = 0;
  virtual bool hasDisk(const std::string& key) = 0;
  virtual std::vector<std::string> getAllDiskKeys() = 0;

  virtual HttpResult performHttpRequest(
      const std::string& url,
      const std::string& method,
      const std::string& headersJson,
      const std::string& body,
      int timeoutMillis) = 0;
};

} // namespace NitroAmplitude
