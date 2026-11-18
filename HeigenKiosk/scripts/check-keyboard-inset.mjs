// Run: node scripts/check-keyboard-inset.mjs
import assert from "node:assert/strict";
import { keyboardInset } from "../src/utils/keyboardInset.js";

assert.equal(keyboardInset(0, 800, 800), 0, "no keyboard");
assert.equal(keyboardInset(300, 800, 800), 300, "window not resized: pad full keyboard");
assert.equal(keyboardInset(300, 800, 500), 0, "window resized by keyboard: no extra pad");
assert.equal(keyboardInset(300, 800, 700), 200, "partly resized: pad the rest");
assert.equal(keyboardInset(300, 0, 0), 300, "before first layout: pad full keyboard");
console.log("keyboardInset ok");
