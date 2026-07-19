import { defineMiddleware, recordDecision, type ChatRequest, type Middleware, type SaveRequest } from '@ace/core';
import { scan, redact, highestSeverity, type Finding } from './scan.js';

export type SecurityMode = 'annotate' | 'redact' | 'block';

export interface SecurityOptions {
  mode?: SecurityMode;
  /** Severities that trigger block/redact. Default: secret+pii critical/high. */
  blockOn?: Array<'critical' | 'high' | 'medium' | 'low'>;
}

/**
 * Pre-scan save + chat inputs for secrets / PII / injection.
 * - annotate: record findings on the trace, pass through.
 * - redact:   replace matches with typed placeholders in the content.
 * - block:    throw if any finding meets blockOn severity.
 * Findings previews are redacted — the raw secret never reaches the trace.
 */
export function securityMiddleware(opts: SecurityOptions = {}): Middleware {
  const mode = opts.mode ?? 'redact';
  const blockOn = new Set(opts.blockOn ?? ['critical', 'high']);

  return defineMiddleware({
    name: 'security',
    appliesTo: ['save', 'chat'],
    before: (ctx) => {
      const op = ctx.op;
      if (op.kind === 'save') {
        const input = op.input as SaveRequest;
        const text = input.source.text ?? '';
        const findings = scan(text);
        act(ctx, findings, mode, blockOn, () => {
          if (mode === 'redact') {
            // Mutate is not allowed on the frozen op; expose redacted text via meta
            // for the store middleware / downstream to prefer.
            ctx.meta.redactedText = redact(text, findings);
          }
        });
      } else if (op.kind === 'chat') {
        const input = op.input as ChatRequest;
        const messages =
          (ctx.meta.normalizedMessages as ChatRequest['messages'] | undefined) ?? input.messages;
        const joined = messages.map((m) => m.content).join('\n');
        const findings = scan(joined);
        act(ctx, findings, mode, blockOn, () => {
          if (mode === 'redact') {
            ctx.meta.normalizedMessages = messages.map((m) => ({
              role: m.role,
              content: redact(m.content, scan(m.content)),
            }));
          }
        });
      }
    },
  });
}

function act(
  ctx: Parameters<NonNullable<Middleware['before']>>[0],
  findings: Finding[],
  mode: SecurityMode,
  blockOn: Set<string>,
  onRedact: () => void,
): void {
  const worst = highestSeverity(findings);
  recordDecision(ctx, 'security', {
    mode,
    count: findings.length,
    highest: worst,
    findings: findings.map((f) => ({ type: f.type, label: f.label, severity: f.severity, preview: f.preview })),
  });
  if (!findings.length) return;
  if (mode === 'block' && findings.some((f) => blockOn.has(f.severity))) {
    const labels = [...new Set(findings.filter((f) => blockOn.has(f.severity)).map((f) => f.label))].join(', ');
    throw new Error(`security: blocked — ${labels}`);
  }
  if (mode === 'redact') onRedact();
}
