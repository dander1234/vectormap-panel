// links.ts — shared helpers for the per-layer templated tooltip links.
//
// A TooltipLink has a `url` template that may contain ${field} placeholders
// (filled from a feature's own attributes) plus Grafana ${var} dashboard
// variables. These helpers fill + sanitize those templates and figure out which
// feature field a link targets, so both the click popup and the selection results
// table can render the same links (and turn a single-field link into a clickable
// cell value).

import { TooltipLink } from './types';

// Reject dangerous URL schemes; allow http(s), mailto, tel, and relative URLs.
export const sanitizeUrl = (url: string): string | null => {
  const u = url.trim();
  if (!u || /^\s*(javascript|data|vbscript):/i.test(u)) {
    return null;
  }
  return u;
};

// Build a link URL from its template: first substitute ${field} placeholders from
// the feature's own attributes (URL-encoded), then run Grafana's variable
// interpolation for any remaining ${var} (dashboard variables).
export const fillUrl = (tpl: string, props: Record<string, unknown>, replaceVariables: (s: string) => string): string => {
  const withFields = tpl.replace(/\$\{([\w.]+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(props, key) ? encodeURIComponent(String(props[key] ?? '')) : m
  );
  return replaceVariables(withFields);
};

// The unique ${...} placeholder names in a template. Used to decide which field a
// link "belongs to": a link with exactly one placeholder that matches a shown
// column can render that column's value as the link.
export const linkPlaceholderFields = (tpl: string): string[] => {
  const set = new Set<string>();
  const re = /\$\{([\w.]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl)) !== null) {
    set.add(m[1]);
  }
  return [...set];
};

// A link resolved for one feature: a safe href + display label, or null if the
// filled URL is empty/unsafe.
export interface ResolvedLink {
  href: string;
  label: string;
  openInNewTab: boolean;
}

export const resolveLink = (
  link: TooltipLink,
  props: Record<string, unknown>,
  replaceVariables: (s: string) => string
): ResolvedLink | null => {
  const href = sanitizeUrl(fillUrl(link.url, props, replaceVariables));
  if (!href) {
    return null;
  }
  return { href, label: link.label || href, openInNewTab: link.openInNewTab };
};
