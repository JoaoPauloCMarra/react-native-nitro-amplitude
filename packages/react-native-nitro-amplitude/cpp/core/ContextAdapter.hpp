#pragma once

#include <string>

namespace NitroAmplitude {

class ContextAdapter {
public:
  virtual ~ContextAdapter() = default;

  virtual void prefetchContext() = 0;
  virtual std::string getApplicationContextJson(const std::string& optionsJson) = 0;
};

} // namespace NitroAmplitude
