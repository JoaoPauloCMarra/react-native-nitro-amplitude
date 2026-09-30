# Native libraries

Analytics flush still builds JSON in JavaScript. Native code owns HTTP, gzip,
and the on-disk event/experiment queue.

## Kept

| Library | Where | Why |
| --- | --- | --- |
| zlib gzip | `cpp/core/Gzip.cpp`, `HybridAmplitudeWorker` | Amplitude HTTP V2 accepts `Content-Encoding: gzip`. Bodies ≥ 1 KiB to `*.amplitude.com` are compressed on the worker thread. |
| JSONL segments + tombstones | `JsonlSegmentStore` | Deletes append a tombstone instead of rewriting the segment. Compaction runs when a segment is more than 50% dead. Compaction keeps a tombstone while any lower segment still holds data, so a deleted key cannot reappear after relaunch, and it aborts without changes when a live row cannot be read. A delete throws `storage_error` when its tombstone cannot be written. |

## Evaluated and not shipped

| Library | Decision |
| --- | --- |
| yyjson | Rejected for event encode. Payload shape is owned by `@amplitude/analytics-core` in JavaScript. |
| SQLite queue | Rejected for this pass. Tombstones give durable deletes without a second store format. |
| libcurl | Rejected. Platform HTTP adapters already run off the JS thread. |

Custom `serverUrl` hosts are not gzipped so local and mock transports keep
plain JSON. An existing `Content-Encoding` header is left untouched.
