import assert from "node:assert/strict";
import { parsePref, resolveTheme } from "./theme.ts";

// Explicit choices win over the system.
assert.equal(resolveTheme("light", false), "light");
assert.equal(resolveTheme("dark", true), "dark");

// "system" follows the device.
assert.equal(resolveTheme("system", true), "light");
assert.equal(resolveTheme("system", false), "dark");

// Storage parsing: only the two explicit values mean anything.
assert.equal(parsePref("light"), "light");
assert.equal(parsePref("dark"), "dark");
assert.equal(parsePref(null), "system");
assert.equal(parsePref(undefined), "system");
assert.equal(parsePref("auto"), "system");
assert.equal(parsePref(""), "system");

console.log("all theme tests passed");
