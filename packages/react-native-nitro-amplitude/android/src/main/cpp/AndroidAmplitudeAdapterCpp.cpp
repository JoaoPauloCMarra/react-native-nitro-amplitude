#include "AndroidAmplitudeAdapterCpp.hpp"

#include "../../../cpp/core/PosixFileAdapter.hpp"

#include <exception>
#include <utility>

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

local_ref<JavaStringArray> toJavaStringArray(const std::vector<std::string>& values) {
  auto array = JavaStringArray::newArray(static_cast<jsize>(values.size()));
  for (size_t i = 0; i < values.size(); ++i) {
    auto value = make_jstring(values[i]);
    array->setElement(i, value.get());
  }
  return array;
}

} // namespace

AndroidAmplitudeAdapterCpp::AndroidAmplitudeAdapterCpp(alias_ref<JObject> /*context*/) {
  static auto directoryMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<jstring()>(
      "getStorageDirectory", "()Ljava/lang/String;");
  auto directory = directoryMethod(AndroidAmplitudeAdapterJava::javaClassStatic());
  if (directory != nullptr) {
    diskStore_ = std::make_shared<JsonlSegmentStore>(
        std::make_shared<PosixFileAdapter>(), directory->toStdString());
  }
  MigrateLegacyDisk();
}

void AndroidAmplitudeAdapterCpp::MigrateLegacyDisk() {
  if (diskStore_ == nullptr) {
    return;
  }
  static auto entriesMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<JavaStringArray()>(
      "getLegacyDiskEntries", "()[Ljava/lang/String;");
  const std::vector<std::string> flattened =
      fromJavaStringArray(entriesMethod(AndroidAmplitudeAdapterJava::javaClassStatic()));
  if (flattened.empty() || flattened.size() % 2 != 0) {
    return;
  }
  std::vector<std::pair<std::string, std::string>> legacy;
  legacy.reserve(flattened.size() / 2);
  for (size_t i = 0; i + 1 < flattened.size(); i += 2) {
    legacy.emplace_back(flattened[i], flattened[i + 1]);
  }
  try {
    diskStore_->migrateLegacyEntries(legacy);
  } catch (const std::exception&) {
    return;
  }
  static auto clearMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<void()>(
      "clearLegacyDisk", "()V");
  clearMethod(AndroidAmplitudeAdapterJava::javaClassStatic());
}

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
  if (diskStore_ != nullptr) {
    diskStore_->setDisk(key, value);
  }
}

std::optional<std::string> AndroidAmplitudeAdapterCpp::getDisk(const std::string& key) {
  if (diskStore_ == nullptr) {
    return std::nullopt;
  }
  return diskStore_->getDisk(key);
}

void AndroidAmplitudeAdapterCpp::deleteDisk(const std::string& key) {
  if (diskStore_ != nullptr) {
    diskStore_->deleteDisk(key);
  }
}

bool AndroidAmplitudeAdapterCpp::hasDisk(const std::string& key) {
  return diskStore_ != nullptr && diskStore_->hasDisk(key);
}

std::vector<std::string> AndroidAmplitudeAdapterCpp::getAllDiskKeys() {
  if (diskStore_ == nullptr) {
    return {};
  }
  return diskStore_->getAllDiskKeys();
}

HttpResult AndroidAmplitudeAdapterCpp::performHttpRequest(
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    const std::string& body,
    int timeoutMillis) {
  static auto requestMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<JavaStringArray(
      std::string, std::string, alias_ref<JavaStringArray>, alias_ref<JavaStringArray>, std::string, jint)>(
      "performHttpRequest",
      "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;I)[Ljava/lang/String;");
  std::vector<std::string> headerNames;
  std::vector<std::string> headerValues;
  headerNames.reserve(headers.size());
  headerValues.reserve(headers.size());
  for (const auto& header : headers) {
    headerNames.push_back(header.first);
    headerValues.push_back(header.second);
  }
  const auto result = fromJavaStringArray(requestMethod(
      AndroidAmplitudeAdapterJava::javaClassStatic(),
      url,
      method,
      toJavaStringArray(headerNames),
      toJavaStringArray(headerValues),
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
