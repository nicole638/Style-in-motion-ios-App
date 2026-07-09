import { normalizeUrlInput } from '../normalizeUrlInput';

describe('normalizeUrlInput', () => {
  test('returns clean URL from plain URL input', () => {
    expect(normalizeUrlInput('https://www.zara.com/us/en/abc')).toBe('https://www.zara.com/us/en/abc');
  });

  test('strips prefix text before URL', () => {
    expect(normalizeUrlInput('Saw this on Old Navy: https://oldnavy.gap.com/abc')).toBe('https://oldnavy.gap.com/abc');
  });

  test('strips "Check out" prefix', () => {
    expect(normalizeUrlInput('Check out https://www.nordstrom.com/s/foo/123')).toBe('https://www.nordstrom.com/s/foo/123');
  });

  test('handles HTTP (non-HTTPS) URLs', () => {
    expect(normalizeUrlInput('http://example.com/page')).toBe('http://example.com/page');
  });

  test('lowercases protocol when mixed case', () => {
    expect(normalizeUrlInput('HTTPS://www.macys.com/shop')).toBe('https://www.macys.com/shop');
  });

  test('handles leading whitespace', () => {
    expect(normalizeUrlInput('   https://www.target.com/p/abc')).toBe('https://www.target.com/p/abc');
  });

  test('handles trailing whitespace', () => {
    expect(normalizeUrlInput('https://www.target.com/p/abc   ')).toBe('https://www.target.com/p/abc');
  });

  test('returns null for empty string', () => {
    expect(normalizeUrlInput('')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(normalizeUrlInput(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(normalizeUrlInput(undefined)).toBeNull();
  });

  test('returns null for text without URL', () => {
    expect(normalizeUrlInput('just some random text')).toBeNull();
  });

  test('returns null for invalid URL after prefix strip', () => {
    expect(normalizeUrlInput('check this: https://')).toBeNull();
  });

  test('picks the first URL when multiple are present', () => {
    expect(normalizeUrlInput('https://first.com/a also https://second.com/b')).toBe('https://first.com/a also https://second.com/b');
  });

  test('handles URL with query params and fragments', () => {
    expect(normalizeUrlInput('https://example.com/page?q=test&lang=en#section')).toBe('https://example.com/page?q=test&lang=en#section');
  });

  test('handles Instagram share text prefix', () => {
    expect(normalizeUrlInput('Found on IG https://www.instagram.com/p/abc123/')).toBe('https://www.instagram.com/p/abc123/');
  });
});
