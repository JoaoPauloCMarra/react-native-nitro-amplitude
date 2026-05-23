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

export function variantBoolean(
  client: Pick<Client, "variant">,
  key: string,
  fallback: boolean,
): boolean {
  const value = client.variant(key, String(fallback)).value;
  if (value === "true") {
    return true;
  }
  if (value === "false") {
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
  client: Pick<Client, "variant">,
  key: string,
  fallback: T,
): T {
  const payload = client.variant(key).payload;
  return payload === undefined ? fallback : (payload as T);
}

export function variantJson<T>(
  client: Pick<Client, "variant">,
  key: string,
  fallback: T,
): T {
  const variant = client.variant(key);
  return parseVariantJson(variant, fallback);
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
