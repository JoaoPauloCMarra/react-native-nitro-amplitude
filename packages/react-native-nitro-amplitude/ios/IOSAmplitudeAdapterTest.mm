#import "IOSAmplitudeAdapterCpp.hpp"
#import <Foundation/Foundation.h>

#include <algorithm>
#include <atomic>
#include <cassert>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using NitroAmplitude::HttpResult;
using NitroAmplitude::IOSAmplitudeAdapterCpp;

namespace NitroAmplitude {
void setIdentifierForVendorProviderForTesting(NSString* (^provider)(void));
void setUrlProtocolClassesForTesting(NSArray<Class>* classes);
void setDiskStoreDisabledForTesting(bool disabled);
}

static NSString* const kSuiteName = @"com.nitroamplitude.disk";
static const NSUInteger kResponseCap = 4 * 1024 * 1024;

@interface NitroAmplitudeStubProtocol : NSURLProtocol
@end

@implementation NitroAmplitudeStubProtocol

+ (BOOL)canInitWithRequest:(NSURLRequest*)request {
  return [request.URL.host isEqualToString:@"amplitude.test"];
}

+ (NSURLRequest*)canonicalRequestForRequest:(NSURLRequest*)request {
  return request;
}

- (void)failWithCode:(NSInteger)code {
  [self failWithCode:code userInfo:nil];
}

- (void)failWithCode:(NSInteger)code userInfo:(NSDictionary*)userInfo {
  [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:code userInfo:userInfo]];
}

- (void)respondWithStatus:(NSInteger)status body:(NSData*)body {
  NSHTTPURLResponse* response = [[NSHTTPURLResponse alloc] initWithURL:self.request.URL
                                                            statusCode:status
                                                           HTTPVersion:@"HTTP/1.1"
                                                          headerFields:@{@"Content-Type": @"application/json"}];
  [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
  const NSUInteger chunk = 256 * 1024;
  for (NSUInteger offset = 0; offset < body.length; offset += chunk) {
    const NSUInteger length = MIN(chunk, body.length - offset);
    [self.client URLProtocol:self didLoadData:[body subdataWithRange:NSMakeRange(offset, length)]];
  }
  [self.client URLProtocolDidFinishLoading:self];
}

- (void)startLoading {
  NSString* path = self.request.URL.path;
  if ([path isEqualToString:@"/timeout"]) {
    [self failWithCode:NSURLErrorTimedOut];
  } else if ([path isEqualToString:@"/cancelled"]) {
    [self failWithCode:NSURLErrorCancelled];
  } else if ([path isEqualToString:@"/offline"]) {
    [self failWithCode:NSURLErrorNotConnectedToInternet];
  } else if ([path isEqualToString:@"/dns"]) {
    [self failWithCode:NSURLErrorCannotFindHost
              userInfo:@{
                NSLocalizedDescriptionKey : @"A server with the specified hostname could not be found.",
                NSURLErrorFailingURLErrorKey : [NSURL URLWithString:@"https://amplitude.test/dns?secret=abc"],
              }];
  } else if ([path isEqualToString:@"/inject"]) {
    [self failWithCode:NSURLErrorCannotConnectToHost
              userInfo:@{
                NSLocalizedDescriptionKey :
                    @"bad|inject\r\nline https://amplitude.test/p?user=u1 Authorization: Api-Key client-xyz",
              }];
  } else if ([path isEqualToString:@"/sanitize"]) {
    NSString* description = [self.request.URL.query stringByRemovingPercentEncoding] ?: @"";
    [self failWithCode:NSURLErrorCannotConnectToHost userInfo:@{NSLocalizedDescriptionKey : description}];
  } else if ([path isEqualToString:@"/long"]) {
    [self failWithCode:NSURLErrorNetworkConnectionLost
              userInfo:@{NSLocalizedDescriptionKey : [@"" stringByPaddingToLength:400 withString:@"ab " startingAtIndex:0]}];
  } else if ([path isEqualToString:@"/longrun"]) {
    [self failWithCode:NSURLErrorNetworkConnectionLost
              userInfo:@{NSLocalizedDescriptionKey : [@"" stringByPaddingToLength:400 withString:@"x" startingAtIndex:0]}];
  } else if ([path isEqualToString:@"/tls"]) {
    [self failWithCode:NSURLErrorSecureConnectionFailed];
  } else if ([path isEqualToString:@"/non-http"]) {
    NSURLResponse* response = [[NSURLResponse alloc] initWithURL:self.request.URL
                                                        MIMEType:@"text/plain"
                                           expectedContentLength:0
                                                textEncodingName:nil];
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    [self.client URLProtocolDidFinishLoading:self];
  } else if ([path hasPrefix:@"/status/"]) {
    const NSInteger status = [[path lastPathComponent] integerValue];
    NSString* body = [NSString stringWithFormat:@"{\"code\":%ld}", (long)status];
    [self respondWithStatus:status body:[body dataUsingEncoding:NSUTF8StringEncoding]];
  } else if ([path hasPrefix:@"/bytes/"]) {
    const NSUInteger length = (NSUInteger)[[path lastPathComponent] integerValue];
    NSMutableData* body = [NSMutableData dataWithLength:length];
    memset(body.mutableBytes, 'x', length);
    [self respondWithStatus:200 body:body];
  } else if ([path isEqualToString:@"/echo"]) {
    NSString* body = [NSString stringWithFormat:@"%@|%@|%@",
                                                self.request.HTTPMethod,
                                                [self.request valueForHTTPHeaderField:@"X-Test"] ?: @"",
                                                [self.request valueForHTTPHeaderField:@"X-Bad"] ?: @"none"];
    [self respondWithStatus:200 body:[body dataUsingEncoding:NSUTF8StringEncoding]];
  } else {
    [self respondWithStatus:200 body:[NSData data]];
  }
}

- (void)stopLoading {
}

@end

namespace {

bool throwsStorageError(const std::function<void()>& action) {
  try {
    action();
  } catch (const std::runtime_error& error) {
    return std::string(error.what()) == "NitroAmplitude: storage_error";
  }
  return false;
}

bool contains(const std::vector<std::string>& values, const std::string& needle) {
  return std::find(values.begin(), values.end(), needle) != values.end();
}

NSUserDefaults* suiteDefaults() {
  return [[NSUserDefaults alloc] initWithSuiteName:kSuiteName];
}

NSDictionary* suiteDomain() {
  return [suiteDefaults() persistentDomainForName:kSuiteName] ?: @{};
}

NSString* storageDirectory() {
  NSString* applicationSupport =
      [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
  return [applicationSupport stringByAppendingPathComponent:@"nitro-amplitude"];
}

NSDictionary* parseJson(const std::string& json) {
  NSData* data = [NSData dataWithBytes:json.data() length:json.size()];
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  assert([parsed isKindOfClass:[NSDictionary class]]);
  return parsed;
}

void testStorageDirectoryIsCreated() {
  NSString* directory = storageDirectory();
  assert(directory != nil);
  assert([directory hasPrefix:NSHomeDirectory()]);
  [[NSFileManager defaultManager] removeItemAtPath:directory error:nil];
  assert(![[NSFileManager defaultManager] fileExistsAtPath:directory]);

  {
    IOSAmplitudeAdapterCpp adapter;
    BOOL isDirectory = NO;
    assert([[NSFileManager defaultManager] fileExistsAtPath:directory isDirectory:&isDirectory]);
    assert(isDirectory);
    adapter.setDisk("alpha", "1");
    adapter.setDisk(std::string("nul\0key", 7), std::string("nul\0value\xff", 10));
    assert(adapter.getDisk("alpha").value_or("") == "1");
    assert(adapter.hasDisk("alpha"));
    assert(contains(adapter.getAllDiskKeys(), "alpha"));
  }
  NSArray* names = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:directory error:nil];
  assert([names containsObject:@"segment-00000000.jsonl"]);

  IOSAmplitudeAdapterCpp reopened;
  assert(reopened.getDisk("alpha").value_or("") == "1");
  assert(reopened.getDisk(std::string("nul\0key", 7)).value_or("") == std::string("nul\0value\xff", 10));
  reopened.deleteDisk("alpha");
  assert(!reopened.hasDisk("alpha"));

  [[NSFileManager defaultManager] removeItemAtPath:directory error:nil];
  reopened.setDisk("after-removal", "2");
  assert(reopened.getDisk("after-removal").value_or("") == "2");
  assert(!reopened.hasDisk(std::string("nul\0key", 7)));
}

void testLegacyMigration() {
  {
    IOSAmplitudeAdapterCpp seed;
    seed.setDisk("existing-key", "already-stored");
  }
  unichar loneSurrogate[] = {'b', 'a', 'd', 0xD800};
  NSString* unrepresentable = [NSString stringWithCharacters:loneSurrogate length:4];
  NSUserDefaults* defaults = suiteDefaults();
  [defaults setObject:@"legacy-value" forKey:@"legacy-key"];
  [defaults setObject:@"keep-new" forKey:@"existing-key"];
  [defaults setObject:unrepresentable forKey:@"legacy-bad-value"];
  [defaults setObject:@"value" forKey:unrepresentable];
  [defaults setObject:@42 forKey:@"legacy-number"];
  [defaults setObject:[NSString stringWithFormat:@"nul%Cvalue", (unichar)0] forKey:@"legacy-nul"];
  assert(suiteDomain().count == 6);

  {
    IOSAmplitudeAdapterCpp adapter;
    assert(adapter.getDisk("legacy-key").value_or("") == "legacy-value");
    assert(adapter.getDisk("existing-key").value_or("") == "already-stored");
    assert(adapter.getDisk("legacy-nul").value_or("") == std::string("nul\0value", 9));
    assert(!adapter.hasDisk("legacy-bad-value"));
    assert(!adapter.hasDisk("legacy-number"));
    assert(suiteDomain().count == 0);
    adapter.deleteDisk("legacy-key");
  }
  IOSAmplitudeAdapterCpp afterMigration;
  assert(!afterMigration.hasDisk("legacy-key"));
  assert(afterMigration.getDisk("existing-key").value_or("") == "already-stored");
}

void testUserDefaultsFallback() {
  NitroAmplitude::setDiskStoreDisabledForTesting(true);
  NSUserDefaults* defaults = suiteDefaults();
  [defaults removePersistentDomainForName:kSuiteName];
  {
    IOSAmplitudeAdapterCpp adapter;
    assert(adapter.getAllDiskKeys().empty());
    assert(!adapter.getDisk("missing").has_value());
    assert(!adapter.hasDisk("missing"));
    adapter.deleteDisk("missing");

    adapter.setDisk("fallback-key", "fallback-value");
    assert(adapter.getDisk("fallback-key").value_or("") == "fallback-value");
    assert(adapter.hasDisk("fallback-key"));

    const std::string nulKey("a\0b", 3);
    const std::string nulValue("x\0y", 3);
    adapter.setDisk(nulKey, nulValue);
    assert(adapter.getDisk(nulKey).value_or("") == nulValue);
    assert(adapter.hasDisk(nulKey));
    assert(!adapter.hasDisk("a"));
    adapter.setDisk("empty", "");
    assert(adapter.getDisk("empty").value_or("x").empty());

    const auto keys = adapter.getAllDiskKeys();
    assert(keys.size() == 3);
    assert(contains(keys, "fallback-key"));
    assert(contains(keys, nulKey));

    const std::string invalid = "\xff\xfe";
    assert(throwsStorageError([&]() { adapter.setDisk(invalid, "value"); }));
    assert(throwsStorageError([&]() { adapter.setDisk("valid", invalid); }));
    assert(!adapter.getDisk(invalid).has_value());
    assert(!adapter.hasDisk(invalid));
    adapter.deleteDisk(invalid);
    assert(!adapter.hasDisk("valid"));
    assert(adapter.getAllDiskKeys().size() == 3);

    unichar loneSurrogate[] = {'k', 0xDC00};
    NSString* unrepresentable = [NSString stringWithCharacters:loneSurrogate length:2];
    [defaults setObject:unrepresentable forKey:@"surrogate-value"];
    [defaults setObject:@"value" forKey:unrepresentable];
    [defaults setObject:@7 forKey:@"number-value"];
    assert(!adapter.getDisk("surrogate-value").has_value());
    assert(adapter.hasDisk("surrogate-value"));
    assert(adapter.getDisk("number-value").value_or("") == "7");
    const auto withUnrepresentable = adapter.getAllDiskKeys();
    assert(withUnrepresentable.size() == 5);
    assert(contains(withUnrepresentable, "surrogate-value"));

    adapter.deleteDisk("fallback-key");
    adapter.deleteDisk(nulKey);
    assert(!adapter.hasDisk("fallback-key"));
    assert(!adapter.hasDisk(nulKey));
  }
  [defaults removePersistentDomainForName:kSuiteName];
  NitroAmplitude::setDiskStoreDisabledForTesting(false);
}

void testContextAndIdentifierForVendor() {
  static std::atomic<int> lookups{0};
  static NSString* current = nil;
  NitroAmplitude::setIdentifierForVendorProviderForTesting(^NSString* {
    ++lookups;
    return current;
  });

  IOSAmplitudeAdapterCpp adapter;
  adapter.prefetchContext();
  NSDictionary* base = parseJson(adapter.getApplicationContextJson("{}"));
  assert([base[@"platform"] isEqualToString:@"iOS"]);
  assert([base[@"deviceManufacturer"] isEqualToString:@"Apple"]);
  assert([base[@"deviceBrand"] isEqualToString:@"Apple"]);
  assert([base[@"osName"] length] > 0);
  for (NSString* field in @[@"version", @"language", @"country", @"osVersion", @"deviceModel"]) {
    assert([base[field] isKindOfClass:[NSString class]]);
  }
  assert(base[@"idfv"] == nil);
  assert(base[@"carrier"] == nil);
  assert(lookups == 0);

  assert(adapter.getApplicationContextJson("not json") == adapter.getApplicationContextJson("{}"));
  assert(adapter.getApplicationContextJson("[1,2]") == adapter.getApplicationContextJson("{}"));
  assert(adapter.getApplicationContextJson(std::string("\xff\x00{", 3)) == adapter.getApplicationContextJson("{}"));
  assert([parseJson(adapter.getApplicationContextJson("{\"carrier\":true}"))[@"carrier"] isEqualToString:@""]);

  const std::string withIdfv = "{\"idfv\":true}";
  assert([parseJson(adapter.getApplicationContextJson(withIdfv))[@"idfv"] isEqualToString:@""]);
  assert(lookups == 1);
  assert([parseJson(adapter.getApplicationContextJson(withIdfv))[@"idfv"] isEqualToString:@""]);
  assert(lookups == 2);
  current = @"";
  assert([parseJson(adapter.getApplicationContextJson(withIdfv))[@"idfv"] isEqualToString:@""]);
  assert(lookups == 3);

  current = @"11111111-2222-3333-4444-555555555555";
  assert([parseJson(adapter.getApplicationContextJson(withIdfv))[@"idfv"] isEqualToString:current]);
  assert(lookups == 4);
  current = nil;
  assert([parseJson(adapter.getApplicationContextJson(withIdfv))[@"idfv"]
      isEqualToString:@"11111111-2222-3333-4444-555555555555"]);
  assert(lookups == 4);
  assert(parseJson(adapter.getApplicationContextJson("{\"idfv\":false}"))[@"idfv"] == nil);

  for (int i = 0; i < 40; ++i) {
    const std::string options = "{\"option" + std::to_string(i) + "\":true}";
    assert([parseJson(adapter.getApplicationContextJson(options))[@"platform"] isEqualToString:@"iOS"]);
  }
  NitroAmplitude::setIdentifierForVendorProviderForTesting(nil);
}

void testHttpRequests() {
  NitroAmplitude::setUrlProtocolClassesForTesting(@[[NitroAmplitudeStubProtocol class]]);
  IOSAmplitudeAdapterCpp adapter;
  const std::string base = "https://amplitude.test";

  const HttpResult ok = adapter.performHttpRequest(base + "/ok", "POST", {}, "{}", 2000);
  assert(ok.statusCode == 200 && ok.body.empty() && ok.error.empty());

  for (const int status : {204, 400, 401, 413, 429, 500, 503}) {
    const HttpResult result =
        adapter.performHttpRequest(base + "/status/" + std::to_string(status), "POST", {}, "{}", 2000);
    assert(result.statusCode == status);
    assert(result.body == "{\"code\":" + std::to_string(status) + "}");
    assert(result.error.empty());
  }

  const HttpResult timeout = adapter.performHttpRequest(base + "/timeout", "POST", {}, "{}", 2000);
  assert(timeout.statusCode == 0 && timeout.body.empty() && timeout.error == "timeout");
  assert(adapter.performHttpRequest(base + "/cancelled", "POST", {}, "{}", 2000).error == "cancelled");
  const std::string offline = adapter.performHttpRequest(base + "/offline", "POST", {}, "{}", 2000).error;
  assert(offline.rfind("network_error|nsurl:-1009|NSURLErrorDomain|", 0) == 0);
  const std::string tls = adapter.performHttpRequest(base + "/tls", "POST", {}, "{}", 2000).error;
  assert(tls.rfind("network_error|nsurl:-1200|NSURLErrorDomain|", 0) == 0);

  const std::string dns = adapter.performHttpRequest(base + "/dns", "POST", {}, "{}", 2000).error;
  assert(dns == "network_error|nsurl:-1003|NSURLErrorDomain|A server with the specified hostname could not be found.");
  assert(dns.find("secret") == std::string::npos && dns.find('?') == std::string::npos);

  const std::string injectedPrefix = "network_error|nsurl:-1004|NSURLErrorDomain|";
  const std::string injected = adapter.performHttpRequest(base + "/inject", "POST", {}, "{}", 2000).error;
  assert(injected == injectedPrefix + "bad inject line https://amplitude.test/p [redacted]");
  assert(injected.find('\n') == std::string::npos && injected.find('\r') == std::string::npos);
  assert(std::count(injected.begin(), injected.end(), '|') == 3);

  const std::string longDetail = adapter.performHttpRequest(base + "/long", "POST", {}, "{}", 2000).error;
  std::string expectedLong;
  while (expectedLong.size() < 200) {
    expectedLong += "ab ";
  }
  expectedLong.resize(200);
  assert(longDetail == "network_error|nsurl:-1005|NSURLErrorDomain|" + expectedLong);
  const std::string longRun = adapter.performHttpRequest(base + "/longrun", "POST", {}, "{}", 2000).error;
  assert(longRun == "network_error|nsurl:-1005|NSURLErrorDomain|[redacted]");

  const auto sanitized = [&](const std::string& input) {
    NSString* encoded = [[NSString stringWithUTF8String:input.c_str()]
        stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet alphanumericCharacterSet]];
    const std::string error =
        adapter.performHttpRequest(base + "/sanitize?" + std::string(encoded.UTF8String), "POST", {}, "{}", 2000).error;
    const std::string prefix = "network_error|nsurl:-1004|NSURLErrorDomain|";
    assert(error.rfind(prefix, 0) == 0);
    return error.substr(prefix.size());
  };
  const std::vector<std::pair<std::string, std::string>> parityCases = {
      {"https://user:pw@amplitude.test/p failed", "https://amplitude.test/p failed"},
      {"Authorization: Api-Key abc", "[redacted]"},
      {"bad Cookie: a=b", "bad [redacted]"},
      {"set Password 123 now", "set [redacted]"},
      {"NSURLSession load failed", "NSURLSession load failed"},
      {"header value: top-secret-thing", "header value: [redacted]"},
      {"key abcdefghijklmnopqrstuvwxyzABCDEF0123456789 end", "key [redacted] end"},
      {"Error: x at 10:30 and 10:30:15", "Error: x at 10:30 and 10:30:15"},
      {"peer 192.168.1.20 and ::1 and 2001:db8:0:0:0:0:0:1 and fe80::1%en0", "peer [ip] and [ip] and [ip] and [ip]"},
      {"std::string failed", "std::string failed"},
      {"failed to connect to /10.0.0.1 (port 443)", "failed to connect to /[ip] (port 443)"},
      {"failed to connect to api.lab.amplitude.com/93.184.216.34 (port 443) from /10.0.2.15 (port 51234) after 10000ms: isConnected failed: ECONNREFUSED (Connection refused)",
       "failed to connect to api.lab.amplitude.com/[ip] (port 443) after 10000ms: isConnected failed: ECONNREFUSED (Connection refused)"},
      {"failed to connect to /fe80::1%wlan0 (port 443) from /2001:db8::7 (port 4000): connect failed: ENETUNREACH (Network is unreachable)",
       "failed to connect to /[ip] (port 443): connect failed: ENETUNREACH (Network is unreachable)"},
  };
  for (const auto& [input, expected] : parityCases) {
    assert(sanitized(input) == expected);
  }

  const HttpResult nonHttp = adapter.performHttpRequest(base + "/non-http", "GET", {}, "", 2000);
  assert(nonHttp.statusCode == 0 && nonHttp.error == "invalid_http_response");

  const HttpResult exact =
      adapter.performHttpRequest(base + "/bytes/" + std::to_string(kResponseCap), "GET", {}, "", 5000);
  assert(exact.statusCode == 200 && exact.error.empty());
  assert(exact.body.size() == kResponseCap);
  const HttpResult oversized =
      adapter.performHttpRequest(base + "/bytes/" + std::to_string(kResponseCap + 300000), "GET", {}, "", 5000);
  assert(oversized.statusCode == 200 && oversized.error.empty());
  assert(oversized.body.size() == kResponseCap);
  const HttpResult oversizedError =
      adapter.performHttpRequest(base + "/bytes/" + std::to_string(3 * kResponseCap), "POST", {}, "{}", 5000);
  assert(oversizedError.statusCode == 200 && oversizedError.error.empty());
  assert(oversizedError.body.size() == kResponseCap);
  const HttpResult afterOversized = adapter.performHttpRequest(base + "/status/200", "POST", {}, "{}", 2000);
  assert(afterOversized.statusCode == 200 && afterOversized.body == "{\"code\":200}");

  const HttpResult echo = adapter.performHttpRequest(
      base + "/echo",
      "PUT",
      {{"X-Test", "header-value"}, {"X-Bad", "\xff\xfe"}, {"\xff", "ignored"}},
      std::string("body\0with-nul", 13),
      2000);
  assert(echo.statusCode == 200);
  assert(echo.body == "PUT|header-value|none");
  for (const std::string& method : {std::string("PATCH"), std::string("X-CUSTOM")}) {
    const HttpResult custom = adapter.performHttpRequest(base + "/echo", method, {}, "body", 2000);
    assert(custom.statusCode == 200);
    assert(custom.body == method + "||none");
  }

  for (const std::string& url : {std::string(), std::string("\xff\xfe"), std::string("https://amplitude.test/\xff")}) {
    const HttpResult invalid = adapter.performHttpRequest(url, "POST", {}, "{}", 2000);
    assert(invalid.statusCode == 0 && invalid.error == "invalid_url");
  }
  for (const std::string& method : {std::string(), std::string("\xff\xfe")}) {
    const HttpResult invalid = adapter.performHttpRequest(base + "/ok", method, {}, "{}", 2000);
    assert(invalid.statusCode == 0 && invalid.error == "network_error");
  }
}

} // namespace

int main() {
  @autoreleasepool {
    assert(NSHomeDirectory() != nil);
    assert([NSHomeDirectory() containsString:@"nitro-amplitude-ios-adapter-"]);
    testStorageDirectoryIsCreated();
    testLegacyMigration();
    testUserDefaultsFallback();
    testContextAndIdentifierForVendor();
    testHttpRequests();
    std::cout << "IOSAmplitudeAdapter tests passed" << std::endl;
  }
  return 0;
}
