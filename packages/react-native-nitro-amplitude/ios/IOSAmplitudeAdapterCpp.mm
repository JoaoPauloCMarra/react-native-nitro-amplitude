#import "IOSAmplitudeAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

namespace NitroAmplitude {

static NSString* const kDiskSuiteName = @"com.nitroamplitude.disk";

static NSUserDefaults* NitroDiskDefaults() {
  static NSUserDefaults* defaults = [[NSUserDefaults alloc] initWithSuiteName:kDiskSuiteName];
  return defaults ?: [NSUserDefaults standardUserDefaults];
}

IOSAmplitudeAdapterCpp::IOSAmplitudeAdapterCpp() {}

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
  return std::string(static_cast<const char*>(encoded.bytes), encoded.length);
}

std::string IOSAmplitudeAdapterCpp::getLegacySessionDataJson(const std::string& /*instanceName*/) {
  return "{}";
}

std::vector<std::string> IOSAmplitudeAdapterCpp::getLegacyEventsJson(
    const std::string& /*instanceName*/,
    const std::string& /*eventKind*/) {
  return {};
}

void IOSAmplitudeAdapterCpp::removeLegacyEvent(
    const std::string& /*instanceName*/,
    const std::string& /*eventKind*/,
    int64_t /*eventId*/) {}

void IOSAmplitudeAdapterCpp::setDisk(const std::string& key, const std::string& value) {
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  NSString* nsValue = [NSString stringWithUTF8String:value.c_str()];
  [NitroDiskDefaults() setObject:nsValue forKey:nsKey];
}

std::optional<std::string> IOSAmplitudeAdapterCpp::getDisk(const std::string& key) {
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  NSString* result = [NitroDiskDefaults() stringForKey:nsKey];
  if (!result) {
    return std::nullopt;
  }
  return std::string([result UTF8String]);
}

void IOSAmplitudeAdapterCpp::deleteDisk(const std::string& key) {
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  [NitroDiskDefaults() removeObjectForKey:nsKey];
}

bool IOSAmplitudeAdapterCpp::hasDisk(const std::string& key) {
  NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
  return [NitroDiskDefaults() objectForKey:nsKey] != nil;
}

std::vector<std::string> IOSAmplitudeAdapterCpp::getAllDiskKeys() {
  NSDictionary<NSString*, id>* entries = [NitroDiskDefaults() persistentDomainForName:kDiskSuiteName] ?: @{};
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
    return HttpResult{.error = "Invalid URL"};
  }

  NSTimeInterval timeoutSeconds = timeoutMillis / 1000.0;
  NSURLSessionConfiguration* configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  configuration.timeoutIntervalForRequest = timeoutSeconds;
  configuration.timeoutIntervalForResource = timeoutSeconds;
  NSURLSession* session = [NSURLSession sessionWithConfiguration:configuration];

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
  __block HttpResult completedResult;
  NSURLSessionDataTask* task = [session
      dataTaskWithRequest:request
        completionHandler:^(NSData* data, NSURLResponse* response, NSError* error) {
          if (error) {
            completedResult.error = std::string([[error localizedDescription] UTF8String]);
          } else if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
            completedResult.statusCode = static_cast<int>(((NSHTTPURLResponse*)response).statusCode);
            if (data) {
              completedResult.body = std::string(static_cast<const char*>(data.bytes), data.length);
            }
          } else {
            completedResult.error = "Invalid HTTP response";
          }
          dispatch_semaphore_signal(semaphore);
        }];
  [task resume];

  const int64_t waitMarginMillis = 5000;
  dispatch_time_t deadline =
      dispatch_time(DISPATCH_TIME_NOW, (static_cast<int64_t>(timeoutMillis) + waitMarginMillis) * NSEC_PER_MSEC);
  if (dispatch_semaphore_wait(semaphore, deadline) != 0) {
    [task cancel];
    [session invalidateAndCancel];
    return HttpResult{.error = "Request timed out"};
  }
  [session finishTasksAndInvalidate];
  return completedResult;
}

} // namespace NitroAmplitude
