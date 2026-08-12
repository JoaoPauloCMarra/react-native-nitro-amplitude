#include "AndroidAmplitudeAdapterCpp.hpp"

#include <cstdio>

namespace NitroAmplitude {

using namespace facebook::jni;
using JavaStringArray = JArrayClass<jstring>;

namespace {

std::string escapeJsonString(const std::string& value) {
  std::string escaped = "\"";
  for (const char character : value) {
    switch (character) {
      case '"': escaped += "\\\""; break;
      case '\\': escaped += "\\\\"; break;
      case '\b': escaped += "\\b"; break;
      case '\f': escaped += "\\f"; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default:
        if (static_cast<unsigned char>(character) < 0x20) {
          char buffer[8];
          std::snprintf(buffer, sizeof(buffer), "\\u%04x", character);
          escaped += buffer;
        } else {
          escaped += character;
        }
    }
  }
  escaped += "\"";
  return escaped;
}

std::vector<std::string> fromJavaStringArray(alias_ref<JavaStringArray> values) {
  if (!values) {
    return {};
  }
  std::vector<std::string> result;
  const jsize size = values->size();
  result.reserve(size);
  for (jsize i = 0; i < size; ++i) {
    auto current = values->getElement(i);
    result.push_back(current ? current->toStdString() : std::string());
  }
  return result;
}

std::string toJsonObject(const std::unordered_map<std::string, std::string>& entries) {
  std::string json = "{";
  bool first = true;
  for (const auto& entry : entries) {
    if (!first) {
      json += ",";
    }
    first = false;
    json += escapeJsonString(entry.first);
    json += ":";
    json += escapeJsonString(entry.second);
  }
  json += "}";
  return json;
}

} // namespace

AndroidAmplitudeAdapterCpp::AndroidAmplitudeAdapterCpp(alias_ref<JObject> /*context*/) {}

void AndroidAmplitudeAdapterCpp::prefetchContext() {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<void()>("prefetchContext");
  method(AndroidAmplitudeAdapterJava::javaClassStatic());
}

std::string AndroidAmplitudeAdapterCpp::getApplicationContextJson(const std::string& optionsJson) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<jstring(std::string)>(
      "getApplicationContextJson", "(Ljava/lang/String;)Ljava/lang/String;");
  auto result = method(AndroidAmplitudeAdapterJava::javaClassStatic(), optionsJson);
  return result ? result->toStdString() : std::string("{}");
}

void AndroidAmplitudeAdapterCpp::setDisk(const std::string& key, const std::string& value) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<void(std::string, std::string)>(
      "setDisk", "(Ljava/lang/String;Ljava/lang/String;)V");
  method(AndroidAmplitudeAdapterJava::javaClassStatic(), key, value);
}

std::optional<std::string> AndroidAmplitudeAdapterCpp::getDisk(const std::string& key) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<jstring(std::string)>(
      "getDisk", "(Ljava/lang/String;)Ljava/lang/String;");
  auto result = method(AndroidAmplitudeAdapterJava::javaClassStatic(), key);
  if (!result) {
    return std::nullopt;
  }
  return result->toStdString();
}

void AndroidAmplitudeAdapterCpp::deleteDisk(const std::string& key) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<void(std::string)>(
      "deleteDisk", "(Ljava/lang/String;)V");
  method(AndroidAmplitudeAdapterJava::javaClassStatic(), key);
}

bool AndroidAmplitudeAdapterCpp::hasDisk(const std::string& key) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<jboolean(std::string)>(
      "hasDisk", "(Ljava/lang/String;)Z");
  return method(AndroidAmplitudeAdapterJava::javaClassStatic(), key);
}

std::vector<std::string> AndroidAmplitudeAdapterCpp::getAllDiskKeys() {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<JavaStringArray()>(
      "getAllDiskKeys", "()[Ljava/lang/String;");
  return fromJavaStringArray(method(AndroidAmplitudeAdapterJava::javaClassStatic()));
}

HttpResult AndroidAmplitudeAdapterCpp::performHttpRequest(
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    const std::string& body,
    int timeoutMillis) {
  static auto requestMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<JavaStringArray(
      std::string, std::string, std::string, std::string, jint)>(
      "performHttpRequest",
      "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;I)[Ljava/lang/String;");
  const auto result = fromJavaStringArray(requestMethod(
      AndroidAmplitudeAdapterJava::javaClassStatic(),
      url,
      method,
      toJsonObject(headers),
      body,
      timeoutMillis));
  HttpResult httpResult;
  if (result.size() >= 3) {
    const std::string& status = result[0];
    const bool numeric = !status.empty() &&
        status.find_first_not_of("0123456789") == std::string::npos &&
        status.size() <= 9;
    httpResult.statusCode = numeric ? std::stoi(status) : 0;
    httpResult.body = result[1];
    httpResult.error = result[2];
    if (!numeric && httpResult.error.empty()) {
      httpResult.error = "invalid_http_response";
    }
  } else {
    httpResult.error = "invalid_http_response";
  }
  return httpResult;
}

} // namespace NitroAmplitude
