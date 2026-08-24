#import "IOSAmplitudeAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#include "../cpp/core/PosixFileAdapter.hpp"

#include <memory>
#include <utility>
#include <vector>

namespace NitroAmplitude {

static NSString* const kDiskSuiteName = @"com.nitroamplitude.disk";
static constexpr size_t kMaxCachedContexts = 8;

static NSUserDefaults* NitroDiskDefaults() {
  static NSUserDefaults* defaults = [[NSUserDefaults alloc] initWithSuiteName:kDiskSuiteName];
  if (defaults) {
    return defaults;
  }
  return [NSUserDefaults standardUserDefaults];
}

static bool NitroDiskDefaultsAreSuite() {
  return NitroDiskDefaults() != [NSUserDefaults standardUserDefaults];
}

static NSString* CanonicalOptions(NSDictionary* options) {
  NSArray* sortedKeys = [options.allKeys sortedArrayUsingSelector:@selector(compare:)];
  NSMutableArray* parts = [NSMutableArray arrayWithCapacity:sortedKeys.count];
  for (NSString* key in sortedKeys) {
    id value = options[key];
    if (value == nil) {
      value = @"";
    }
    [parts addObject:[NSString stringWithFormat:@"%@=%@", key, value]];
  }
  return [parts componentsJoinedByString:@"&"];
}

IOSAmplitudeAdapterCpp::IOSAmplitudeAdapterCpp() {
  NSString* applicationSupport =
      [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
  if (applicationSupport != nil) {
    NSString* directory = [applicationSupport stringByAppendingPathComponent:@"nitro-amplitude"];
    [[NSFileManager defaultManager] createDirectoryAtPath:directory
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];
    if (directory.UTF8String != nil) {
      diskStore_ = std::make_shared<JsonlSegmentStore>(
          std::make_shared<PosixFileAdapter>(), std::string(directory.UTF8String));
    }
  }
  MigrateLegacyDisk();
}

void IOSAmplitudeAdapterCpp::MigrateLegacyDisk() {
  if (!NitroDiskDefaultsAreSuite()) {
    return;
  }
  NSDictionary<NSString*, id>* entries = [NitroDiskDefaults() persistentDomainForName:kDiskSuiteName];
  if (entries.count == 0) {
    return;
  }
  std::vector<std::pair<std::string, std::string>> legacy;
  legacy.reserve(entries.count);
  for (NSString* key in entries) {
    id value = entries[key];
    if (key.UTF8String != nil && [value isKindOfClass:[NSString class]]) {
      legacy.emplace_back(std::string(key.UTF8String), std::string([value UTF8String]));
    }
  }
  if (diskStore_ != nullptr && !legacy.empty()) {
    try {
      diskStore_->migrateLegacyEntries(legacy);
    } catch (const std::exception&) {
      return;
    }
  }
  [NitroDiskDefaults() removePersistentDomainForName:kDiskSuiteName];
}

void IOSAmplitudeAdapterCpp::prefetchContext() {
  getApplicationContextJson("{}");
}

std::string IOSAmplitudeAdapterCpp::getApplicationContextJson(const std::string& optionsJson) {
  NSData* data = [NSData dataWithBytes:optionsJson.data() length:optionsJson.size()];
  NSError* optionsError = nil;
  NSDictionary* options = [NSJSONSerialization JSONObjectWithData:data options:0 error:&optionsError];
  if (optionsError != nil || ![options isKindOfClass:[NSDictionary class]]) {
    options = @{};
  }
  NSString* canonical = CanonicalOptions(options);
  {
    std::lock_guard<std::mutex> lock(contextCacheMutex_);
    auto cached = contextCache_.find(canonical.UTF8String ? std::string(canonical.UTF8String) : "");
    if (cached != contextCache_.end()) {
      return cached->second;
    }
  }

  UIDevice* device = [UIDevice currentDevice];
  NSLocale* locale = [NSLocale currentLocale];
  NSString* version = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
  NSMutableDictionary* json = [@{
    @"version": version ?: @"",
    @"platform": @"iOS",
    @"language": locale.languageCode ?: @"",
    @"country": locale.countryCode ?: @"",
    @"osName": device.systemName ?: @"iOS",
    @"osVersion": device.systemVersion ?: @"",
    @"deviceManufacturer": @"Apple",
    @"deviceModel": device.model ?: @"",
    @"deviceBrand": @"Apple",
  } mutableCopy];

  if ([options[@"carrier"] boolValue]) {
    json[@"carrier"] = @"";
  }
  if ([options[@"idfv"] boolValue]) {
    json[@"idfv"] = [[[UIDevice currentDevice] identifierForVendor] UUIDString] ?: @"";
  }

  NSData* encoded = [NSJSONSerialization dataWithJSONObject:json options:0 error:nil];
  if (!encoded) {
    return "{}";
  }
  std::string result(static_cast<const char*>(encoded.bytes), encoded.length);
  {
    std::lock_guard<std::mutex> lock(contextCacheMutex_);
    contextCache_[canonical.UTF8String ? std::string(canonical.UTF8String) : ""] = result;
    while (contextCache_.size() > kMaxCachedContexts) {
      contextCache_.erase(contextCache_.begin());
    }
  }
  return result;
}

void IOSAmplitudeAdapterCpp::setDisk(const std::string& key, const std::string& value) {
  if (diskStore_ != nullptr) {
    diskStore_->setDisk(key, value);
    return;
  }
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  NSString* nsValue = [NSString stringWithUTF8String:value.c_str()];
  [NitroDiskDefaults() setObject:nsValue forKey:nsKey];
}

std::optional<std::string> IOSAmplitudeAdapterCpp::getDisk(const std::string& key) {
  if (diskStore_ != nullptr) {
    return diskStore_->getDisk(key);
  }
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  NSString* result = [NitroDiskDefaults() stringForKey:nsKey];
  if (!result) {
    return std::nullopt;
  }
  return std::string([result UTF8String]);
}

void IOSAmplitudeAdapterCpp::deleteDisk(const std::string& key) {
  if (diskStore_ != nullptr) {
    diskStore_->deleteDisk(key);
    return;
  }
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  [NitroDiskDefaults() removeObjectForKey:nsKey];
}

bool IOSAmplitudeAdapterCpp::hasDisk(const std::string& key) {
  if (diskStore_ != nullptr) {
    return diskStore_->hasDisk(key);
  }
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  return [NitroDiskDefaults() objectForKey:nsKey] != nil;
}

std::vector<std::string> IOSAmplitudeAdapterCpp::getAllDiskKeys() {
  if (diskStore_ != nullptr) {
    return diskStore_->getAllDiskKeys();
  }
  NSUserDefaults* defaults = NitroDiskDefaults();
  NSDictionary<NSString*, id>* entries;
  if (NitroDiskDefaultsAreSuite()) {
    entries = [defaults persistentDomainForName:kDiskSuiteName] ?: @{};
  } else {
    entries = [defaults dictionaryRepresentation];
  }
  std::vector<std::string> keys;
  keys.reserve(entries.count);
  for (NSString* key in entries) {
    keys.push_back(std::string([key UTF8String]));
  }
  return keys;
}

HttpResult IOSAmplitudeAdapterCpp::performHttpRequest(
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    const std::string& body,
    int timeoutMillis) {
  NSURL* nsUrl = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
  if (!nsUrl) {
    return HttpResult{.error = "invalid_url"};
  }

  NSTimeInterval timeoutSeconds = timeoutMillis / 1000.0;
  static NSURLSession* session = []() {
    NSURLSessionConfiguration* configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.timeoutIntervalForRequest = 300.0;
    configuration.timeoutIntervalForResource = 300.0;
    return [NSURLSession sessionWithConfiguration:configuration];
  }();

  NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:nsUrl];
  request.HTTPMethod = [NSString stringWithUTF8String:method.c_str()];
  request.timeoutInterval = timeoutSeconds;
  request.HTTPBody = body.empty() ? nil : [NSData dataWithBytes:body.data() length:body.size()];

  for (const auto& header : headers) {
    NSString* headerName = [NSString stringWithUTF8String:header.first.c_str()];
    NSString* headerValue = [NSString stringWithUTF8String:header.second.c_str()];
    if (headerName && headerValue) {
      [request setValue:headerValue forHTTPHeaderField:headerName];
    }
  }

  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  struct SharedResult {
    std::mutex mutex;
    HttpResult result;
  };
  auto sharedResult = std::make_shared<SharedResult>();
  NSURLSessionDataTask* task = [session
      dataTaskWithRequest:request
        completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
          HttpResult result;
          if (error) {
            if ([error.domain isEqualToString:NSURLErrorDomain] &&
                (error.code == NSURLErrorTimedOut || error.code == NSURLErrorCancelled)) {
              result.error = error.code == NSURLErrorTimedOut ? "timeout" : "cancelled";
            } else {
              result.error = "network_error";
            }
          } else if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
            result.statusCode = static_cast<int>(((NSHTTPURLResponse*)response).statusCode);
            if (data) {
              result.body = std::string(static_cast<const char*>(data.bytes), data.length);
            }
          } else {
            result.error = "invalid_http_response";
          }
          {
            std::lock_guard<std::mutex> lock(sharedResult->mutex);
            sharedResult->result = std::move(result);
          }
          dispatch_semaphore_signal(semaphore);
        }];
  [task resume];

  const int64_t waitMarginMillis = 5000;
  dispatch_time_t deadline =
      dispatch_time(DISPATCH_TIME_NOW, (static_cast<int64_t>(timeoutMillis) + waitMarginMillis) * NSEC_PER_MSEC);
  const bool timedOut = dispatch_semaphore_wait(semaphore, deadline) != 0;
  if (timedOut) {
    [task cancel];
    return HttpResult{.error = "timeout"};
  }
  std::lock_guard<std::mutex> lock(sharedResult->mutex);
  return sharedResult->result;
}

} // namespace NitroAmplitude
