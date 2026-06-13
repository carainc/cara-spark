/**
 * Lane D / T15 — branding SANITIZATION. A tenant/agent supplies a brand color + logo. This module is
 * the trust boundary: a malicious branding payload can NOT inject script and can NOT remove or alter
 * the crisis/not-medical-advice footer.
 *
 * Defenses:
 *  - brandColor must match a strict hex pattern (#rgb / #rrggbb). Anything else (e.g.
 *    `red;}</style><script>…`, `expression(...)`, `url(javascript:...)`) is dropped → safe default.
 *  - brandLogoUrl must be http(s) or a data:image URL. `javascript:`, `data:text/html`, and other
 *    schemes are dropped → no logo (never an injection vector).
 *  - The footer is rendered at the LAYOUT level (components/SafetyFooter via app/layout). Branding has
 *    no field that can target it; `assertFooterPreserved` is a belt-and-suspenders guard for any code
 *    that builds an HTML string from a theme.
 *
 * Pure: no DB, no React. Unit-tested directly.
 */

/** The safe defaults (mirror db/schema.prisma Tenant.brandColor default `#0f766e`). */
export const DEFAULT_BRAND_COLOR = '#0f766e';

export interface BrandingInput {
  brandColor?: string | null;
  brandLogoUrl?: string | null;
  /** Optional display name shown on the branded page (sanitized to text, never HTML). */
  displayName?: string | null;
}

export interface Theme {
  brandColor: string;
  brandLogoUrl: string | null;
  displayName: string | null;
}

/** Strict CSS hex color: #rgb, #rgba, #rrggbb, #rrggbbaa. No functions, no other tokens. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function sanitizeColor(input: string | null | undefined): string {
  if (typeof input !== 'string') return DEFAULT_BRAND_COLOR;
  const trimmed = input.trim();
  return HEX_COLOR.test(trimmed) ? trimmed : DEFAULT_BRAND_COLOR;
}

/**
 * Allow only http(s) URLs and inline data:image URLs for the logo. Everything else → null.
 * `javascript:`, `vbscript:`, `data:text/html`, and `file:` are rejected. URL is length-bounded.
 */
export function sanitizeLogoUrl(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;

  // data:image/* (raster + svg+xml excluded — SVG can carry script). Base64 or url-encoded only.
  if (/^data:image\/(png|jpe?g|gif|webp|avif)(;base64)?,/i.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    return null;
  } catch {
    return null;
  }
}

/** Strip anything that could break out of a text node. We never render this as HTML, but be strict. */
export function sanitizeDisplayName(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[<>]/g, '').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : null;
}

/** Project an untrusted branding payload onto a safe Theme. The single entry point pages must use. */
export function sanitizeBranding(input: BrandingInput): Theme {
  return {
    brandColor: sanitizeColor(input.brandColor),
    brandLogoUrl: sanitizeLogoUrl(input.brandLogoUrl),
    displayName: sanitizeDisplayName(input.displayName),
  };
}

/**
 * CSS custom properties for the theme. Returned as a typed style object (React inline style), NOT a
 * raw string — so there is no `dangerouslySetInnerHTML` path and the value is already hex-validated.
 */
export function themeStyle(theme: Theme): Record<string, string> {
  return { '--brand': theme.brandColor };
}

/**
 * Belt-and-suspenders: assert a rendered HTML string still contains the footer testid. Used by tests
 * (and any future HTML-string builder) to prove branding can never drop the mandatory footer.
 */
export function assertFooterPreserved(html: string): boolean {
  return html.includes('data-testid="safety-footer"');
}
