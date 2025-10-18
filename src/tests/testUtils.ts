/**
 * Test utilities for generating unique test data
 */

/**
 * Generates a unique email address for testing
 * @param prefix - Optional prefix for the email (default: 'test')
 * @param testNamespace - Optional test namespace to include
 * @returns Unique email address
 */
export function generateUniqueEmail(prefix: string = 'test', testNamespace?: string): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  const namespacePrefix = testNamespace ? `${testNamespace.substring(0, 8)}_` : '';
  return `${namespacePrefix}${prefix}_${timestamp}_${randomId}@example.com`;
}

/**
 * Generates a unique username for testing
 * @param prefix - Optional prefix for the username (default: 'u')
 * @returns Unique username
 */
export function generateUniqueUsername(prefix: string = 'u'): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  return `${prefix}${timestamp.toString().slice(-8)}${randomId}`;
}