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

bool isAmplitudeAuthority(std::string_view url) {
    const size_t schemeEnd = url.find("://");
    if (schemeEnd == std::string_view::npos) {
        return false;
    }

    const std::string scheme = toLower(url.substr(0, schemeEnd));
    if (scheme != "http" && scheme != "https") {
        return false;
    }

    const size_t authorityStart = schemeEnd + 3;
    const size_t authorityEnd = url.find_first_of("/?#", authorityStart);
    const std::string_view authority = url.substr(
        authorityStart,
        authorityEnd == std::string_view::npos
            ? std::string_view::npos
            : authorityEnd - authorityStart);
    if (authority.empty() || authority.find('@') != std::string_view::npos) {
        return false;
    }

    const size_t colon = authority.find(':');
    const std::string_view host = authority.substr(0, colon);
    if (host.empty() || (colon != std::string_view::npos &&
        authority.find(':', colon + 1) != std::string_view::npos)) {
        return false;
    }

    if (colon != std::string_view::npos) {
        const std::string_view port = authority.substr(colon + 1);
        if (port.empty()) {
            return false;
        }
        uint32_t portNumber = 0;
        for (const char character : port) {
            if (character < '0' || character > '9') {
                return false;
            }
            portNumber = portNumber * 10 + static_cast<uint32_t>(character - '0');
            if (portNumber > 65535) {
                return false;
            }
        }
        if (portNumber == 0) {
            return false;
        }
    }

    const std::string loweredHost = toLower(host);
    if (loweredHost.size() > 253) {
        return false;
    }
    size_t labelStart = 0;
    while (labelStart < loweredHost.size()) {
        const size_t dot = loweredHost.find('.', labelStart);
        const size_t labelEnd = dot == std::string::npos ? loweredHost.size() : dot;
        const size_t labelLength = labelEnd - labelStart;
        if (labelLength == 0 || labelLength > 63 ||
            loweredHost[labelStart] == '-' || loweredHost[labelEnd - 1] == '-') {
            return false;
        }
        for (size_t i = labelStart; i < labelEnd; ++i) {
            const char character = loweredHost[i];
            if (!((character >= 'a' && character <= 'z') ||
                  (character >= '0' && character <= '9') || character == '-')) {
                return false;
            }
        }
        if (dot == std::string::npos) {
            break;
        }
        labelStart = dot + 1;
    }

    constexpr std::string_view amplitudeDomain = "amplitude.com";
    return loweredHost == amplitudeDomain ||
        (loweredHost.size() > amplitudeDomain.size() &&
         loweredHost.compare(
             loweredHost.size() - amplitudeDomain.size(),
             amplitudeDomain.size(),
             amplitudeDomain) == 0 &&
         loweredHost[loweredHost.size() - amplitudeDomain.size() - 1] == '.');
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
    if (!isAmplitudeAuthority(url)) {
        return false;
    }
    if (hasHeader(headers, "Content-Encoding")) {
        return false;
    }
    return true;
}

} // namespace NitroAmplitude
