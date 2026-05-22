#include "HybridAmplitudeWorker.hpp"

#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
#include "../../ios/IOSAmplitudeAdapterCpp.hpp"
#elif __ANDROID__
#include "../../android/src/main/cpp/AndroidAmplitudeAdapterCpp.hpp"
#include <fbjni/fbjni.h>
#endif
#endif

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace margelo::nitro::NitroAmplitude {

namespace {
std::shared_ptr<::NitroAmplitude::NativeAmplitudeAdapter> createPlatformAdapter() {
#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
  return std::make_shared<::NitroAmplitude::IOSAmplitudeAdapterCpp>();
#elif __ANDROID__
  auto context = ::NitroAmplitude::AndroidAmplitudeAdapterJava::getContext();
  return std::make_shared<::NitroAmplitude::AndroidAmplitudeAdapterCpp>(context);
#else
  return nullptr;
#endif
#else
  return nullptr;
#endif
}
} // namespace

HybridAmplitudeWorker::HybridAmplitudeWorker()
    : HybridObject(TAG), HybridAmplitudeWorkerSpec() {
  adapter_ = createPlatformAdapter();
  workerThread_ = std::thread([this]() { workerLoop(); });
}

HybridAmplitudeWorker::~HybridAmplitudeWorker() {
  {
    std::lock_guard<std::mutex> lock(queueMutex_);
    running_ = false;
  }
  queueCv_.notify_all();
  if (workerThread_.joinable()) {
    workerThread_.join();
  }
}

void HybridAmplitudeWorker::enqueue(
    const std::string& requestId,
    const std::string& url,
    const std::string& method,
    const std::string& headersJson,
    const std::string& body,
    double timeoutMillis) {
  if (requestId.empty() || url.empty()) {
    throw std::runtime_error("NitroAmplitude: Invalid HTTP request");
  }
  if (std::isnan(timeoutMillis) || std::isinf(timeoutMillis) || timeoutMillis <= 0.0) {
    timeoutMillis = 10000.0;
  }

  WorkerRequest request{
      requestId,
      url,
      method,
      headersJson,
      body,
      static_cast<int>(timeoutMillis),
  };

  {
    std::lock_guard<std::mutex> lock(queueMutex_);
    cancelledRequests_.erase(requestId);
    queue_.push(std::move(request));
    queueSize_ = queue_.size();
  }
  queueCv_.notify_one();
}

void HybridAmplitudeWorker::cancel(const std::string& requestId) {
  std::lock_guard<std::mutex> lock(queueMutex_);
  cancelledRequests_.insert(requestId);
}

std::function<void()> HybridAmplitudeWorker::addOnComplete(
    const std::function<void(
        const std::string&,
        double,
        const std::string&,
        const std::string&)>& callback) {
  std::lock_guard<std::mutex> lock(listenersMutex_);
  const size_t listenerId = ++nextListenerId_;
  listeners_.push_back(Listener{listenerId, callback});
  return [this, listenerId]() {
    std::lock_guard<std::mutex> innerLock(listenersMutex_);
    listeners_.erase(
        std::remove_if(
            listeners_.begin(),
            listeners_.end(),
            [listenerId](const Listener& listener) { return listener.id == listenerId; }),
        listeners_.end());
  };
}

double HybridAmplitudeWorker::queueSize() {
  return static_cast<double>(queueSize_.load());
}

void HybridAmplitudeWorker::workerLoop() {
  while (true) {
    WorkerRequest request;
    {
      std::unique_lock<std::mutex> lock(queueMutex_);
      queueCv_.wait(lock, [this]() { return !running_ || !queue_.empty(); });
      if (!running_ && queue_.empty()) {
        return;
      }
      request = std::move(queue_.front());
      queue_.pop();
      queueSize_ = queue_.size();
      if (cancelledRequests_.erase(request.requestId) > 0) {
        notifyComplete(request.requestId, 0, "", "cancelled");
        continue;
      }
    }

    if (!adapter_) {
      notifyComplete(request.requestId, 0, "", "Native adapter unavailable");
      continue;
    }

    const auto result = [&request, this]() {
#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __ANDROID__
      ::NitroAmplitude::HttpResult androidResult;
      facebook::jni::ThreadScope::WithClassLoader([&request, this, &androidResult]() {
        androidResult = adapter_->performHttpRequest(
            request.url,
            request.method,
            request.headersJson,
            request.body,
            request.timeoutMillis);
      });
      return androidResult;
#endif
#endif
      return adapter_->performHttpRequest(
          request.url,
          request.method,
          request.headersJson,
          request.body,
          request.timeoutMillis);
    }();

    notifyComplete(
        request.requestId,
        static_cast<double>(result.statusCode),
        result.body,
        result.error);
  }
}

void HybridAmplitudeWorker::notifyComplete(
    const std::string& requestId,
    double statusCode,
    const std::string& body,
    const std::string& error) {
  std::lock_guard<std::mutex> lock(listenersMutex_);
  for (const auto& listener : listeners_) {
    listener.callback(requestId, statusCode, body, error);
  }
}

} // namespace margelo::nitro::NitroAmplitude
