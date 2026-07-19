export type FindingType = 'secret' | 'pii' | 'injection';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  type: FindingType;
  label: string;
  severity: Severity;
  start: number;
  end: number;
  /** Redacted preview of the match — never the raw secret. */
  preview: string;
}

interface Pattern {
  type: FindingType;
  label: string;
  severity: Severity;
  re: RegExp;
  /** Extra validation (e.g. Luhn for card numbers). */
  validate?: (match: string) => boolean;
}

const PATTERNS: Pattern[] = [
  // --- secrets (critical) ---
  { type: 'secret', label: 'openai-key', severity: 'critical', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'secret', label: 'anthropic-key', severity: 'critical', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'secret', label: 'aws-access-key', severity: 'critical', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'secret', label: 'github-token', severity: 'critical', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { type: 'secret', label: 'slack-token', severity: 'critical', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'secret', label: 'google-api-key', severity: 'critical', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'secret', label: 'private-key', severity: 'critical', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g },
  { type: 'secret', label: 'bearer-token', severity: 'high', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
  // --- PII (high) ---
  { type: 'pii', label: 'email', severity: 'high', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: 'pii', label: 'ssn', severity: 'high', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    type: 'pii',
    label: 'credit-card',
    severity: 'high',
    re: /\b(?:\d[ -]?){13,16}\b/g,
    validate: (m) => luhn(m.replace(/[ -]/g, '')),
  },
  { type: 'pii', label: 'ipv4', severity: 'low', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  // --- prompt injection (medium) ---
  { type: 'injection', label: 'ignore-instructions', severity: 'medium', re: /\bignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?)/gi },
  { type: 'injection', label: 'disregard', severity: 'medium', re: /\bdisregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)\b/gi },
  { type: 'injection', label: 'reveal-system-prompt', severity: 'medium', re: /\b(?:reveal|show|print|repeat)\s+(?:your\s+|the\s+)?(?:system\s+prompt|instructions|rules)\b/gi },
  { type: 'injection', label: 'role-override', severity: 'medium', re: /\byou\s+are\s+now\b|\bpretend\s+to\s+be\b|\bact\s+as\s+if\b/gi },
];

/** Scan text for secrets, PII, and prompt-injection markers. Deterministic. */
export function scan(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const match = m[0];
      if (p.validate && !p.validate(match)) continue;
      findings.push({
        type: p.type,
        label: p.label,
        severity: p.severity,
        start: m.index,
        end: m.index + match.length,
        preview: preview(match),
      });
      if (m.index === p.re.lastIndex) p.re.lastIndex++; // guard zero-width
    }
  }
  return findings.sort((a, b) => a.start - b.start);
}

/** Replace findings with typed placeholders. Never emits the raw match. */
export function redact(text: string, findings: Finding[]): string {
  const sorted = [...findings].sort((a, b) => b.start - a.start);
  let out = text;
  for (const f of sorted) {
    out = out.slice(0, f.start) + `[REDACTED:${f.label}]` + out.slice(f.end);
  }
  return out;
}

export function highestSeverity(findings: Finding[]): Severity | null {
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  for (const s of order) if (findings.some((f) => f.severity === s)) return s;
  return null;
}

function preview(match: string): string {
  if (match.length <= 8) return '*'.repeat(match.length);
  return `${match.slice(0, 3)}…${match.slice(-2)}`;
}

function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}
