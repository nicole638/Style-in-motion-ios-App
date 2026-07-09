import { describe, expect, test } from 'bun:test';
import { detectBotBlock } from '../scrapingbee';

const headers = (h: Record<string, string>): Headers => new Headers(h);

describe('detectBotBlock', () => {
  describe('HTTP status codes', () => {
    test('flags 403 as bot-blocked', () => {
      const signal = detectBotBlock(403, headers({}), '<html></html>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('http_403');
    });

    test('flags 429 as bot-blocked', () => {
      const signal = detectBotBlock(429, headers({}), '<html></html>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('http_429');
    });

    test('does not flag 200 by status alone', () => {
      const realHtml =
        '<html><head><meta property="og:title" content="x"/>' +
        '<script type="application/ld+json">{}</script></head><body>' +
        'x'.repeat(20000) +
        '</body></html>';
      expect(detectBotBlock(200, headers({ server: 'nginx' }), realHtml).isBlocked).toBe(false);
    });
  });

  describe('server header', () => {
    test('flags lowercase cloudflare server', () => {
      const signal = detectBotBlock(200, headers({ server: 'cloudflare' }), '<html></html>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('cloudflare_server');
    });

    test('flags mixed-case Cloudflare server', () => {
      const signal = detectBotBlock(200, headers({ server: 'Cloudflare' }), '<html></html>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('cloudflare_server');
    });

    test('flags AkamaiNetStorage server', () => {
      const signal = detectBotBlock(
        200,
        headers({ server: 'AkamaiNetStorage' }),
        '<html></html>',
      );
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('akamai_server');
    });

    test('flags plain Akamai server', () => {
      const signal = detectBotBlock(200, headers({ server: 'Akamai' }), '<html></html>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('akamai_server');
    });
  });

  describe('challenge titles', () => {
    test('flags "Just a moment..."', () => {
      const signal = detectBotBlock(200, headers({}), '<title>Just a moment...</title>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('challenge_title');
    });

    test('flags "Attention Required!"', () => {
      const signal = detectBotBlock(
        200,
        headers({}),
        '<title>Attention Required! | Cloudflare</title>',
      );
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('challenge_title');
    });

    test('flags "Access Denied"', () => {
      const signal = detectBotBlock(200, headers({}), '<title>Access Denied</title>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('challenge_title');
    });

    test('flags "Pardon Our Interruption"', () => {
      const signal = detectBotBlock(
        200,
        headers({}),
        '<title>Pardon Our Interruption</title>',
      );
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('challenge_title');
    });

    test('flags exact "Cloudflare" title', () => {
      const signal = detectBotBlock(200, headers({}), '<title>Cloudflare</title>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('challenge_title');
    });
  });

  describe('sparse body', () => {
    test('flags small body with no og or json-ld', () => {
      const signal = detectBotBlock(200, headers({}), '<html><body>tiny</body></html>');
      expect(signal.isBlocked).toBe(true);
      expect(signal.reason).toBe('sparse_body');
    });

    test('does not flag small body with og tag', () => {
      const html =
        '<html><head><meta property="og:title" content="x"/></head><body>tiny</body></html>';
      expect(detectBotBlock(200, headers({}), html).isBlocked).toBe(false);
    });

    test('does not flag small body with json-ld script', () => {
      const html =
        '<html><head><script type="application/ld+json">{}</script></head><body>tiny</body></html>';
      expect(detectBotBlock(200, headers({}), html).isBlocked).toBe(false);
    });

    test('does not flag a large body without og or json-ld', () => {
      const html = '<html><body>' + 'x'.repeat(20000) + '</body></html>';
      expect(detectBotBlock(200, headers({}), html).isBlocked).toBe(false);
    });
  });

  describe('real product page', () => {
    test('does not flag a normal large product page', () => {
      const realProduct =
        '<html><head><meta property="og:title" content="..."/>' +
        '<script type="application/ld+json">{}</script></head><body>' +
        'x'.repeat(20000) +
        '</body></html>';
      expect(detectBotBlock(200, headers({ server: 'nginx' }), realProduct).isBlocked).toBe(
        false,
      );
    });
  });
});
