import assert from "node:assert/strict";
import test from "node:test";

import { sniffImage } from "../skills/behavior-debug-board/scripts/qa-board.mjs";

test("screenshot sniffing recognizes PNG magic bytes", () => {
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(sniffImage(image), { mime: "image/png", extension: ".png" });
});

test("screenshot sniffing recognizes JPEG magic bytes", () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.deepEqual(sniffImage(image), { mime: "image/jpeg", extension: ".jpg" });
});

test("screenshot sniffing rejects mislabeled or unknown image data", () => {
  assert.throws(() => sniffImage(Buffer.from("not an image")), /unsupported screenshot format/);
});
