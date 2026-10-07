#import "IOSAmplitudeAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#define NITRO_AMPLITUDE_HAS_UIKIT 1
#else
#define NITRO_AMPLITUDE_HAS_UIKIT 0
#endif

#include "../cpp/core/LegacyDiskMigration.hpp"
#include "../cpp/core/PosixFileAdapter.hpp"

#include <algorithm>
#include <memory>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

@interface NitroAmplitudeResponseCollector : NSObject <NSURLSessionDataDelegate>
@property(nonatomic, readonly) dispatch_semaphore_t finished;
@property(atomic, readonly) NSURLResponse* response;
@property(atomic, readonly) NSData* body;
@property(atomic, readonly) NSError* error;
@property(atomic, readonly) BOOL truncated;
- (instancetype)initWithMaxBodyBytes:(NSUInteger)maxBodyBytes;
@end

@implementation NitroAmplitudeResponseCollector {
  NSUInteger _maxBodyBytes;
  NSMutableData* _buffer;
}

- (instancetype)initWithMaxBodyBytes:(NSUInteger)maxBodyBytes {
  self = [super init];
  if (self) {
    _maxBodyBytes = maxBodyBytes;
    _buffer = [NSMutableData data];
    _finished = dispatch_semaphore_create(0);
  }
  return self;
}

- (void)URLSession:(NSURLSession*)session
          dataTask:(NSURLSessionDataTask*)dataTask
didReceiveResponse:(NSURLResponse*)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
  _response = response;
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)dataTask didReceiveData:(NSData*)data {
  if (_truncated) {
    return;
  }
  const NSUInteger remaining = _maxBodyBytes - _buffer.length;
  if (data.length > remaining) {
    [_buffer appendData:[data subdataWithRange:NSMakeRange(0, remaining)]];
    _truncated = YES;
    [dataTask cancel];
    return;
  }
  [_buffer appendData:data];
}

- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task didCompleteWithError:(NSError*)error {
  if (_response == nil) {
    _response = task.response;
  }
  _error = error;
  _body = [_buffer copy];
  dispatch_semaphore_signal(_finished);
}

@end

namespace NitroAmplitude {

static NSString* const kDiskSuiteName = @"com.nitroamplitude.disk";
static constexpr size_t kMaxCachedContexts = 8;
static constexpr NSUInteger kMaxResponseBodyBytes = 4 * 1024 * 1024;
static constexpr NSUInteger kMaxTransportDetailLength = 200;

#ifdef NITRO_AMPLITUDE_TESTING
static NSString* (^gIdentifierForVendorOverride)(void) = nil;
static NSArray<Class>* gUrlProtocolClassesOverride = nil;
static bool gDiskStoreDisabled = false;

void setIdentifierForVendorProviderForTesting(NSString* (^provider)(void)) {
  gIdentifierForVendorOverride = [provider copy];
}

void setUrlProtocolClassesForTesting(NSArray<Class>* classes) {
  gUrlProtocolClassesOverride = [classes copy];
}

void setDiskStoreDisabledForTesting(bool disabled) {
  gDiskStoreDisabled = disabled;
}
#endif

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

static std::optional<std::string> ToStdString(id value) {
  if (![value isKindOfClass:[NSString class]]) {
    return std::nullopt;
  }
  NSData* data = [(NSString*)value dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO];
  if (data == nil) {
    return std::nullopt;
  }
  if (data.length == 0) {
    return std::string();
  }
  return std::string(static_cast<const char*>(data.bytes), data.length);
}

static NSString* ToNSString(const std::string& value) {
  return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding];
}

static NSRegularExpression* DetailRegex(NSString* pattern, NSRegularExpressionOptions options = 0) {
  return [NSRegularExpression regularExpressionWithPattern:pattern options:options error:nil];
}

static NSString* SanitizeTransportDetail(NSString* value) {
  static NSString* const group = @"[0-9A-Fa-f]{1,4}";
  static NSArray<NSArray*>* rules = ^{
    const NSRegularExpressionOptions secretOptions =
        NSRegularExpressionCaseInsensitive | NSRegularExpressionDotMatchesLineSeparators;
    NSString* ipv6 = [NSString
        stringWithFormat:@"(?<![\\w:])(?:(?:%1$@:){7}%1$@|%1$@(?::%1$@){0,6}::(?:%1$@(?::%1$@){0,6})?|::%1$@(?::%1$@){0,6})(?![\\w:])(?:%%\\w+)?",
                         group];
    return @[
      @[ DetailRegex(@"[|\\r\\n]+"), @" " ],
      @[ DetailRegex(@"\\?\\S*"), @"" ],
      @[ DetailRegex(@"//[^/\\s@]+@"), @"//" ],
      @[ DetailRegex(@"\\bvalue:\\s.*", secretOptions), @"value: [redacted]" ],
      @[
        DetailRegex(@"(authorization|api[-_ ]?keys?|deployment[-_ ]?key|bearer|basic|tokens?|password|passwd|secret|cookie|(?<!url)session)\\b.*",
                    secretOptions),
        @"[redacted]"
      ],
      @[ DetailRegex(@"[A-Za-z0-9+/=_-]{32,}"), @"[redacted]" ],
      @[ DetailRegex(@" from /\\S+ \\(port \\d+\\)"), @"" ],
      @[ DetailRegex(@"\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b"), @"[ip]" ],
      @[ DetailRegex(ipv6), @"[ip]" ],
    ];
  }();
  NSMutableString* text = [(value ?: @"") mutableCopy];
  for (NSArray* rule in rules) {
    [(NSRegularExpression*)rule[0] replaceMatchesInString:text
                                                  options:0
                                                    range:NSMakeRange(0, text.length)
                                             withTemplate:rule[1]];
  }
  NSString* trimmed = [text stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length <= kMaxTransportDetailLength) {
    return trimmed;
  }
  const NSRange lastKept = [trimmed rangeOfComposedCharacterSequenceAtIndex:kMaxTransportDetailLength - 1];
  return [trimmed substringToIndex:NSMaxRange(lastKept)];
}

static std::string FormatNetworkError(NSError* error) {
  NSString* detail = [NSString stringWithFormat:@"network_error|nsurl:%ld|%@|%@",
                                                (long)error.code,
                                                SanitizeTransportDetail(error.domain),
                                                SanitizeTransportDetail(error.localizedDescription)];
  return ToStdString(detail).value_or("network_error");
}

static NSString* IdentifierForVendor() {
#ifdef NITRO_AMPLITUDE_TESTING
  if (gIdentifierForVendorOverride != nil) {
    return gIdentifierForVendorOverride();
  }
#endif
#if NITRO_AMPLITUDE_HAS_UIKIT
  return [[[UIDevice currentDevice] identifierForVendor] UUIDString];
#else
  return nil;
#endif
}

static NSURLSession* SharedSession() {
  static NSURLSession* session = []() {
    NSURLSessionConfiguration* configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.timeoutIntervalForRequest = 300.0;
    configuration.timeoutIntervalForResource = 300.0;
#ifdef NITRO_AMPLITUDE_TESTING
    if (gUrlProtocolClassesOverride != nil) {
      configuration.protocolClasses = gUrlProtocolClassesOverride;
    }
#endif
    return [NSURLSession sessionWithConfiguration:configuration];
  }();
  return session;
}

static NSString* RequireNSString(const std::string& value) {
  NSString* converted = ToNSString(value);
  if (converted == nil) {
    throw std::runtime_error("NitroAmplitude: storage_error");
  }
  return converted;
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
#ifdef NITRO_AMPLITUDE_TESTING
  if (gDiskStoreDisabled) {
    applicationSupport = nil;
  }
#endif
  if (applicationSupport != nil) {
    NSString* directory = [applicationSupport stringByAppendingPathComponent:@"nitro-amplitude"];
    [[NSFileManager defaultManager] createDirectoryAtPath:directory
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];
    const auto directoryPath = ToStdString(directory);
    if (directoryPath.has_value()) {
      diskStore_ = std::make_shared<JsonlSegmentStore>(
          std::make_shared<PosixFileAdapter>(), directoryPath.value());
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
    const auto legacyKey = ToStdString(key);
    const auto legacyValue = ToStdString(entries[key]);
    if (legacyKey.has_value() && legacyValue.has_value()) {
      legacy.emplace_back(legacyKey.value(), legacyValue.value());
    }
  }
  if (diskStore_ != nullptr && !legacy.empty()) {
    const LegacyDiskMigrationResult result = migrateLegacyDiskEntries(*diskStore_, legacy);
    if (!result.complete) {
      for (const auto& handledKey : result.handledKeys) {
        NSString* nsKey = ToNSString(handledKey);
        if (nsKey != nil) {
          [NitroDiskDefaults() removeObjectForKey:nsKey];
        }
      }
      legacyDiskPending_ = true;
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
  const std::string canonical = ToStdString(CanonicalOptions(options)).value_or("");
  {
    std::lock_guard<std::mutex> lock(contextCacheMutex_);
    auto cached = contextCache_.find(canonical);
    if (cached != contextCache_.end()) {
      return cached->second;
    }
  }

  NSString* systemName = nil;
  NSString* systemVersion = nil;
  NSString* deviceModel = nil;
#if NITRO_AMPLITUDE_HAS_UIKIT
  UIDevice* device = [UIDevice currentDevice];
  systemName = device.systemName;
  systemVersion = device.systemVersion;
  deviceModel = device.model;
#endif
  NSLocale* locale = [NSLocale currentLocale];
  NSString* version = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
  NSMutableDictionary* json = [@{
    @"version": version ?: @"",
    @"platform": @"iOS",
    @"language": locale.languageCode ?: @"",
    @"country": locale.countryCode ?: @"",
    @"osName": systemName ?: @"iOS",
    @"osVersion": systemVersion ?: @"",
    @"deviceManufacturer": @"Apple",
    @"deviceModel": deviceModel ?: @"",
    @"deviceBrand": @"Apple",
  } mutableCopy];

  if ([options[@"carrier"] boolValue]) {
    json[@"carrier"] = @"";
  }
  bool cacheable = true;
  if ([options[@"idfv"] boolValue]) {
    NSString* idfv = IdentifierForVendor();
    cacheable = idfv.length > 0;
    json[@"idfv"] = idfv ?: @"";
  }

  NSData* encoded = [NSJSONSerialization dataWithJSONObject:json options:0 error:nil];
  if (!encoded) {
    return "{}";
  }
  std::string result(static_cast<const char*>(encoded.bytes), encoded.length);
  if (cacheable) {
    std::lock_guard<std::mutex> lock(contextCacheMutex_);
    contextCache_[canonical] = result;
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
  NSString* nsKey = RequireNSString(key);
  NSString* nsValue = RequireNSString(value);
  [NitroDiskDefaults() setObject:nsValue forKey:nsKey];
}

std::optional<std::string> IOSAmplitudeAdapterCpp::getDisk(const std::string& key) {
  if (diskStore_ != nullptr) {
    return diskStore_->getDisk(key);
  }
  NSString* nsKey = ToNSString(key);
  if (nsKey == nil) {
    return std::nullopt;
  }
  return ToStdString([NitroDiskDefaults() stringForKey:nsKey]);
}

void IOSAmplitudeAdapterCpp::deleteDisk(const std::string& key) {
  if (diskStore_ != nullptr) {
    diskStore_->deleteDisk(key);
    if (!legacyDiskPending_) {
      return;
    }
  }
  NSString* nsKey = ToNSString(key);
  if (nsKey != nil) {
    [NitroDiskDefaults() removeObjectForKey:nsKey];
  }
}

bool IOSAmplitudeAdapterCpp::hasDisk(const std::string& key) {
  if (diskStore_ != nullptr) {
    return diskStore_->hasDisk(key);
  }
  NSString* nsKey = ToNSString(key);
  return nsKey != nil && [NitroDiskDefaults() objectForKey:nsKey] != nil;
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
    const auto converted = ToStdString(key);
    if (converted.has_value()) {
      keys.push_back(converted.value());
    }
  }
  return keys;
}

HttpResult IOSAmplitudeAdapterCpp::performHttpRequest(
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    const std::string& body,
    int timeoutMillis) {
  NSString* urlString = ToNSString(url);
  NSURL* nsUrl = urlString.length > 0 ? [NSURL URLWithString:urlString] : nil;
  if (!nsUrl) {
    return HttpResult{.error = "invalid_url"};
  }
  NSString* httpMethod = ToNSString(method);
  if (httpMethod.length == 0) {
    return HttpResult{.error = "network_error"};
  }

  NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:nsUrl];
  request.HTTPMethod = httpMethod;
  request.timeoutInterval = timeoutMillis / 1000.0;
  request.HTTPBody = body.empty() ? nil : [NSData dataWithBytes:body.data() length:body.size()];

  for (const auto& header : headers) {
    NSString* headerName = ToNSString(header.first);
    NSString* headerValue = ToNSString(header.second);
    if (headerName && headerValue) {
      [request setValue:headerValue forHTTPHeaderField:headerName];
    }
  }

  NitroAmplitudeResponseCollector* collector =
      [[NitroAmplitudeResponseCollector alloc] initWithMaxBodyBytes:kMaxResponseBodyBytes];
  NSURLSessionDataTask* task = [SharedSession() dataTaskWithRequest:request];
  task.delegate = collector;
  [task resume];

  const int64_t waitMarginMillis = 5000;
  dispatch_time_t deadline = dispatch_time(
      DISPATCH_TIME_NOW,
      (static_cast<int64_t>(timeoutMillis) + waitMarginMillis) * static_cast<int64_t>(NSEC_PER_MSEC));
  const bool timedOut = dispatch_semaphore_wait(collector.finished, deadline) != 0;
  if (timedOut) {
    [task cancel];
    return HttpResult{.error = "timeout"};
  }

  HttpResult result;
  NSError* error = collector.error;
  if (error != nil && !collector.truncated) {
    if ([error.domain isEqualToString:NSURLErrorDomain] &&
        (error.code == NSURLErrorTimedOut || error.code == NSURLErrorCancelled)) {
      result.error = error.code == NSURLErrorTimedOut ? "timeout" : "cancelled";
    } else {
      result.error = FormatNetworkError(error);
    }
  } else if ([collector.response isKindOfClass:[NSHTTPURLResponse class]]) {
    result.statusCode = static_cast<int>(((NSHTTPURLResponse*)collector.response).statusCode);
    NSData* data = collector.body;
    if (data.length > 0) {
      result.body = std::string(static_cast<const char*>(data.bytes), data.length);
    }
  } else {
    result.error = "invalid_http_response";
  }
  return result;
}

} // namespace NitroAmplitude
