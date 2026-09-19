#include "Gzip.hpp"

#include <algorithm>
#include <cctype>
#include <zlib.h>

namespace NitroAmplitude {
namespace {

constexpr size_t kMinGzipBodyBytes = 1024;

std::string toLower(std::string_view value) {
    std::string lowered(value);
    std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char character) {
        return static_cast<char>(std::tolower(character));
    });
    return lowered;
}

bool hasHeader(
    const std::unordered_map<std::string, std::string>& headers,
    std::string_view name
) {
    const std::string needle = toLower(name);
    for (const auto& header : headers) {
        if (toLower(header.first) == needle && !header.second.empty()) {
            return true;
        }
    }
    return false;
}

} // namespace

std::optional<std::string> gzipCompress(const std::string& input) {
    if (input.empty()) {
        return std::nullopt;
    }

    z_stream stream{};
    if (deflateInit2(
            &stream,
            Z_DEFAULT_COMPRESSION,
            Z_DEFLATED,
            15 + 16,
            8,
            Z_DEFAULT_STRATEGY
        ) != Z_OK) {
        return std::nullopt;
    }

    stream.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(input.data()));
    stream.avail_in = static_cast<uInt>(input.size());

    std::string output;
    output.resize(deflateBound(&stream, static_cast<uLong>(input.size())));
    stream.next_out = reinterpret_cast<Bytef*>(output.data());
    stream.avail_out = static_cast<uInt>(output.size());

    const int rc = deflate(&stream, Z_FINISH);
    const size_t produced = output.size() - stream.avail_out;
    deflateEnd(&stream);
    if (rc != Z_STREAM_END || produced == 0 || produced >= input.size()) {
        return std::nullopt;
    }
    output.resize(produced);
    return output;
}

bool shouldGzipAmplitudeRequest(
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    std::string_view body
) {
    const std::string loweredMethod = toLower(method);
    if (loweredMethod != "post" && loweredMethod != "put") {
        return false;
    }
    if (body.size() < kMinGzipBodyBytes) {
        return false;
    }
    if (url.find("amplitude.com") == std::string::npos) {
        return false;
    }
    if (hasHeader(headers, "Content-Encoding")) {
        return false;
    }
    return true;
}

} // namespace NitroAmplitude
