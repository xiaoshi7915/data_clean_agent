import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
} from "./credentialCrypto";

describe("credentialCrypto", () => {
  const originalSecret = process.env.APP_SECRET;

  beforeEach(() => {
    process.env.APP_SECRET = "test-secret-for-crypto-unit-tests";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.APP_SECRET;
    } else {
      process.env.APP_SECRET = originalSecret;
    }
  });

  it("encrypts and decrypts round-trip", () => {
    const plain = "my-db-password-123";
    const encrypted = encryptCredential(plain);
    expect(isEncryptedCredential(encrypted)).toBe(true);
    expect(decryptCredential(encrypted)).toBe(plain);
  });

  it("treats legacy plaintext as-is when decrypt fails prefix", () => {
    expect(decryptCredential("plain-password")).toBe("plain-password");
    expect(isEncryptedCredential("plain-password")).toBe(false);
  });
});
