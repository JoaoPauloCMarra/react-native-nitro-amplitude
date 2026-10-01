#include "JsonlSegmentStore.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <limits>
#include <stdexcept>

namespace NitroAmplitude {

namespace {

constexpr char kSegmentPrefix[] = "segment-";
constexpr char kSegmentSuffix[] = ".jsonl";
constexpr char kTombstoneKey[] = "\x7f" "DEL";

void EscapeInto(const std::string& value, std::string& out) {
  out.reserve(out.size() + value.size());
  for (const char c : value) {
    switch (c) {
      case '\\':
        out += "\\\\";
        break;
      case '\t':
        out += "\\t";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      default:
        out += c;
    }
  }
}

bool UnescapeInto(const std::string& value, std::string& out) {
  out.clear();
  out.reserve(value.size());
  for (size_t i = 0; i < value.size(); ++i) {
    const char c = value[i];
    if (c != '\\') {
      out += c;
      continue;
    }
    if (i + 1 >= value.size()) {
      return false;
    }
    switch (value[i + 1]) {
      case '\\':
        out += '\\';
        break;
      case 't':
        out += '\t';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      default:
        return false;
    }
    ++i;
  }
  return true;
}

std::optional<uint32_t> ParseSegmentId(const std::string& name) {
  const size_t prefixLength = std::strlen(kSegmentPrefix);
  const size_t suffixLength = std::strlen(kSegmentSuffix);
  if (name.size() <= prefixLength + suffixLength ||
      name.rfind(kSegmentPrefix, 0) != 0 ||
      name.compare(name.size() - suffixLength, suffixLength, kSegmentSuffix) != 0) {
    return std::nullopt;
  }
  const std::string digits = name.substr(prefixLength, name.size() - suffixLength - prefixLength);
  if (digits.empty() || digits.size() > 10 ||
      digits.find_first_not_of("0123456789") != std::string::npos) {
    return std::nullopt;
  }
  const unsigned long long parsed = std::stoull(digits);
  if (parsed > std::numeric_limits<uint32_t>::max()) {
    return std::nullopt;
  }
  return static_cast<uint32_t>(parsed);
}

bool IsStaleTemporarySegment(const std::string& name) {
  constexpr char marker[] = ".jsonl.tmp.";
  const size_t position = name.find(marker);
  if (position == std::string::npos ||
      position + std::strlen(marker) >= name.size()) {
    return false;
  }
  return ParseSegmentId(name.substr(0, position + std::strlen(kSegmentSuffix))).has_value();
}

size_t CompletePrefixLength(const std::string& content) {
  const size_t lastNewline = content.rfind('\n');
  if (lastNewline == std::string::npos) {
    return 0;
  }
  return lastNewline + 1;
}

} // namespace

JsonlSegmentStore::JsonlSegmentStore(
    std::shared_ptr<FileAdapter> fileAdapter,
    std::string directory,
    uint64_t maxSegmentBytes,
    uint64_t maxRecordBytes)
    : fileAdapter_(std::move(fileAdapter)),
      directory_(std::move(directory)),
      maxSegmentBytes_(maxSegmentBytes == 0 ? kDefaultMaxSegmentBytes : maxSegmentBytes),
      maxRecordBytes_(std::min(
          maxRecordBytes == 0 ? kDefaultMaxRecordBytes : maxRecordBytes,
          kDefaultMaxRecordBytes)) {
  Load();
}

bool JsonlSegmentStore::EnsureReadyLocked() {
  return loaded_ || Load();
}

std::optional<std::set<uint32_t>> JsonlSegmentStore::ListedSegments() {
  const auto names = fileAdapter_->readDirectory(directory_);
  if (!names.has_value()) {
    return std::nullopt;
  }
  std::set<uint32_t> listed;
  for (const auto& name : names.value()) {
    const auto id = ParseSegmentId(name);
    if (id.has_value()) {
      listed.insert(id.value());
    }
  }
  return listed;
}

bool JsonlSegmentStore::HasMissingSegment(const std::set<uint32_t>& listed) const {
  for (const auto& segment : segmentBytes_) {
    if (segment.second > 0 && listed.count(segment.first) == 0) {
      return true;
    }
  }
  return false;
}

bool JsonlSegmentStore::Load() {
  auto names = fileAdapter_->readDirectory(directory_);
  if (!names.has_value()) {
    fileAdapter_->ensureDirectory(directory_);
    names = fileAdapter_->readDirectory(directory_);
  }
  if (!names.has_value()) {
    return false;
  }
  index_.clear();
  segmentBytes_.clear();
  segmentDeadBytes_.clear();
  unreadableSegments_.clear();
  partiallyReadSegments_.clear();
  activeSegment_ = 0;
  appendsDisabled_ = false;
  loaded_ = true;
  std::vector<uint32_t> segmentIds;
  for (const auto& name : names.value()) {
    const auto id = ParseSegmentId(name);
    if (id.has_value()) {
      segmentIds.push_back(id.value());
    } else if (IsStaleTemporarySegment(name)) {
      fileAdapter_->removeFile(directory_ + "/" + name);
    }
  }
  std::sort(segmentIds.begin(), segmentIds.end());
  bool failedToTrimTail = false;
  for (const uint32_t id : segmentIds) {
    const std::string path = SegmentPath(id);
    const auto content = fileAdapter_->readFile(path);
    if (!content.has_value()) {
      unreadableSegments_.insert(id);
      partiallyReadSegments_.insert(id);
      continue;
    }
    const size_t completeBytes = CompletePrefixLength(content.value());
    size_t offset = 0;
    while (offset < completeBytes) {
      const size_t newline = content.value().find('\n', offset);
      const size_t length = newline - offset + 1;
      const size_t tab = content.value().find('\t', offset);
      std::string key;
      std::string value;
      if (length <= maxRecordBytes_ && tab != std::string::npos && tab < newline &&
          UnescapeInto(content.value().substr(offset, tab - offset), key) &&
          UnescapeInto(content.value().substr(tab + 1, newline - tab - 1), value)) {
        if (key == kTombstoneKey) {
          index_.erase(value);
        } else {
          index_[key] = Entry{id, static_cast<uint64_t>(offset), static_cast<uint32_t>(length)};
        }
      } else {
        partiallyReadSegments_.insert(id);
      }
      offset = newline + 1;
    }
    if (completeBytes == 0) {
      if (fileAdapter_->removeFile(path)) {
        continue;
      }
      if (!content.value().empty()) {
        failedToTrimTail = true;
        partiallyReadSegments_.insert(id);
      }
    } else if (completeBytes < content.value().size()) {
      if (!fileAdapter_->writeFile(path, content.value().substr(0, completeBytes))) {
        failedToTrimTail = true;
        partiallyReadSegments_.insert(id);
      }
    }
    segmentBytes_[id] = completeBytes;
    if (id > activeSegment_) {
      activeSegment_ = id;
    }
  }
  if (!unreadableSegments_.empty() && *unreadableSegments_.rbegin() >= activeSegment_ &&
      !failedToTrimTail) {
    const uint32_t highestUnreadable = *unreadableSegments_.rbegin();
    if (highestUnreadable == std::numeric_limits<uint32_t>::max()) {
      appendsDisabled_ = true;
    } else {
      activeSegment_ = highestUnreadable + 1;
      segmentBytes_[activeSegment_] = 0;
      segmentDeadBytes_[activeSegment_] = 0;
    }
  }
  if (failedToTrimTail) {
    const uint32_t highestListedSegment = segmentIds.back();
    if (highestListedSegment == std::numeric_limits<uint32_t>::max()) {
      // Keep recovered values readable, but do not risk appending to the
      // untrimmed physical tail when no higher segment ID is available.
      activeSegment_ = highestListedSegment;
      appendsDisabled_ = true;
    } else {
      activeSegment_ = highestListedSegment + 1;
      segmentBytes_[activeSegment_] = 0;
      segmentDeadBytes_[activeSegment_] = 0;
    }
  }
  std::unordered_map<uint32_t, uint64_t> liveBytes;
  for (const auto& entry : index_) {
    liveBytes[entry.second.segment] += entry.second.length;
  }
  for (const auto& segment : segmentBytes_) {
    const auto live = liveBytes.find(segment.first);
    const uint64_t liveValue = live == liveBytes.end() ? 0 : live->second;
    segmentDeadBytes_[segment.first] =
        segment.second >= liveValue ? segment.second - liveValue : 0;
  }
  ReclaimSegmentsWithoutLiveRecords();
  return true;
}

std::string JsonlSegmentStore::SegmentPath(uint32_t segment) const {
  char name[32];
  std::snprintf(name, sizeof(name), "segment-%08u.jsonl", segment);
  return directory_ + "/" + name;
}

void JsonlSegmentStore::SetLocked(const std::string& key, const std::string& value) {
  if (appendsDisabled_) {
    throw std::runtime_error("NitroAmplitude: segment storage append unavailable");
  }

  if (key == kTombstoneKey) {
    throw SegmentStoreRejectedRecord("NitroAmplitude: segment storage key reserved");
  }

  std::string line;
  EscapeInto(key, line);
  line += '\t';
  EscapeInto(value, line);
  line += '\n';
  if (line.size() > maxRecordBytes_) {
    throw SegmentStoreRejectedRecord("NitroAmplitude: segment storage record too large");
  }

  const AppendResult result = AppendLineLocked(line);
  if (result == AppendResult::Unavailable) {
    throw std::runtime_error("NitroAmplitude: segment storage append unavailable");
  }
  if (result == AppendResult::Failed) {
    throw std::runtime_error("NitroAmplitude: segment storage append failed");
  }

  const uint64_t offset = segmentBytes_[activeSegment_];
  const auto existing = index_.find(key);
  const std::optional<Entry> previous = existing == index_.end()
      ? std::nullopt
      : std::optional<Entry>(existing->second);
  index_[key] = Entry{activeSegment_, offset, static_cast<uint32_t>(line.size())};
  segmentBytes_[activeSegment_] = offset + line.size();

  if (previous.has_value()) {
    segmentDeadBytes_[previous->segment] += previous->length;
    if (previous->segment != activeSegment_) {
      MaybeCompact(previous->segment);
    }
  }
}

JsonlSegmentStore::AppendResult JsonlSegmentStore::AppendLineLocked(const std::string& line) {
  if (!EnsureReadyLocked()) {
    return AppendResult::Failed;
  }
  for (int attempt = 0; attempt < 2; ++attempt) {
    if (appendsDisabled_) {
      return AppendResult::Unavailable;
    }
    const uint32_t segmentBeforeRotation = activeSegment_;
    RotateIfNeeded(line.size());
    if (appendsDisabled_) {
      return AppendResult::Unavailable;
    }
    const std::string path = SegmentPath(activeSegment_);
    if (fileAdapter_->appendFile(path, line)) {
      return AppendResult::Appended;
    }

    if (fileAdapter_->appendFile(path, std::string())) {
      if (!RestoreActiveSegment(segmentBeforeRotation)) {
        AbandonActiveSegmentAfterAppendFailure();
      }
      return AppendResult::Failed;
    }

    fileAdapter_->ensureDirectory(directory_);
    const auto listed = ListedSegments();
    if (listed.has_value() && HasMissingSegment(listed.value())) {
      if (!Load()) {
        return AppendResult::Failed;
      }
      continue;
    }
    if (segmentBytes_[activeSegment_] > 0 ||
        !RestoreActiveSegment(segmentBeforeRotation)) {
      AbandonActiveSegmentAfterAppendFailure();
      return AppendResult::Failed;
    }
  }
  return AppendResult::Failed;
}

bool JsonlSegmentStore::RestoreActiveSegment(uint32_t segmentBeforeRotation) {
  const std::string path = SegmentPath(activeSegment_);
  const uint64_t committed = segmentBytes_[activeSegment_];
  if (committed > 0) {
    return fileAdapter_->truncateFile(path, committed);
  }
  if (!fileAdapter_->removeFile(path)) {
    return false;
  }
  if (activeSegment_ != segmentBeforeRotation) {
    segmentBytes_.erase(activeSegment_);
    segmentDeadBytes_.erase(activeSegment_);
    activeSegment_ = segmentBeforeRotation;
  }
  return true;
}

void JsonlSegmentStore::AbandonActiveSegmentAfterAppendFailure() {
  partiallyReadSegments_.insert(activeSegment_);
  if (activeSegment_ == std::numeric_limits<uint32_t>::max()) {
    appendsDisabled_ = true;
    return;
  }
  ++activeSegment_;
  segmentBytes_[activeSegment_] = 0;
  segmentDeadBytes_[activeSegment_] = 0;
}

void JsonlSegmentStore::RotateIfNeeded(uint64_t lineLength) {
  const uint64_t bytes = segmentBytes_[activeSegment_];
  if (bytes == 0 || bytes + lineLength <= maxSegmentBytes_) {
    return;
  }
  if (segmentDeadBytes_[activeSegment_] > 0) {
    CompactSegment(activeSegment_);
    if (segmentBytes_[activeSegment_] + lineLength <= maxSegmentBytes_) {
      return;
    }
  }
  if (activeSegment_ == std::numeric_limits<uint32_t>::max()) {
    appendsDisabled_ = true;
    return;
  }
  activeSegment_ += 1;
  segmentBytes_[activeSegment_] = 0;
  segmentDeadBytes_[activeSegment_] = 0;
}

void JsonlSegmentStore::MaybeCompact(uint32_t segment) {
  const uint64_t bytes = segmentBytes_[segment];
  const uint64_t dead = segmentDeadBytes_[segment];
  if (bytes == 0 || dead * 2 < bytes) {
    return;
  }
  CompactSegment(segment);
}

bool JsonlSegmentStore::AppendTombstoneLocked(const std::string& key) {
  if (appendsDisabled_) {
    return false;
  }

  std::string line;
  EscapeInto(kTombstoneKey, line);
  line += '\t';
  EscapeInto(key, line);
  line += '\n';
  if (line.size() > maxRecordBytes_ ||
      AppendLineLocked(line) != AppendResult::Appended) {
    return false;
  }
  segmentBytes_[activeSegment_] += line.size();
  segmentDeadBytes_[activeSegment_] += line.size();
  return true;
}

bool JsonlSegmentStore::CompactSegment(uint32_t segment) {
  const std::string path = SegmentPath(segment);
  const auto content = fileAdapter_->readFile(path);
  if (!content.has_value()) {
    return false;
  }
  size_t liveCount = 0;
  for (const auto& entry : index_) {
    if (entry.second.segment == segment) {
      ++liveCount;
    }
  }
  bool lowerSegmentHasData =
      !unreadableSegments_.empty() && *unreadableSegments_.begin() < segment;
  for (const auto& entry : segmentBytes_) {
    if (entry.first < segment && entry.second > 0) {
      lowerSegmentHasData = true;
      break;
    }
  }

  std::string rebuilt;
  uint64_t keptTombstoneBytes = 0;
  std::set<std::string> keptTombstoneKeys;
  std::vector<std::pair<std::string, Entry>> compacted;
  compacted.reserve(liveCount);
  const size_t completeBytes = CompletePrefixLength(content.value());
  size_t offset = 0;
  while (offset < completeBytes) {
    const size_t newline = content.value().find('\n', offset);
    const size_t length = newline - offset + 1;
    const size_t tab = content.value().find('\t', offset);
    std::string key;
    std::string value;
    if (tab != std::string::npos && tab < newline &&
        UnescapeInto(content.value().substr(offset, tab - offset), key)) {
      if (key == kTombstoneKey) {
        if (lowerSegmentHasData &&
            UnescapeInto(content.value().substr(tab + 1, newline - tab - 1), value) &&
            index_.find(value) == index_.end() &&
            keptTombstoneKeys.insert(value).second) {
          rebuilt.append(content.value(), offset, length);
          keptTombstoneBytes += length;
        }
      } else {
        const auto live = index_.find(key);
        if (live != index_.end() && live->second.segment == segment &&
            live->second.offset == offset && live->second.length == length) {
          Entry compactedEntry = live->second;
          compactedEntry.offset = rebuilt.size();
          rebuilt.append(content.value(), offset, length);
          compacted.emplace_back(key, compactedEntry);
        }
      }
    }
    offset = newline + 1;
  }
  if (compacted.size() != liveCount) {
    return false;
  }
  if (liveCount == 0 && !rebuilt.empty() && MoveTombstonesToActiveSegment(segment, rebuilt)) {
    return true;
  }
  if (rebuilt.empty()) {
    if (!fileAdapter_->removeFile(path)) {
      return false;
    }
  } else if (!fileAdapter_->writeFile(path, rebuilt)) {
    return false;
  }
  for (const auto& entry : compacted) {
    index_[entry.first] = entry.second;
  }
  segmentBytes_[segment] = rebuilt.size();
  segmentDeadBytes_[segment] = keptTombstoneBytes;
  return true;
}

bool JsonlSegmentStore::MoveTombstonesToActiveSegment(
    uint32_t segment,
    const std::string& tombstones) {
  if (appendsDisabled_ || segment >= activeSegment_ ||
      partiallyReadSegments_.upper_bound(segment) != partiallyReadSegments_.end()) {
    return false;
  }
  const std::string activePath = SegmentPath(activeSegment_);
  const uint64_t activeBytes = segmentBytes_[activeSegment_];
  std::string merged;
  if (activeBytes > 0) {
    auto activeContent = fileAdapter_->readFile(activePath);
    if (!activeContent.has_value() || activeContent->size() != activeBytes) {
      return false;
    }
    merged = std::move(activeContent.value());
  }
  merged += tombstones;
  if (!fileAdapter_->writeFile(activePath, merged)) {
    return false;
  }
  segmentBytes_[activeSegment_] = merged.size();
  segmentDeadBytes_[activeSegment_] += tombstones.size();
  if (!fileAdapter_->removeFile(SegmentPath(segment))) {
    return false;
  }
  segmentBytes_[segment] = 0;
  segmentDeadBytes_[segment] = 0;
  return true;
}

void JsonlSegmentStore::ReclaimSegmentsWithoutLiveRecords() {
  std::vector<uint32_t> candidates;
  for (const auto& segment : segmentBytes_) {
    if (segment.first != activeSegment_ && segment.second > 0 &&
        segmentDeadBytes_[segment.first] >= segment.second) {
      candidates.push_back(segment.first);
    }
  }
  std::sort(candidates.begin(), candidates.end());
  for (const uint32_t segment : candidates) {
    CompactSegment(segment);
  }
}

void JsonlSegmentStore::setDisk(const std::string& key, const std::string& value) {
  std::lock_guard<std::mutex> lock(mutex_);
  SetLocked(key, value);
}

std::optional<std::string> JsonlSegmentStore::getDisk(const std::string& key) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!EnsureReadyLocked()) {
    return std::nullopt;
  }
  const auto it = index_.find(key);
  if (it == index_.end()) {
    return std::nullopt;
  }
  const auto line = fileAdapter_->readRange(SegmentPath(it->second.segment), it->second.offset, it->second.length);
  if (!line.has_value()) {
    fileAdapter_->ensureDirectory(directory_);
    const auto listed = ListedSegments();
    if (listed.has_value() && HasMissingSegment(listed.value())) {
      Load();
    }
    return std::nullopt;
  }
  const size_t newline = line.value().find('\n');
  const size_t tab = line.value().find('\t');
  if (newline == std::string::npos || tab == std::string::npos || tab > newline) {
    return std::nullopt;
  }
  std::string value;
  if (!UnescapeInto(line.value().substr(tab + 1, newline - tab - 1), value)) {
    return std::nullopt;
  }
  return value;
}

void JsonlSegmentStore::deleteDisk(const std::string& key) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!EnsureReadyLocked()) {
    throw std::runtime_error("NitroAmplitude: segment storage append failed");
  }
  if (index_.find(key) == index_.end()) {
    return;
  }
  if (!AppendTombstoneLocked(key)) {
    throw std::runtime_error("NitroAmplitude: segment storage append failed");
  }
  const auto it = index_.find(key);
  if (it == index_.end()) {
    return;
  }
  const Entry deletedEntry = it->second;
  index_.erase(key);
  segmentDeadBytes_[deletedEntry.segment] += deletedEntry.length;
  MaybeCompact(deletedEntry.segment);
}

bool JsonlSegmentStore::hasDisk(const std::string& key) {
  std::lock_guard<std::mutex> lock(mutex_);
  return EnsureReadyLocked() && index_.find(key) != index_.end();
}

std::vector<std::string> JsonlSegmentStore::getAllDiskKeys() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!EnsureReadyLocked()) {
    throw std::runtime_error("NitroAmplitude: segment storage unavailable");
  }
  std::vector<std::string> keys;
  keys.reserve(index_.size());
  for (const auto& entry : index_) {
    keys.push_back(entry.first);
  }
  return keys;
}

size_t JsonlSegmentStore::migrateLegacyEntries(
    const std::vector<std::pair<std::string, std::string>>& entries) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!EnsureReadyLocked()) {
    throw std::runtime_error("NitroAmplitude: segment storage append failed");
  }
  size_t imported = 0;
  for (const auto& entry : entries) {
    if (index_.find(entry.first) != index_.end()) {
      continue;
    }
    SetLocked(entry.first, entry.second);
    ++imported;
  }
  return imported;
}

} // namespace NitroAmplitude
