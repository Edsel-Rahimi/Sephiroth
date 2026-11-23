import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearFailures,
  generateAdminPassword,
  hashPassword,
  lockState,
  registerFailure,
  verifyPassword,
} from "../src/lib/auth";

describe("password hashing", () => {
  it("verify round-trips and rejects wrong passwords", () => {
    const hash = hashPassword("S3cure-Pass!");
    assert.equal(verifyPassword("S3cure-Pass!", hash), true);
    assert.equal(verifyPassword("wrong", hash), false);
  });

  it("generated admin password is long and unique", () => {
    const a = generateAdminPassword();
    const b = generateAdminPassword();
    assert.ok(a.length >= 22);
    assert.notEqual(a, b);
    assert.ok(!a.includes("sephiroth"));
  });
});

describe("brute-force lockout", () => {
  it("locks an IP after the per-IP limit", () => {
    for (let i = 0; i < 5; i++) {
      const fail = registerFailure("1.2.3.4", "attacker");
      assert.equal(fail.locked, i === 4);
    }
    assert.equal(lockState("1.2.3.4").locked, true);
    // a different IP is not affected
    assert.equal(lockState("5.6.7.8").locked, false);
  });

  it("locks a username even when the attacker rotates IPs", () => {
    // 4x per-IP limit spread over many IPs, same username
    for (let i = 0; i < 20; i++) {
      const fail = registerFailure(`10.0.0.${i}`, "admin");
      assert.equal(fail.locked, i === 19);
    }
    // a brand-new IP is still locked for that username
    assert.equal(lockState("203.0.113.1", "admin").locked, true);
    // other usernames unaffected
    assert.equal(lockState("203.0.113.1", "other").locked, false);
  });

  it("clearFailures resets both the IP and the username counter", () => {
    for (let i = 0; i < 4; i++) registerFailure("9.9.9.9", "admin");
    clearFailures("9.9.9.9", "admin");
    assert.equal(lockState("9.9.9.9", "admin").locked, false);
    const fail = registerFailure("9.9.9.9", "admin");
    assert.equal(fail.locked, false);
  });
});
