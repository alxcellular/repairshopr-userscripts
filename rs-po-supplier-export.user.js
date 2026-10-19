// ==UserScript==
// @name         RepairShopr PO → Supplier Import File
// @namespace    https://alxcellular.repairshopr.com/
// @version      1.3.1
// @description  Adds one button to a RepairShopr Purchase Order that downloads the cart-import file in the format of the PO's vendor (Mobile Sentrix, WGP, Injured Gadgets, Phone LCD Parts), opens the supplier's quick-order page and, for Mobile Sentrix, adds the items to the cart.
// @homepageURL  https://github.com/alxcellular/repairshopr-userscripts
// @updateURL    https://raw.githubusercontent.com/alxcellular/repairshopr-userscripts/main/rs-po-supplier-export.user.js
// @downloadURL  https://raw.githubusercontent.com/alxcellular/repairshopr-userscripts/main/rs-po-supplier-export.user.js
// @match        https://alxcellular.repairshopr.com/purchase_orders/*
// @match        https://www.mobilesentrix.com/quickorder/index/view*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Supplier formats. `match` is tested against the vendor name on the PO.
   * To add a supplier, add an entry here.
   *   type        'xlsx' or 'csv'
   *   header      column titles, exactly as the supplier's sample file has them
   *   numericSku  xlsx only: write all-digit SKUs as numbers (Mobile Sentrix sample does)
   *   skuCheck    optional: SKUs that don't match are listed for review before download
   *   orderUrl    the supplier's quick-order page, opened in a new tab with the download
   *   autoImport  optional: runs on orderUrl and puts the file into the supplier's cart
   *               (the page must also be listed as an @match in the header)
   * ------------------------------------------------------------------ */
  const SUPPLIERS = [
    {
      name: 'Mobile Sentrix', match: /^mobile\s*sentrix$/i,
      type: 'xlsx', sheet: 'Worksheet', header: ['SKU', 'Qty'], boldHeader: true, numericSku: true,
      skuCheck: /^\d{12}$/, skuHint: '12-digit MobileSentrix item number',
      orderUrl: 'https://www.mobilesentrix.com/quickorder/index/view',
      autoImport: mobileSentrixImport,
    },
    {
      name: 'WGP', match: /^wgp$/i,
      type: 'xlsx', sheet: 'Sheet1', header: ['sku', 'quantity'],
      skuCheck: /^WG\d+$/i, skuHint: 'WGP number like WG53247',
      orderUrl: 'https://wgp.com/quick-order',
    },
    {
      name: 'Injured Gadgets', match: /^injured\s*gadgets$/i, type: 'csv', header: ['sku', 'qty'],
      orderUrl: 'https://www.injuredgadgets.com/expressorder/index/view',
    },
    {
      name: 'Phone LCD Parts', match: /^phone\s*lcd\s*parts$/i, type: 'csv', header: ['sku', 'qty'],
      orderUrl: 'https://www.phonelcdparts.com/quickorder/index/view/',
    },
  ];
  const SKU_COLUMN = 'Vendor SKU'; // per-vendor SKU in RS; UPC is ignored on purpose
  const QTY_COLUMN = 'Quantity';
  // Hand-off from the PO page to the supplier tab (Tampermonkey storage is shared across sites)
  const JOB_KEY = 'pendingImport';
  const JOB_MAX_AGE = 10 * 60 * 1000; // older jobs are dropped, so opening the page later never re-imports

  /* ------------------------------------------------------------------ *
   * Small UI helpers (no alert/confirm dialogs)
   * ------------------------------------------------------------------ */
  const css = `
    #rspo-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif}
    #rspo-box{background:#fff;color:#222;border-radius:8px;padding:20px 22px;width:min(560px,92vw);max-height:85vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)}
    #rspo-box h3{margin:0 0 10px;font-size:17px}
    #rspo-box p{margin:0 0 10px;line-height:1.45}
    #rspo-box ul{margin:0 0 14px;padding-left:20px;line-height:1.45}
    #rspo-box code{background:#f3f3f3;padding:0 4px;border-radius:3px}
    #rspo-box .btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
    #rspo-box button{border:0;border-radius:5px;padding:7px 12px;cursor:pointer;font-size:13px}
    #rspo-box .pri{background:#2ca01c;color:#fff}#rspo-box .sec{background:#e6e6e6}#rspo-box .warn{background:#f0ad4e;color:#fff}
    #rspo-btn{margin-right:4px}
    #rspo-banner{position:fixed;top:100px;right:12px;z-index:99999;width:min(400px,92vw);padding:12px 32px 12px 14px;border-radius:8px;color:#fff;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)}
    #rspo-banner.busy{background:#3b5b7a}#rspo-banner.ok{background:#2ca01c}#rspo-banner.warn{background:#c77700}#rspo-banner.err{background:#b00020}
    #rspo-banner ul{margin:6px 0;padding-left:18px}#rspo-banner code{background:rgba(255,255,255,.2);padding:0 4px;border-radius:3px}
    #rspo-banner a.dl{color:#fff;font-weight:600;text-decoration:underline}
    #rspo-banner .x{position:absolute;top:6px;right:10px;cursor:pointer;font-size:18px;line-height:1}`;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  function modal(title, bodyHtml, buttons) {
    closeModal();
    const ov = document.createElement('div');
    ov.id = 'rspo-overlay';
    ov.innerHTML = `<div id="rspo-box"><h3></h3><div class="body"></div><div class="btns"></div></div>`;
    ov.querySelector('h3').textContent = title;
    ov.querySelector('.body').innerHTML = bodyHtml;
    const bar = ov.querySelector('.btns');
    (buttons || [{ label: 'Close', onClick: closeModal }]).forEach((b) => {
      const el = document.createElement('button');
      el.textContent = b.label;
      el.className = b.cls || 'sec';
      el.onclick = b.onClick;
      bar.appendChild(el);
    });
    document.body.appendChild(ov);
    return ov;
  }
  const closeModal = () => document.getElementById('rspo-overlay')?.remove();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function banner(html, kind) {
    let el = document.getElementById('rspo-banner');
    if (!el) {
      el = Object.assign(document.createElement('div'), { id: 'rspo-banner' });
      document.body.appendChild(el);
    }
    el.className = kind;
    el.innerHTML = `<span class="x" title="Close">×</span>${html}`;
    el.querySelector('.x').onclick = () => el.remove();
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms, failMsg) {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(failMsg);
      await sleep(250);
    }
  }

  /* ------------------------------------------------------------------ *
   * On a supplier's quick-order page: finish the import started on the PO
   * ------------------------------------------------------------------ */
  if (location.hostname !== 'alxcellular.repairshopr.com') {
    const s = SUPPLIERS.find((x) => x.autoImport && new URL(x.orderUrl).hostname === location.hostname);
    if (s) runPendingImport(s);
    return;
  }

  async function runPendingImport(s) {
    const job = GM_getValue(JOB_KEY);
    if (!job || job.supplier !== s.name) return;
    GM_deleteValue(JOB_KEY); // one shot: reloading the page must not import twice
    if (Date.now() - job.at > JOB_MAX_AGE) return;
    banner(`Adding ${esc(job.poNumber)} to your ${esc(s.name)} cart (${job.skus} SKUs, ${job.units} units)…`, 'busy');
    const file = new File([Uint8Array.from(atob(job.data), (c) => c.charCodeAt(0))], job.filename, { type: job.mime });
    try {
      const r = await s.autoImport(file, job);
      banner(r.html, r.ok ? 'ok' : 'warn');
    } catch (e) {
      // The file is only downloaded when the automatic import fails
      banner(`Couldn't add ${esc(job.poNumber)} to the cart automatically: ${esc(e.message)}.<br>` +
        `<a class="dl" href="${URL.createObjectURL(file)}" download="${esc(job.filename)}">Download ${esc(job.filename)}</a> ` +
        `and import it with the upload button.`, 'err');
    }
  }

  // Mobile Sentrix quick order: Dropzone upload → "Import products" → rows/issues → "Add to cart"
  async function mobileSentrixImport(file, job) {
    const input = await waitFor(() => document.querySelector('input.dz-hidden-input'), 15000, 'the upload box was not found');
    const importBtn = await waitFor(() => document.getElementById('import-products-btn'), 5000, 'the Import button was not found');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files; // DOM-level hand-off works whatever world Tampermonkey runs the script in
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => !importBtn.disabled, 5000, 'the upload box did not accept the file');
    importBtn.click();

    const rows = () => [...document.querySelectorAll('#new-list-row li.quick-product')]
      .filter((li) => li.offsetHeight && /SKU:/.test(li.textContent));
    const issues = () => [...document.querySelectorAll('#import-issues ul.error-list li')]
      .filter((li) => li.offsetHeight).map((li) => li.textContent.replace(/\s+/g, ' ').replace(/^\s*\*\s*/, '').trim());
    await waitFor(() => rows().length || issues().length, 30000, 'Mobile Sentrix did not finish reading the file');
    await sleep(800); // both lists render from the same response; give the second one a moment

    const n = rows().length, problems = issues();
    if (problems.length) {
      return {
        ok: false,
        html: `<b>${esc(job.poNumber)}</b>: ${n} item(s) imported, but Mobile Sentrix reported ${problems.length} issue(s):` +
          `<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>Nothing was added yet. Fix or remove those lines below, then click <b>Add to cart</b>.`,
      };
    }
    document.getElementById('quickorder-cart').click();
    await waitFor(() => rows().length === 0, 20000, 'Add to cart did not finish'); // the table empties once added
    const mismatch = n !== job.skus ? ` (the PO had ${job.skus} SKUs — check the cart)` : '';
    return { ok: true, html: `✓ Added <b>${esc(job.poNumber)}</b> to your cart: ${n} items, ${job.units} units${mismatch}. Review the cart before checking out.` };
  }

  /* ------------------------------------------------------------------ *
   * On RepairShopr: the PO detail page
   * ------------------------------------------------------------------ */
  const m = location.pathname.match(/^\/purchase_orders\/(\d+)\/?$/);
  if (!m) return;
  const PO_ID = m[1];

  /* ------------------------------------------------------------------ *
   * Read the PO: vendor from the page, line items from RS's own CSV export
   * ------------------------------------------------------------------ */
  function vendorName() {
    const el = document.getElementById(`best_in_place_purchase_order_${PO_ID}_vendor_id`)
      || document.querySelector('a[href^="/vendors/"]');
    return (el?.textContent || '').trim();
  }
  const supplierFor = (vendor) => SUPPLIERS.find((s) => s.match.test(vendor.replace(/\s+/g, ' ')));

  function parseCsv(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = '';
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const [head, ...body] = rows.filter((r) => r.some((v) => v.trim()));
    return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
  }

  async function readPo(supplier) {
    const res = await fetch(`/purchase_orders/${PO_ID}.csv`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`RepairShopr CSV export failed (HTTP ${res.status}).`);
    const lines = parseCsv(await res.text());
    const missing = lines.length ? [SKU_COLUMN, QTY_COLUMN].filter((c) => !(c in lines[0])) : [];
    if (missing.length) throw new Error(`The PO export has no "${missing.join('", "')}" column; RepairShopr may have changed its format.`);

    const items = new Map(); // sku -> {sku, qty}; duplicate SKUs merged
    const skipped = [], flagged = [];
    lines.forEach((r) => {
      const name = r.Name || r.Description || '(no name)';
      const sku = r[SKU_COLUMN] || '';
      const qty = Math.round(parseFloat(r[QTY_COLUMN]) || 0);
      if (!sku) return skipped.push(`${name}: no Vendor SKU`);
      if (qty <= 0) return skipped.push(`${name} (${sku}): quantity ${r[QTY_COLUMN] || 'blank'}`);
      if (supplier.skuCheck && !supplier.skuCheck.test(sku)) flagged.push(`${name}: <code>${esc(sku)}</code>`);
      const it = items.get(sku) || { sku, qty: 0 };
      it.qty += qty;
      items.set(sku, it);
    });
    return { poNumber: lines[0]?.['PO Number'] || `PO-${PO_ID}`, items: [...items.values()], skipped, flagged, lineCount: lines.length };
  }

  /* ------------------------------------------------------------------ *
   * File builders
   * ------------------------------------------------------------------ */
  const MIME = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const buildFile = (s, items) => (s.type === 'xlsx' ? buildXlsx(s, items) : buildCsv(s, items)); // -> Uint8Array

  function buildCsv(s, items) {
    const q = (v) => (/[",\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const out = [s.header.map(q).join(','), ...items.map((it) => `${q(it.sku)},${it.qty}`)].join('\n') + '\n';
    return new TextEncoder().encode(out);
  }

  function buildXlsx(s, items) {
    const x = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const strings = [], index = new Map();
    const sst = (v) => { if (!index.has(v)) { index.set(v, strings.length); strings.push(v); } return index.get(v); };
    const col = (i) => String.fromCharCode(65 + i);
    const cell = (ref, v, style) => {
      const st = style ? ` s="${style}"` : '';
      return typeof v === 'number' ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}"${st} t="s"><v>${sst(v)}</v></c>`;
    };
    const skuVal = (sku) => (s.numericSku && /^[1-9]\d{0,14}$/.test(sku) ? Number(sku) : sku);
    const rows = [`<row r="1">${s.header.map((h, i) => cell(`${col(i)}1`, h, s.boldHeader ? 1 : 0)).join('')}</row>`];
    items.forEach((it, n) => {
      const r = n + 2, v = skuVal(it.sku);
      rows.push(`<row r="${r}">${cell(`A${r}`, v, typeof v === 'number' ? 2 : 0)}${cell(`B${r}`, it.qty)}</row>`);
    });
    const NS = 'http://schemas.openxmlformats.org';
    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="${x(s.sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${NS}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      // style 1: bold header; style 2: whole-number format so long SKUs don't show as 1.07E+11
      'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
      'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}/spreadsheetml/2006/main"><dimension ref="A1:B${items.length + 1}"/><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="9" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData></worksheet>`,
    };
    files['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS}/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((t) => `<si><t>${x(t)}</t></si>`).join('')}</sst>`;
    return zipStore(files);
  }

  // Minimal uncompressed ZIP writer (an .xlsx is a zip of XML files).
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, text] of Object.entries(files)) {
      const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4],
        [18, data.length, 4], [22, data.length, 4], [26, nm.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => (n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true)));
      const ch = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4],
        [20, data.length, 4], [24, data.length, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2],
        [38, 0, 4], [42, offset, 4]]
        .forEach(([o, v, n]) => (n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true)));
      parts.push(new Uint8Array(lh.buffer), nm, data);
      central.push(new Uint8Array(ch.buffer), nm);
      offset += 30 + nm.length + data.length;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0), count = Object.keys(files).length;
    const end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, count, 2], [10, count, 2], [12, cdSize, 4], [16, offset, 4], [20, 0, 2]]
      .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function download(blob, filename) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function openOrderPage(s) {
    if (!s.orderUrl) return;
    const w = window.open(s.orderUrl, '_blank');
    if (w) { w.opener = null; return; }
    // Popup blocked (e.g. the PO export took too long after the click): offer a link instead
    modal(`Open ${s.name} quick order`,
      `<p>The browser blocked the new tab. ${s.autoImport
        ? 'Open it within 10 minutes and the items are added to the cart there.'
        : 'The import file was downloaded.'}</p>` +
      `<p><a href="${esc(s.orderUrl)}" target="_blank" rel="noopener">Open ${esc(s.name)} quick order →</a></p>`);
  }

  /* ------------------------------------------------------------------ *
   * Button
   * ------------------------------------------------------------------ */
  async function exportFor(supplier) {
    let po;
    try {
      po = await readPo(supplier);
    } catch (e) {
      return modal('Export failed', `<p>${esc(e.message)}</p>`);
    }
    const filename = `${po.poNumber} - ${supplier.name} import.${supplier.type}`.replace(/[\\/:*?"<>|]/g, '-');
    const total = po.items.reduce((a, it) => a + it.qty, 0);
    const go = () => {
      closeModal();
      const bytes = buildFile(supplier, po.items);
      if (supplier.autoImport) {
        // No download: the supplier tab imports the file, and offers it only if that fails
        GM_setValue(JOB_KEY, {
          supplier: supplier.name, poNumber: po.poNumber, filename, mime: MIME[supplier.type],
          data: toBase64(bytes), skus: po.items.length, units: total, at: Date.now(),
        });
      } else {
        download(new Blob([bytes], { type: MIME[supplier.type] }), filename);
      }
      openOrderPage(supplier);
      setLabel(`✓ ${po.items.length} SKUs, ${total} units`);
      setTimeout(() => setLabel(), 4000);
    };
    if (!po.items.length) {
      return modal('Nothing to export', `<p>None of the ${po.lineCount} line(s) on this PO have both a SKU and a quantity.</p>${list('Skipped', po.skipped)}`);
    }
    if (po.skipped.length || po.flagged.length) {
      const auto = !!supplier.autoImport;
      return modal(`Check before ${auto ? 'adding to cart' : 'downloading'}: ${supplier.name}`,
        `<p>${po.items.length} SKUs (${total} units) will be ${auto ? `added to your ${esc(supplier.name)} cart` : `in <code>${esc(filename)}</code>`}.</p>` +
        list('Left out — add these by hand on the supplier site', po.skipped.map(esc)) +
        list(`Included, but the SKU doesn't look like a ${esc(supplier.skuHint)} — the supplier's import may reject it`, po.flagged),
        [{ label: 'Cancel', onClick: closeModal }, { label: auto ? 'Add to cart anyway' : 'Download anyway', cls: 'warn', onClick: go }]);
    }
    go();
  }
  const list = (title, items) => (items.length ? `<p><b>${title}:</b></p><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '');

  let btn;
  const setLabel = (text) => {
    const s = supplierFor(vendorName());
    btn.textContent = text || (!s ? 'No import format for this vendor' : s.autoImport ? `🛒 ${s.name}: add to cart` : `⬇ ${s.name} import`);
    btn.disabled = !s;
    btn.title = !s ? `Vendor "${vendorName() || 'none'}" has no import format in the userscript`
      : s.autoImport ? `Download the ${s.name} import file and add the items to your ${s.name} cart`
        : `Download the ${s.name} cart-import ${s.type.toUpperCase()} for this PO and open ${s.name} quick order`;
  };

  function addButton() {
    const actions = document.querySelector('ul.dropdown-menu a[href$=".csv"]')?.closest('.btn-group');
    if (!actions || document.getElementById('rspo-btn')) return;
    btn = Object.assign(document.createElement('button'), { id: 'rspo-btn', type: 'button', className: 'btn btn-success btn-sm' });
    btn.onclick = () => {
      const s = supplierFor(vendorName()); // read at click time: vendor can be changed inline
      if (s) exportFor(s);
    };
    actions.parentElement.insertBefore(btn, actions);
    setLabel();
  }
  addButton();
})();
