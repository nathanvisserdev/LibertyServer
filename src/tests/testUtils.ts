/**
 * Test utilities for generating unique test data
 */

import crypto from "crypto";

/**
 * Generates a unique test namespace using UUID
 * @param testFileName - The test file name to include in namespace
 * @returns A unique namespace string
 */
export function generateTestNamespace(testFileName: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${testFileName}_${uuid}`;
}

/**
 * Generates a unique email address for testing
 * @param prefix - Optional prefix for the email (default: 'test')
 * @param testNamespace - Optional test namespace to include
 * @returns Unique email address
 */
export function generateUniqueEmail(prefix: string = 'test', testNamespace?: string): string {
  const randomId = crypto.randomUUID();
  const namespacePrefix = testNamespace ? `${testNamespace.substring(0, 8)}_` : '';
  return `${namespacePrefix}${prefix}_${randomId}@example.com`;
}

/**
 * Generates a unique username for testing
 * @param prefix - Optional prefix for the username (default: 'u')
 * @returns Unique username
 */
/**
 * Generates a unique username for testing
 * @param testNamespace - Optional test namespace to include
 * @returns A unique username string with UUID
 */
export function generateUniqueUsername(testNamespace?: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return testNamespace ? `${testNamespace}_${uuid}` : uuid;
}

/**
 * Generates a unique string for testing (useful for group names, etc.)
 * @param prefix - Prefix for the unique string (e.g. "Test Group")
 * @param testNamespace - Optional test namespace to include
 * @returns A unique string with UUID suffix
 */
export function generateUniqueString(prefix: string, testNamespace?: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  const suffix = testNamespace ? `${testNamespace}_${uuid}` : uuid;
  return `${prefix} ${suffix}`;
}

/**
 * Generates a unique username with prefix for testing
 * @param prefix - Prefix for the username (e.g. "johndoe")
 * @returns A unique username string with prefix and UUID (no spaces, lowercase)
 */
export function generateUniqueUsernameWithPrefix(prefix: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "").toLowerCase();
  return `${prefix}_${uuid}`;
}

/**
 * Generates a unique number-like string for testing
 * @returns A unique numeric-like string based on UUID
 */
export function generateUniqueNumber(): string {
  // Convert UUID to a number-like string by taking first 10 characters
  return crypto.randomUUID().replace(/-/g, "").substring(0, 10);
}