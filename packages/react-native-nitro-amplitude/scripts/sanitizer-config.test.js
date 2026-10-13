const { describe, expect, test } = require("bun:test");
const {
  sanitizerCompileFlags,
  sanitizerRuntimeEnv,
} = require("./sanitizer-config");

describe("sanitizerRuntimeEnv", () => {
  test("address,undefined carries both runtime option blocks", () => {
    const env = sanitizerRuntimeEnv("address,undefined", {});
    expect(env.ASAN_OPTIONS).toBe("strict_string_checks=1");
    expect(env.UBSAN_OPTIONS).toBe("halt_on_error=1:print_stacktrace=1");
  });

  test("thread only sets TSAN options", () => {
    const env = sanitizerRuntimeEnv("thread", {});
    expect(env.TSAN_OPTIONS).toContain("halt_on_error=1");
    expect(env.ASAN_OPTIONS).toBeUndefined();
    expect(env.UBSAN_OPTIONS).toBeUndefined();
  });

  test("caller supplied options win", () => {
    const env = sanitizerRuntimeEnv("address,undefined", {
      ASAN_OPTIONS: "a=1",
      UBSAN_OPTIONS: "b=1",
    });
    expect(env.ASAN_OPTIONS).toBe("a=1");
    expect(env.UBSAN_OPTIONS).toBe("b=1");
  });

  test("no sanitizer returns the base env untouched", () => {
    const base = { A: "1" };
    expect(sanitizerRuntimeEnv(undefined, base)).toBe(base);
  });
});

describe("sanitizerCompileFlags", () => {
  test("address,undefined makes undefined behaviour fatal", () => {
    const flags = sanitizerCompileFlags("address,undefined");
    expect(flags).toContain("-fsanitize=address,undefined");
    expect(flags).toContain("-fno-sanitize-recover=undefined");
  });

  test("address alone does not add the undefined recover flag", () => {
    expect(sanitizerCompileFlags("address")).not.toContain(
      "-fno-sanitize-recover=undefined",
    );
  });

  test("no sanitizer adds no flags", () => {
    expect(sanitizerCompileFlags(undefined)).toEqual([]);
  });
});
