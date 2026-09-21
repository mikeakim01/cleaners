import { describe, expect, it } from "vitest";

import {
  assertPhotoMime,
  assertPhotoSize,
  buildPhotoPath,
  MAX_PHOTO_BYTES,
  photoKindFromPath,
} from "../src/services/files.service";

describe("buildPhotoPath", () => {
  it("builds the tenant/job/kind-timestamp path", () => {
    expect(buildPhotoPath("tenant-1", "job-1", "before", 1726845600000)).toBe(
      "tenant-1/job-1/before-1726845600000.jpg",
    );
    expect(buildPhotoPath("tenant-1", "job-1", "after", 1726845600000)).toBe(
      "tenant-1/job-1/after-1726845600000.jpg",
    );
  });

  it("encodes the kind so before/after counts stay derivable", () => {
    const before = buildPhotoPath("t", "j", "before", 1);
    const after = buildPhotoPath("t", "j", "after", 1);
    expect(photoKindFromPath(before)).toBe("before");
    expect(photoKindFromPath(after)).toBe("after");
  });
});

describe("assertPhotoMime", () => {
  it("accepts jpeg, png, and webp", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() => assertPhotoMime(mime)).not.toThrow();
    }
  });

  it("rejects other types with a human message", () => {
    for (const mime of ["image/gif", "application/pdf", "text/plain", "", null, undefined, 42]) {
      expect(() => assertPhotoMime(mime)).toThrow("Photos must be JPEG, PNG, or WebP.");
    }
  });
});

describe("assertPhotoSize", () => {
  it("accepts sizes up to the 5 MB cap", () => {
    expect(() => assertPhotoSize(0)).not.toThrow();
    expect(() => assertPhotoSize(1024)).not.toThrow();
    expect(() => assertPhotoSize(MAX_PHOTO_BYTES)).not.toThrow();
  });

  it("rejects oversized photos with a human message", () => {
    expect(() => assertPhotoSize(MAX_PHOTO_BYTES + 1)).toThrow("Photos must be smaller than 5 MB.");
  });

  it("rejects invalid sizes with the same human message", () => {
    expect(() => assertPhotoSize(-1)).toThrow("Photos must be smaller than 5 MB.");
    expect(() => assertPhotoSize(Number.NaN)).toThrow("Photos must be smaller than 5 MB.");
  });
});
