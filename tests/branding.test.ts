/**
 * Lane D / T15 — branding sanitization: a malicious branding payload can NOT inject script and can
 * NOT remove or alter the crisis/not-medical-advice footer. Pure unit tests over lib/branding.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeBranding,
  sanitizeColor,
  sanitizeLogoUrl,
  sanitizeDisplayName,
  themeStyle,
  assertFooterPreserved,
  mergeBranding,
  DEFAULT_BRAND_COLOR,
} from '@/lib/branding';

describe('sanitizeColor — only strict hex passes; injection attempts fall back to default', () => {
  it('accepts valid hex', () => {
    expect(sanitizeColor('#0f766e')).toBe('#0f766e');
    expect(sanitizeColor('#FFF')).toBe('#FFF');
    expect(sanitizeColor('  #112233aa ')).toBe('#112233aa');
  });

  it('rejects CSS-injection / style-breakout attempts → default', () => {
    const attacks = [
      'red;}</style><script>alert(1)</script>',
      'url(javascript:alert(1))',
      'expression(alert(1))',
      '#fff;background:url(http://evil)',
      'rgb(0,0,0)', // function form not allowed
      'teal',
      '',
      'javascript:alert(1)',
    ];
    for (const a of attacks) expect(sanitizeColor(a)).toBe(DEFAULT_BRAND_COLOR);
  });
});

describe('sanitizeLogoUrl — only http(s) + data:image(raster); script/SVG/other schemes dropped', () => {
  it('accepts http(s) and raster data URIs', () => {
    expect(sanitizeLogoUrl('https://cdn.example.org/logo.png')).toBe('https://cdn.example.org/logo.png');
    expect(sanitizeLogoUrl('http://example.org/a.jpg')).toBe('http://example.org/a.jpg');
    expect(sanitizeLogoUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('drops javascript:, data:text/html, data:image/svg+xml (script vector), and junk → null', () => {
    const attacks = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:image/svg+xml,<svg onload=alert(1)>', // SVG can execute — excluded by design
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'not a url',
      '',
    ];
    for (const a of attacks) expect(sanitizeLogoUrl(a)).toBeNull();
  });
});

describe('sanitizeDisplayName — angle brackets stripped, length-bounded', () => {
  it('strips < > so it cannot open a tag', () => {
    expect(sanitizeDisplayName('<img src=x onerror=alert(1)>Clinic')).toBe('img src=x onerror=alert(1)Clinic');
    expect(sanitizeDisplayName('Riverside CHC')).toBe('Riverside CHC');
    expect(sanitizeDisplayName('')).toBeNull();
  });
});

describe('sanitizeBranding — a fully malicious payload yields a safe theme', () => {
  it('drops every attack vector and keeps the safe defaults', () => {
    const theme = sanitizeBranding({
      brandColor: '#000;}</style><script>steal()</script>',
      brandLogoUrl: 'javascript:fetch("/api/steal")',
      displayName: '<script>x</script>Evil Clinic',
    });
    expect(theme.brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(theme.brandLogoUrl).toBeNull();
    expect(theme.displayName).toBe('scriptx/scriptEvil Clinic');

    // themeStyle emits a typed style object with a validated hex value — no raw HTML/CSS string.
    const style = themeStyle(theme);
    expect(style['--brand']).toBe(DEFAULT_BRAND_COLOR);
    expect(JSON.stringify(style)).not.toContain('<script>');
    expect(JSON.stringify(style)).not.toContain('javascript:');
  });
});

describe('the footer cannot be removed by branding', () => {
  it('assertFooterPreserved detects a present footer and a (hypothetically) stripped one', () => {
    const withFooter = '<main>...</main><footer data-testid="safety-footer">Not medical advice…</footer>';
    const without = '<main>...</main>';
    expect(assertFooterPreserved(withFooter)).toBe(true);
    expect(assertFooterPreserved(without)).toBe(false);
  });

  it('no branding field targets the footer — sanitizeBranding output keys are color/logo/name only', () => {
    const theme = sanitizeBranding({ brandColor: '#123456', brandLogoUrl: null, displayName: 'X' });
    expect(Object.keys(theme).sort()).toEqual(['brandColor', 'brandLogoUrl', 'displayName']);
  });
});

describe('mergeBranding — agent overrides tenant; both sanitized', () => {
  it('agent color/logo win when present; tenant fills gaps', () => {
    const resolved = mergeBranding(
      { name: 'Riverside CHC', brandColor: '#0f766e', brandLogoUrl: 'https://t/logo.png' },
      {
        name: 'Spanish Intake',
        slug: 'spanish-intake',
        status: 'PUBLISHED',
        brandColor: '#1d4ed8',
        brandLogoUrl: null,
      },
    );
    expect(resolved.theme.brandColor).toBe('#1d4ed8'); // agent wins
    expect(resolved.theme.brandLogoUrl).toBe('https://t/logo.png'); // tenant fills the gap
    expect(resolved.theme.displayName).toBe('Spanish Intake');
    expect(resolved.published).toBe(true);
  });

  it('a malicious agent color cannot poison the merged theme', () => {
    const resolved = mergeBranding(
      { name: 'T', brandColor: '#0f766e', brandLogoUrl: null },
      {
        name: 'A',
        slug: 'a',
        status: 'DRAFT',
        brandColor: 'red;}</style><script>x</script>',
        brandLogoUrl: 'javascript:x',
      },
    );
    expect(resolved.theme.brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(resolved.theme.brandLogoUrl).toBeNull();
    expect(resolved.published).toBe(false);
  });
});
