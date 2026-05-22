#include "AndroidAmplitudeAdapterCpp.hpp"

namespace NitroAmplitude {

using namespace facebook::jni;
using JavaStringArray = JArrayClass<jstring>;

namespace {

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

std::string AndroidAmplitudeAdapterCpp::getLegacySessionDataJson(const std::string& instanceName) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<jstring(std::string)>(
      "getLegacySessionDataJson", "(Ljava/lang/String;)Ljava/lang/String;");
  auto result = method(AndroidAmplitudeAdapterJava::javaClassStatic(), instanceName);
  return result ? result->toStdString() : std::string("{}");
}

std::vector<std::string> AndroidAmplitudeAdapterCpp::getLegacyEventsJson(
    const std::string& instanceName,
    const std::string& eventKind) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<JavaStringArray(std::string, std::string)>(
      "getLegacyEventsJson", "(Ljava/lang/String;Ljava/lang/String;)[Ljava/lang/String;");
  return fromJavaStringArray(method(AndroidAmplitudeAdapterJava::javaClassStatic(), instanceName, eventKind));
}

void AndroidAmplitudeAdapterCpp::removeLegacyEvent(
    const std::string& instanceName,
    const std::string& eventKind,
    int64_t eventId) {
  static auto method = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<void(std::string, std::string, jlong)>(
      "removeLegacyEvent", "(Ljava/lang/String;Ljava/lang/String;J)V");
  method(AndroidAmplitudeAdapterJava::javaClassStatic(), instanceName, eventKind, eventId);
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
    const std::string& headersJson,
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
      headersJson,
      body,
      timeoutMillis));
  HttpResult httpResult;
  if (result.size() >= 3) {
    httpResult.statusCode = std::stoi(result[0]);
    httpResult.body = result[1];
    httpResult.error = result[2];
  } else {
    httpResult.error = "Invalid HTTP response from Android adapter";
  }
  return httpResult;
}

} // namespace NitroAmplitude
