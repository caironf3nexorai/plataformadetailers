import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Read markdown content
const mdPath = path.join(rootDir, 'DOCUMENTO_MESTRE_PLATAFORMA_NUVEMWASH.md');
const mdContent = fs.readFileSync(mdPath, 'utf8');

let marked;
try {
  const markedModule = await import('marked');
  marked = markedModule.marked;
} catch (e) {
  console.error('marked could not be imported yet:', e);
  process.exit(1);
}

// Configure marked options
marked.setOptions({
  gfm: true,
  breaks: true,
});

const bodyHtml = marked.parse(mdContent);

const htmlTemplate = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>NuvemWash — Bíblia Mestre de Produto & Guia Operacional</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4;
      margin: 18mm 14mm 18mm 14mm;
      @bottom-right {
        content: counter(page);
      }
    }
    
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    
    body {
      font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10.5pt;
      line-height: 1.55;
      color: #1a1e24;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }

    /* Cover / Header styling */
    h1 {
      font-family: 'Archivo', sans-serif;
      font-size: 20pt;
      font-weight: 900;
      color: #0F1216;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 3px solid #FF8A3D;
      padding-bottom: 8px;
      margin-top: 0;
      margin-bottom: 14px;
      page-break-after: avoid;
    }

    h2 {
      font-family: 'Archivo', sans-serif;
      font-size: 14pt;
      font-weight: 800;
      color: #0F1216;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-left: 4px solid #FF8A3D;
      padding-left: 10px;
      margin-top: 26px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }

    h3 {
      font-family: 'Archivo', sans-serif;
      font-size: 11.5pt;
      font-weight: 700;
      color: #171B21;
      margin-top: 18px;
      margin-bottom: 8px;
      page-break-after: avoid;
    }

    h4 {
      font-size: 10.5pt;
      font-weight: 700;
      color: #2B323C;
      margin-top: 14px;
      margin-bottom: 6px;
    }

    p {
      margin: 0 0 10px 0;
    }

    strong {
      color: #0F1216;
      font-weight: 600;
    }

    blockquote {
      margin: 12px 0;
      padding: 10px 14px;
      background: #F8F9FA;
      border-left: 4px solid #FF8A3D;
      color: #333d47;
      font-size: 9.5pt;
      border-radius: 0 6px 6px 0;
      page-break-inside: avoid;
    }

    blockquote p {
      margin: 0;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 9pt;
      page-break-inside: avoid;
    }

    th, td {
      border: 1px solid #D1D5DB;
      padding: 6px 9px;
      text-align: left;
    }

    th {
      background: #0F1216;
      color: #ffffff;
      font-family: 'Archivo', sans-serif;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 8.5pt;
      letter-spacing: 0.04em;
    }

    tr:nth-child(even) {
      background: #F9FAFB;
    }

    /* Code & Pre */
    pre {
      background: #0F1216;
      color: #EDF0F3;
      padding: 10px 14px;
      border-radius: 6px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 8.5pt;
      line-height: 1.4;
      overflow-x: auto;
      border: 1px solid #2B323C;
      margin: 12px 0;
      page-break-inside: avoid;
      white-space: pre-wrap;
      word-break: break-word;
    }

    code {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 9pt;
      background: #F1F3F5;
      color: #E5761F;
      padding: 2px 4px;
      border-radius: 4px;
      border: 1px solid #E2E8F0;
    }

    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
      border: none;
    }

    /* Lists */
    ul, ol {
      margin: 0 0 12px 0;
      padding-left: 20px;
    }

    li {
      margin-bottom: 5px;
    }

    hr {
      border: none;
      border-top: 1px solid #E5E7EB;
      margin: 22px 0;
    }

    /* Badges & Accents */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 8.5pt;
      font-weight: 600;
      text-transform: uppercase;
    }

    /* Header & Footer banner on print */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0F1216;
      padding-bottom: 8px;
      margin-bottom: 20px;
      font-size: 8.5pt;
      color: #6B7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .doc-brand {
      font-family: 'Archivo', sans-serif;
      font-weight: 900;
      color: #0F1216;
      font-size: 11pt;
    }

    .doc-brand span {
      color: #FF8A3D;
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-brand">NUVEM<span>WASH</span></div>
    <div>Bíblia Mestre de Produto & Guia Operacional — Versão 5.0</div>
  </div>
  ${bodyHtml}
</body>
</html>`;

const tempHtmlPath = path.join(rootDir, 'temp_documento_mestre.html');
fs.writeFileSync(tempHtmlPath, htmlTemplate, 'utf8');

const outputPdfPath = path.join(rootDir, 'DOCUMENTO_MESTRE_PLATAFORMA_NUVEMWASH.pdf');

// Check chrome or msedge
let browserPath = '';
if (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')) {
  browserPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
} else if (fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')) {
  browserPath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
} else if (fs.existsSync('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')) {
  browserPath = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
}

if (!browserPath) {
  console.error('No headless browser found to print PDF');
  process.exit(1);
}

console.log(`Using browser: ${browserPath}`);
console.log(`Generating PDF from ${tempHtmlPath}...`);

const cmd = `"${browserPath}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${outputPdfPath}" "${tempHtmlPath}"`;
execSync(cmd, { stdio: 'inherit' });

console.log(`PDF generated successfully at: ${outputPdfPath}`);

// Cleanup temporary html
if (fs.existsSync(tempHtmlPath)) {
  fs.unlinkSync(tempHtmlPath);
}
