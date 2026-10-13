"use strict";

const RUNTIME_OPTIONS = [
  ["thread", "TSAN_OPTIONS", "halt_on_error=1:second_deadlock_stack=1"],
  ["address", "ASAN_OPTIONS", "strict_string_checks=1"],
  ["undefined", "UBSAN_OPTIONS", "halt_on_error=1:print_stacktrace=1"],
];

function sanitizerCompileFlags(sanitizers) {
  if (!sanitizers) {
    return [];
  }
  return [
    `-fsanitize=${sanitizers}`,
    ...(sanitizers.includes("undefined")
      ? ["-fno-sanitize-recover=undefined"]
      : []),
    "-fno-omit-frame-pointer",
    "-O1",
  ];
}

function sanitizerRuntimeEnv(sanitizers, baseEnv) {
  if (!sanitizers) {
    return baseEnv;
  }
  const env = { ...baseEnv };
  for (const [name, variable, defaults] of RUNTIME_OPTIONS) {
    if (sanitizers.includes(name)) {
      env[variable] = baseEnv[variable] ?? defaults;
    }
  }
  return env;
}

module.exports = { sanitizerCompileFlags, sanitizerRuntimeEnv };
