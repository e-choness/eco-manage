// HTML to PDF (P5-01) through Gotenberg: headless Chromium in its own container, with JavaScript
// off and only its own temporary files allowed, so report text can't make it fetch anything.

export type HtmlToPdf = (html: string) => Promise<Buffer>;

export const gotenbergPdf =
  (baseUrl: string, timeoutMs = 60_000): HtmlToPdf =>
  async (html) => {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('preferCssPageSize', 'true');
    form.append('printBackground', 'true');
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`PDF rendering failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  };
