#include "AndroidAmplitudeAdapterCpp.hpp"

#include "../../../cpp/core/LegacyDiskMigration.hpp"
#include "../../../cpp/core/PosixFileAdapter.hpp"

#include <exception>
#include <limits>
#include <stdexcept>
#include <utility>

namespace NitroAmplitude {

using namespace facebook::jni;
using JavaStringArray = JArrayClass<jstring>;

namespace {

jsize toJavaSize(size_t size) {
  if (size > static_cast<size_t>(std::numeric_limits<jsize>::max())) {
    throw std::length_error("NitroAmplitude: value exceeds JNI array size");
  }
  return static_cast<jsize>(size);
}

std::vector<std::string> fromJavaStringArray(alias_ref<JavaStringArray> values) {
  if (!values) {
    return {};
  }
  std::vector<std::string> result;
  const size_t size = values->size();
  result.reserve(size);
  for (size_t i = 0; i < size; ++i) {
    auto current = values->getElement(i);
    result.push_back(current ? current->toStdString() : std::string());
  }
  return result;
}

local_ref<JavaStringArray> toJavaStringArray(const std::vector<std::string>& values) {
  auto array = JavaStringArray::newArray(static_cast<size_t>(toJavaSize(values.size())));
  for (size_t i = 0; i < values.size(); ++i) {
    auto value = make_jstring(values[i]);
    array->setElement(i, value.get());
  }
  return array;
}

} // namespace

std::shared_ptr<JsonlSegmentStore> AndroidAmplitudeAdapterCpp::EnsureDiskStore() {
  std::lock_guard<std::mutex> lock(diskStoreMutex_);
  try {
    if (diskStore_ == nullptr) {
      static auto directoryMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<jstring()>(
          "getStorageDirectory", "()Ljava/lang/String;");
      auto directory = directoryMethod(AndroidAmplitudeAdapterJava::javaClassStatic());
      if (directory == nullptr) {
        return nullptr;
      }
      diskStore_ = std::make_shared<JsonlSegmentStore>(
          std::make_shared<PosixFileAdapter>(), directory->toStdString());
    }
    if (!legacyDiskMigrated_ && legacyDiskRetryAllowed_) {
      legacyDiskRetryAllowed_ = false;
      legacyDiskMigrated_ = MigrateLegacyDisk(*diskStore_);
    }
  } catch (const std::exception&) {
    return diskStore_;
  }
  return diskStore_;
}

void AndroidAmplitudeAdapterCpp::ForgetLegacyDiskEntry(const std::string& key) {
  std::lock_guard<std::mutex> lock(diskStoreMutex_);
  if (legacyDiskMigrated_) {
    return;
  }
  try {
    static auto removeMethod = AndroidAmplitudeAdapterJava::javaClassStatic()
        ->getStaticMethod<void(alias_ref<JavaStringArray>)>(
            "removeLegacyDiskEntries", "([Ljava/lang/String;)V");
    removeMethod(AndroidAmplitudeAdapterJava::javaClassStatic(), toJavaStringArray({key}));
  } catch (const std::exception&) {
  }
}

bool AndroidAmplitudeAdapterCpp::MigrateLegacyDisk(JsonlSegmentStore& store) {
  static auto entriesMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<JavaStringArray()>(
      "getLegacyDiskEntries", "()[Ljava/lang/String;");
  const std::vector<std::string> flattened =
      fromJavaStringArray(entriesMethod(AndroidAmplitudeAdapterJava::javaClassStatic()));
  if (flattened.empty() || flattened.size() % 2 != 0) {
    return true;
  }
  std::vector<std::pair<std::string, std::string>> legacy;
  legacy.reserve(flattened.size() / 2);
  for (size_t i = 0; i + 1 < flattened.size(); i += 2) {
    legacy.emplace_back(flattened[i], flattened[i + 1]);
  }
  const LegacyDiskMigrationResult result = migrateLegacyDiskEntries(store, legacy);
  if (!result.complete) {
    if (!result.handledKeys.empty()) {
      static auto removeMethod = AndroidAmplitudeAdapterJava::javaClassStatic()
          ->getStaticMethod<void(alias_ref<JavaStringArray>)>(
              "removeLegacyDiskEntries", "([Ljava/lang/String;)V");
      removeMethod(AndroidAmplitudeAdapterJava::javaClassStatic(), toJavaStringArray(result.handledKeys));
    }
    return false;
  }
  static auto clearMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<void()>(
      "clearLegacyDisk", "()V");
  clearMethod(AndroidAmplitudeAdapterJava::javaClassStatic());
  return true;
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
  const auto store = EnsureDiskStore();
  if (store == nullptr) {
    throw std::runtime_error("NitroAmplitude: disk_adapter_unavailable");
  }
  store->setDisk(key, value);
  std::lock_guard<std::mutex> lock(diskStoreMutex_);
  legacyDiskRetryAllowed_ = true;
}

std::optional<std::string> AndroidAmplitudeAdapterCpp::getDisk(const std::string& key) {
  const auto store = EnsureDiskStore();
  if (store == nullptr) {
    return std::nullopt;
  }
  return store->getDisk(key);
}

void AndroidAmplitudeAdapterCpp::deleteDisk(const std::string& key) {
  const auto store = EnsureDiskStore();
  if (store != nullptr) {
    store->deleteDisk(key);
    ForgetLegacyDiskEntry(key);
  }
}

bool AndroidAmplitudeAdapterCpp::hasDisk(const std::string& key) {
  const auto store = EnsureDiskStore();
  return store != nullptr && store->hasDisk(key);
}

std::vector<std::string> AndroidAmplitudeAdapterCpp::getAllDiskKeys() {
  const auto store = EnsureDiskStore();
  if (store == nullptr) {
    return {};
  }
  return store->getAllDiskKeys();
}

HttpResult AndroidAmplitudeAdapterCpp::performHttpRequest(
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    const std::string& body,
    int timeoutMillis) {
  static auto requestMethod = AndroidAmplitudeAdapterJava::javaClassStatic()->getStaticMethod<JavaStringArray(
      std::string, std::string, alias_ref<JavaStringArray>, alias_ref<JavaStringArray>, alias_ref<JArrayByte>, jint)>(
      "performHttpRequest",
      "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;[Ljava/lang/String;[BI)[Ljava/lang/String;");
  std::vector<std::string> headerNames;
  std::vector<std::string> headerValues;
  headerNames.reserve(headers.size());
  headerValues.reserve(headers.size());
  for (const auto& header : headers) {
    headerNames.push_back(header.first);
    headerValues.push_back(header.second);
  }
  const jsize bodySize = toJavaSize(body.size());
  auto bodyBytes = JArrayByte::newArray(static_cast<size_t>(bodySize));
  if (bodySize > 0) {
    bodyBytes->setRegion(0, bodySize, reinterpret_cast<const jbyte*>(body.data()));
  }
  const auto result = fromJavaStringArray(requestMethod(
      AndroidAmplitudeAdapterJava::javaClassStatic(),
      url,
      method,
      toJavaStringArray(headerNames),
      toJavaStringArray(headerValues),
      bodyBytes,
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
