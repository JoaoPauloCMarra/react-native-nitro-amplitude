#pragma once

#include <string>
#include <unordered_map>

namespace NitroAmplitude {

struct HttpResult {
  int statusCode = 0;
  std::string body;
  std::string error;
};

class HttpAdapter {
public:
  virtual ~HttpAdapter() = default;

  virtual HttpResult performHttpRequest(
      const std::string& url,
      const std::string& method,
      const std::unordered_map<std::string, std::string>& headers,
      const std::string& body,
      int timeoutMillis) = 0;
};

} // namespace NitroAmplitude
