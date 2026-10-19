import type { Client } from "./types/client";
import type { Variant } from "./types/variant";

export function variantString(
  client: Pick<Client, "variant">,
  key: string,
  fallback: string,
): string {
  const value = client.variant(key, fallback).value;
  return value ?? fallback;
}

/**
 * Returns `true` for the variant values `"on"` and `"true"`, `false` for
 * `"off"` and `"false"`, and the caller `fallback` for any other value.
 */
export function variantBoolean(
  client: Pick<Client, "variant">,
  key: string,
  fallback: boolean,
): boolean {
  const value = client.variant(key, String(fallback)).value;
  if (value === "on" || value === "true") {
    return true;
  }
  if (value === "off" || value === "false") {
    return false;
  }
  return fallback;
}

export function variantNumber(
  client: Pick<Client, "variant">,
  key: string,
  fallback: number,
): number {
  const value = client.variant(key, String(fallback)).value;
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function variantPayload<T>(
  client: Pick<Client, "variantWithMetadata">,
  key: string,
  fallback: T,
): T {
  const result = client.variantWithMetadata(key);
  if (result.fallback) {
    return fallback;
  }
  const payload = result.variant.payload;
  return payload === undefined ? fallback : (payload as T);
}

export function variantJson<T>(
  client: Pick<Client, "variantWithMetadata">,
  key: string,
  fallback: T,
): T {
  const result = client.variantWithMetadata(key);
  if (result.fallback) {
    return fallback;
  }
  return parseVariantJson(result.variant, fallback);
}

export function parseVariantJson<T>(variant: Variant, fallback: T): T {
  if (typeof variant.value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(variant.value) as T;
  } catch {
    return fallback;
  }
}
