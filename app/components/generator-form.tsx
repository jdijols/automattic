"use client";

// T4-U3 — the interactive generator form. A natural-language description plus an
// optional structured-criteria form (site type, color palette, typography) POST to
// /api/generate; on 200 the response is the theme .zip (downloaded straight to the
// browser), on any error the §5.2 structured JSON is mapped to legible field/issue
// messages via the pure describeError helper. No provider key is ever referenced
// here — the credential lives only in the server route.
import { useState } from "react";

import { describeError, type ErrorDisplay } from "../lib/error-messages";
import { type GenerateForm, SITE_TYPES, buildGenerateBody, emptyForm } from "../lib/generate-request";

type Phase = "idle" | "loading" | "done" | "error";

/** Pull `filename="…"` from a Content-Disposition header; fall back to theme.zip. */
function filenameFromDisposition(header: string | null): string {
  const match = header?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? "theme.zip";
}

const COLOR_FIELDS = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
] as const;

export default function GeneratorForm() {
  const [form, setForm] = useState<GenerateForm>(emptyForm);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ErrorDisplay | null>(null);
  const [doneName, setDoneName] = useState<string | null>(null);

  const setCriteria = (key: keyof GenerateForm["criteria"], value: string): void =>
    setForm((f) => ({ ...f, criteria: { ...f.criteria, [key]: value } }));

  const fieldError = (field: "description" | "criteria" | "form"): string | null =>
    error?.fieldErrors.find((e) => e.field === field)?.message ?? null;

  const descriptionErr = fieldError("description");
  const criteriaErr = fieldError("criteria");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.description.trim().length === 0 || phase === "loading") return;

    setPhase("loading");
    setError(null);
    setDoneName(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGenerateBody(form)),
      });

      if (res.ok && res.headers.get("content-type")?.includes("application/zip")) {
        const name = filenameFromDisposition(res.headers.get("content-disposition"));
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = name;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } finally {
          // Defer the revoke: revoking on the same synchronous tick can invalidate
          // the object URL before the browser's download navigation has read it
          // (a silent empty-download footgun in Firefox/WebKit). The finally also
          // guarantees the URL is always scheduled for release even if a DOM call
          // above throws — no leaked blob.
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
        setDoneName(name);
        setPhase("done");
        return;
      }

      // Any non-zip response is a structured error — map it without trusting shape.
      const body: unknown = await res.json().catch(() => null);
      setError(describeError(res.status, body));
      setPhase("error");
    } catch {
      // A network/transport failure never reaches the route's structured path.
      setError(describeError(0, null));
      setPhase("error");
    }
  }

  const canSubmit = form.description.trim().length > 0 && phase !== "loading";

  return (
    <form className="generator" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="description">Describe your site</label>
        <p className="hint">
          Natural language. e.g. <em>“A dark-mode blog for photographers with a large centered hero and sticky nav.”</em>
        </p>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={4000}
          placeholder="A clean editorial blog with a bold hero, a grid of recent posts, and a minimal footer…"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          aria-invalid={descriptionErr ? true : undefined}
          aria-describedby={descriptionErr ? "description-error" : undefined}
        />
        <div className="charcount">{form.description.trim().length}/4000</div>
        {descriptionErr && (
          <p className="error-text" id="description-error">
            {descriptionErr}
          </p>
        )}
      </div>

      <fieldset className="criteria">
        <legend>Criteria <span className="optional">(optional)</span></legend>

        <div className="field">
          <label htmlFor="siteType">Site type</label>
          <select
            id="siteType"
            value={form.criteria.siteType}
            onChange={(e) => setCriteria("siteType", e.target.value)}
          >
            <option value="">Let the model decide</option>
            {SITE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="group-label">Color palette</span>
          <div className="palette">
            {COLOR_FIELDS.map(({ key, label }) => {
              const value = form.criteria[key];
              const isHex = /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
              return (
                <div className="color" key={key}>
                  <label htmlFor={`color-${key}`}>{label}</label>
                  <div className="color-row">
                    <span className="swatch" style={isHex ? { background: value.trim() } : undefined} aria-hidden="true" />
                    <input
                      id={`color-${key}`}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="#3858E9"
                      value={value}
                      onChange={(e) => setCriteria(key, e.target.value)}
                      aria-invalid={criteriaErr ? true : undefined}
                      aria-describedby={criteriaErr ? "criteria-error" : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="group-label">Typography</span>
          <div className="fonts">
            <div className="font">
              <label htmlFor="headingFont">Heading font</label>
              <input
                id="headingFont"
                type="text"
                autoComplete="off"
                placeholder="Georgia, serif"
                value={form.criteria.headingFont}
                onChange={(e) => setCriteria("headingFont", e.target.value)}
                aria-invalid={criteriaErr ? true : undefined}
                aria-describedby={criteriaErr ? "criteria-error" : undefined}
              />
            </div>
            <div className="font">
              <label htmlFor="bodyFont">Body font</label>
              <input
                id="bodyFont"
                type="text"
                autoComplete="off"
                placeholder="Inter, system-ui, sans-serif"
                value={form.criteria.bodyFont}
                onChange={(e) => setCriteria("bodyFont", e.target.value)}
                aria-invalid={criteriaErr ? true : undefined}
                aria-describedby={criteriaErr ? "criteria-error" : undefined}
              />
            </div>
          </div>
        </div>

        {criteriaErr && (
          <p className="error-text" id="criteria-error">
            {criteriaErr}
          </p>
        )}
      </fieldset>

      <div className="actions">
        <button type="submit" className="generate" disabled={!canSubmit}>
          {phase === "loading" ? "Generating…" : "Generate theme"}
        </button>
      </div>

      <div className="status">
        {phase === "done" && doneName && (
          <p className="success" aria-live="polite">
            ✓ Your theme <strong>{doneName}</strong> downloaded. Install it in WordPress under{" "}
            <em>Appearance → Themes → Add New → Upload</em>.
          </p>
        )}

        {phase === "error" && error && (
          <div className="failure" role="alert">
            <p className="failure-title">{error.title}</p>
            {fieldError("form") && <p className="error-text">{fieldError("form")}</p>}
            {error.issues.length > 0 && (
              <ul className="issues">
                {error.issues.map((issue, i) => (
                  <li key={`${issue.code}-${i}`}>
                    <span className="issue-message">{issue.message}</span>
                    <span className="issue-meta">
                      <code>{issue.code}</code>
                      <span className="issue-layer">{issue.layer}</span>
                      {issue.path && <span className="issue-path">{issue.path}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
