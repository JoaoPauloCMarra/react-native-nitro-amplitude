#include "HybridAmplitudeWorker.hpp"

#include "../core/PlatformAdapterFactory.hpp"

#include <algorithm>
#include <cmath>
#include <exception>
#include <stdexcept>

namespace margelo::nitro::NitroAmplitude {

namespace {
constexpr int kDefaultTimeoutMillis = 10000;
constexpr int kMaxTimeoutMillis = 300000;
constexpr size_t kMaxQueuedRequests = 100;
constexpr size_t kWorkerThreadCount = 2;

size_t requestBodyBytes(const WorkerRequest& request) {
  size_t headerBytes = 0;
  for (const auto& header : request.headers) {
    headerBytes += header.first.size() + header.second.size();
  }
  return request.body.size() + headerBytes;
}
} // namespace

HybridAmplitudeWorker::HybridAmplitudeWorker()
    : HybridObject(TAG), HybridAmplitudeWorkerSpec() {
  adapter_ = ::NitroAmplitude::getSharedPlatformAdapters().http;
  for (size_t i = 0; i < kWorkerThreadCount; ++i) {
    workerThreads_.emplace_back([this]() { workerLoop(); });
  }
}

HybridAmplitudeWorker::HybridAmplitudeWorker(
    std::shared_ptr<::NitroAmplitude::HttpAdapter> adapter)
    : HybridObject(TAG), HybridAmplitudeWorkerSpec(), adapter_(std::move(adapter)) {
  for (size_t i = 0; i < kWorkerThreadCount; ++i) {
    workerThreads_.emplace_back([this]() { workerLoop(); });
  }
}

HybridAmplitudeWorker::~HybridAmplitudeWorker() {
  {
    std::lock_guard<std::mutex> lock(queueMutex_);
    running_ = false;
  }
  queueCv_.notify_all();
  for (auto& thread : workerThreads_) {
    if (thread.joinable()) {
      thread.join();
    }
  }
}

void HybridAmplitudeWorker::enqueue(
    const std::string& requestId,
    const std::string& url,
    const std::string& method,
    const std::unordered_map<std::string, std::string>& headers,
    const std::string& body,
    double timeoutMillis) {
  if (requestId.empty() || url.empty()) {
    throw std::runtime_error("NitroAmplitude: Invalid HTTP request");
  }
  if (std::isnan(timeoutMillis) || std::isinf(timeoutMillis) || timeoutMillis <= 0.0) {
    timeoutMillis = kDefaultTimeoutMillis;
  }
  timeoutMillis = std::min(std::ceil(timeoutMillis), static_cast<double>(kMaxTimeoutMillis));

  WorkerRequest request{
      requestId,
      url,
      method,
      headers,
      body,
      static_cast<int>(timeoutMillis),
  };

  const size_t bodyBytes = requestBodyBytes(request);
  {
    std::lock_guard<std::mutex> lock(queueMutex_);
    if (queue_.size() >= kMaxQueuedRequests) {
      throw std::runtime_error("NitroAmplitude: queue_full");
    }
    request.generation = ++nextGeneration_;
    activeGenerations_[requestId].push_back(request.generation);
    queue_.push(std::move(request));
    queueSize_ = queue_.size();
    pendingBodyBytes_ += bodyBytes;
  }
  queueCv_.notify_one();
}

void HybridAmplitudeWorker::cancel(const std::string& requestId) {
  std::lock_guard<std::mutex> lock(queueMutex_);
  const auto active = activeGenerations_.find(requestId);
  if (active == activeGenerations_.end() || active->second.empty()) {
    return;
  }
  cancelledGenerations_.insert(active->second.back());
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

double HybridAmplitudeWorker::inFlightCount() {
  return static_cast<double>(inFlightCount_.load());
}

double HybridAmplitudeWorker::pendingBodyBytes() {
  return static_cast<double>(pendingBodyBytes_.load());
}

size_t HybridAmplitudeWorker::getExternalMemorySize() noexcept {
  return pendingBodyBytes_.load();
}

void HybridAmplitudeWorker::workerLoop() {
  while (true) {
    WorkerRequest request;
    bool notifyCancelled = false;
    {
      std::unique_lock<std::mutex> lock(queueMutex_);
      queueCv_.wait(lock, [this]() { return !running_ || !queue_.empty(); });
      if (queue_.empty()) {
        if (!running_) {
          return;
        }
        continue;
      }
      request = std::move(queue_.front());
      queue_.pop();
      queueSize_ = queue_.size();
      const size_t bodyBytes = requestBodyBytes(request);
      pendingBodyBytes_ -= std::min(pendingBodyBytes_.load(), bodyBytes);
      if (!running_ || cancelledGenerations_.erase(request.generation) > 0) {
        notifyCancelled = true;
      } else {
        ++inFlightCount_;
        inFlightGenerations_.insert(request.generation);
      }
    }

    if (notifyCancelled) {
      {
        std::lock_guard<std::mutex> lock(queueMutex_);
        cancelledGenerations_.erase(request.generation);
        const auto active = activeGenerations_.find(request.requestId);
        if (active != activeGenerations_.end()) {
          auto& generations = active->second;
          generations.erase(
              std::remove(generations.begin(), generations.end(), request.generation),
              generations.end());
          if (generations.empty()) {
            activeGenerations_.erase(active);
          }
        }
      }
      notifyComplete(request.requestId, 0, "", "cancelled");
      continue;
    }

    ::NitroAmplitude::HttpResult result;
    try {
      if (!adapter_) {
        result.error = "Native adapter unavailable";
      } else {
#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __ANDROID__
        facebook::jni::ThreadScope::WithClassLoader([&request, this, &result]() {
              result = adapter_->performHttpRequest(
                  request.url,
                  request.method,
                  request.headers,
                  request.body,
                  request.timeoutMillis);
        });
#else
        result = adapter_->performHttpRequest(
            request.url,
            request.method,
            request.headers,
            request.body,
            request.timeoutMillis);
#endif
#else
        result = adapter_->performHttpRequest(
            request.url,
            request.method,
            request.headers,
            request.body,
            request.timeoutMillis);
#endif
      }
    } catch (const std::exception&) {
      result = ::NitroAmplitude::HttpResult{};
      result.error = "native_http_exception";
    } catch (...) {
      result = ::NitroAmplitude::HttpResult{};
      result.error = "native_http_exception";
    }

    --inFlightCount_;
    {
      std::lock_guard<std::mutex> lock(queueMutex_);
      inFlightGenerations_.erase(request.generation);
      cancelledGenerations_.erase(request.generation);
      const auto active = activeGenerations_.find(request.requestId);
      if (active != activeGenerations_.end()) {
        auto& generations = active->second;
        generations.erase(
            std::remove(generations.begin(), generations.end(), request.generation),
            generations.end());
        if (generations.empty()) {
          activeGenerations_.erase(active);
        }
      }
    }
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
  std::vector<Listener> snapshot;
  {
    std::lock_guard<std::mutex> lock(listenersMutex_);
    snapshot = listeners_;
  }
  for (const auto& listener : snapshot) {
    try {
      listener.callback(requestId, statusCode, body, error);
    } catch (...) {
    }
  }
}

} // namespace margelo::nitro::NitroAmplitude
