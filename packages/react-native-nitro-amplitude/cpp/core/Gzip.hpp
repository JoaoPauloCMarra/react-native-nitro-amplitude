#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>

namespace NitroAmplitude {

std::optional<std::string> gzipCompress(const std::string& input);

bool shouldGzipAmplitudeRequest(
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    std::string_view body);

} // namespace NitroAmplitude
