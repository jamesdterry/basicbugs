import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  notificationEmail,
  magicLinkEmail,
  passwordResetEmail,
  inviteEmail,
} from '../server/services/email.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });

  it('coerces null/undefined to empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('notificationEmail', () => {
  it('HTML-escapes user-controlled body so script tags do not render', () => {
    const tmpl = notificationEmail({
      subject: 'Updated',
      body: 'Alice commented:\n<script>alert(1)</script>',
      url: 'https://example.test/issue/1',
    });
    expect(tmpl.html).not.toContain('<script>');
    expect(tmpl.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Plain-text version is left as-is so legitimate angle-brackets render in mail clients.
    expect(tmpl.text).toContain('<script>alert(1)</script>');
  });

  it('renders newlines in the body as <br> for HTML readability', () => {
    const tmpl = notificationEmail({
      subject: 'X',
      body: 'line1\nline2',
      url: null,
    });
    expect(tmpl.html).toBe('<p>line1<br>line2</p>');
  });

  it('escapes a URL containing HTML metacharacters', () => {
    const tmpl = notificationEmail({
      subject: 'X',
      body: 'hi',
      url: 'https://example.test/?q="><img src=x>',
    });
    expect(tmpl.html).not.toMatch(/href="[^"]*"><img/);
    expect(tmpl.html).toContain('&quot;&gt;&lt;img src=x&gt;');
  });
});

describe('magicLinkEmail / passwordResetEmail / inviteEmail', () => {
  it('escapes the URL in HTML output (defense in depth)', () => {
    const url = 'https://example.test/?x=<script>';
    expect(magicLinkEmail({ url }).html).toContain('&lt;script&gt;');
    expect(passwordResetEmail({ url }).html).toContain('&lt;script&gt;');
    expect(inviteEmail({ url, projectName: 'P' }).html).toContain('&lt;script&gt;');
  });

  it('inviteEmail escapes a malicious project name in HTML', () => {
    const tmpl = inviteEmail({
      url: 'https://example.test/i/abc',
      projectName: '"><script>alert(1)</script>',
    });
    expect(tmpl.html).not.toContain('<script>');
    expect(tmpl.html).toContain('&lt;script&gt;');
  });
});
