// T4-U3 — the input UI. A server component that renders the Automattic wordmark, the
// visible homage disclaimer (ADR-0002 CP-24), and the interactive generator form.
// No provider key is ever referenced on this client surface — the credential is read
// server-side only, inside the /api/generate route.
import GeneratorForm from "./components/generator-form";

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <p className="eyebrow">WordPress Block Theme Generator</p>
        <h1 className="wordmark">Automattic</h1>
        <p className="lede">
          Describe a site in plain language, add an optional palette and typography, and download a complete, valid
          WordPress Full Site Editing block theme — packaged as an installable <code>.zip</code>. No Custom HTML block,
          ever — only native WordPress block markup.
        </p>
        <p className="disclaimer">
          <strong>Homage, not affiliation.</strong> This is a portfolio piece by Jason Dijols named in tribute to{" "}
          <a href="https://automattic.com" target="_blank" rel="noreferrer">
            Automattic
          </a>{" "}
          — the makers of WordPress.com and the evaluating Partner. It is <em>not</em> an Automattic product or an
          official Automattic project.
        </p>
      </header>

      <GeneratorForm />

      <footer className="colophon">
        <p>
          Generated themes use only native block syntax (<code>wp:paragraph</code>, <code>wp:cover</code>,{" "}
          <code>wp:query</code>, …) and a <code>theme.json</code> — validated, byte-reproducible, and install-verified.
        </p>
      </footer>
    </main>
  );
}
