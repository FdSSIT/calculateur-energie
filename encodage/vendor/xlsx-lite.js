/* ---------------------------------------------------------------------------
   xlsx-lite — lecture et écriture minimales de classeurs .xlsx
   ---------------------------------------------------------------------------
   Écrit pour le calculateur de prix de l'énergie. Aucune dépendance, aucun
   appel réseau. Volontairement limité à ce dont l'outil a besoin :

     readXlsx(arrayBuffer)  ->  Promise<Array<Array<valeur>>>
         lit la PREMIÈRE feuille du classeur et renvoie ses lignes.
         Les valeurs sont des nombres ou des chaînes. Les dates arrivent
         sous forme de numéro de série Excel : l'appelant les convertit.

     writeXlsx(aoa, nomFeuille)  ->  Promise<Blob>
         écrit un classeur d'une seule feuille à partir d'un tableau de lignes.

   Un fichier .xlsx est une archive ZIP contenant du XML. Les deux moitiés de
   ce fichier sont donc : un lecteur/écrivain ZIP, puis un lecteur/écrivain XML.

   Limites connues et assumées :
     - une seule feuille lue (la première du classeur) ;
     - pas de formules évaluées : la valeur mise en cache par Excel est lue ;
     - pas de lecture des formats de nombre, donc pas de conversion de date ;
     - archives ZIP64 (au-delà de 65 535 entrées ou 4 Go) non prises en charge ;
     - à l'écriture, les entrées ne sont pas compressées (archive valide,
       simplement plus volumineuse — sans conséquence à cette échelle).
--------------------------------------------------------------------------- */
"use strict";

(function (global) {

  /* ===================== ZIP : lecture ===================== */

  function u16(d, o) { return d.getUint16(o, true); }
  function u32(d, o) { return d.getUint32(o, true); }

  /* Localise la fin du répertoire central, en remontant depuis la fin. */
  function findEocd(dv) {
    const max = Math.min(dv.byteLength, 65557);
    for (let i = 22; i <= max; i++) {
      const p = dv.byteLength - i;
      if (u32(dv, p) === 0x06054b50) return p;
    }
    return -1;
  }

  function listEntries(buf) {
    const dv = new DataView(buf);
    const eocd = findEocd(dv);
    if (eocd < 0) throw new Error("Ce fichier n'est pas un classeur .xlsx valide (archive illisible).");
    const count = u16(dv, eocd + 10);
    if (count === 0xffff) throw new Error("Archive ZIP64 non prise en charge.");
    let p = u32(dv, eocd + 16);
    const dec = new TextDecoder("utf-8");
    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (u32(dv, p) !== 0x02014b50) throw new Error("Archive endommagée (répertoire central).");
      const method = u16(dv, p + 10);
      const csize  = u32(dv, p + 20);
      const usize  = u32(dv, p + 24);
      const nlen   = u16(dv, p + 28);
      const elen   = u16(dv, p + 30);
      const clen   = u16(dv, p + 32);
      const offset = u32(dv, p + 42);
      const name   = dec.decode(new Uint8Array(buf, p + 46, nlen));
      out.set(name, { method, csize, usize, offset });
      p += 46 + nlen + elen + clen;
    }
    return { dv, buf, entries: out };
  }

  async function readEntry(zip, name) {
    const e = zip.entries.get(name);
    if (!e) return null;
    const dv = zip.dv;
    if (u32(dv, e.offset) !== 0x04034b50) throw new Error("Archive endommagée (en-tête local).");
    const nlen = u16(dv, e.offset + 26);
    const elen = u16(dv, e.offset + 28);
    const start = e.offset + 30 + nlen + elen;
    const raw = new Uint8Array(zip.buf, start, e.csize);
    let bytes;
    if (e.method === 0) {
      bytes = raw;
    } else if (e.method === 8) {
      if (typeof DecompressionStream === "undefined")
        throw new Error("Ce navigateur est trop ancien pour lire un .xlsx compressé.");
      const ds = new DecompressionStream("deflate-raw");
      const ab = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
      bytes = new Uint8Array(ab);
    } else {
      throw new Error("Compression non prise en charge dans l'archive (méthode " + e.method + ").");
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  /* ===================== ZIP : écriture (entrées non compressées) ========== */

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const { time, date } = dosTime(new Date());
    const locals = [], centrals = [];
    let offset = 0;

    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = enc.encode(f.data);
      const crc = crc32(data);

      const lh = new Uint8Array(30 + name.length);
      const ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);          // version nécessaire
      ldv.setUint16(6, 0x0800, true);      // noms de fichiers en UTF-8
      ldv.setUint16(8, 0, true);           // méthode : aucune compression
      ldv.setUint16(10, time, true);
      ldv.setUint16(12, date, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, data.length, true);
      ldv.setUint32(22, data.length, true);
      ldv.setUint16(26, name.length, true);
      lh.set(name, 30);
      locals.push(lh, data);

      const ch = new Uint8Array(46 + name.length);
      const cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, time, true);
      cdv.setUint16(14, date, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, name.length, true);
      cdv.setUint32(42, offset, true);
      ch.set(name, 46);
      centrals.push(ch);

      offset += lh.length + data.length;
    });

    const cdSize = centrals.reduce((a, b) => a + b.length, 0);
    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, offset, true);

    return new Blob(locals.concat(centrals, [eocd]),
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ===================== XLSX : lecture ===================== */

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      throw new Error("Contenu XML illisible dans le classeur.");
    return doc;
  }

  /* "BC12" -> 54 (index de colonne, base 0) */
  function colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  /* Chemin de la première feuille, via les relations du classeur. */
  async function firstSheetPath(zip) {
    try {
      const wb = await readEntry(zip, "xl/workbook.xml");
      const rels = await readEntry(zip, "xl/_rels/workbook.xml.rels");
      if (wb && rels) {
        const sheet = parseXml(wb).getElementsByTagName("sheet")[0];
        const rid = sheet && (sheet.getAttribute("r:id") || sheet.getAttribute("id"));
        if (rid) {
          const list = parseXml(rels).getElementsByTagName("Relationship");
          for (const r of list) {
            if (r.getAttribute("Id") === rid) {
              let t = r.getAttribute("Target") || "";
              t = t.replace(/^\/?xl\//, "").replace(/^\.\//, "");
              if (zip.entries.has("xl/" + t)) return "xl/" + t;
            }
          }
        }
      }
    } catch (e) { /* on retombe sur le chemin habituel */ }
    for (const name of zip.entries.keys()) {
      if (/^xl\/worksheets\/sheet[^/]*\.xml$/.test(name)) return name;
    }
    throw new Error("Aucune feuille de calcul trouvée dans le classeur.");
  }

  async function readXlsx(arrayBuffer) {
    const zip = listEntries(arrayBuffer);

    /* chaînes partagées */
    let shared = [];
    const ssText = await readEntry(zip, "xl/sharedStrings.xml");
    if (ssText) {
      const sis = parseXml(ssText).getElementsByTagName("si");
      shared = Array.from(sis).map(si =>
        Array.from(si.getElementsByTagName("t")).map(t => t.textContent).join(""));
    }

    const sheetText = await readEntry(zip, await firstSheetPath(zip));
    if (sheetText === null) throw new Error("Feuille de calcul illisible.");
    const rowsEl = parseXml(sheetText).getElementsByTagName("row");

    const out = [];
    for (const row of rowsEl) {
      const line = [];
      for (const c of row.getElementsByTagName("c")) {
        const ref = c.getAttribute("r");
        const idx = ref ? colIndex(ref) : line.length;
        const type = c.getAttribute("t");
        let val = null;

        if (type === "s") {
          const v = c.getElementsByTagName("v")[0];
          const i = v ? parseInt(v.textContent, 10) : -1;
          val = (i >= 0 && i < shared.length) ? shared[i] : null;
        } else if (type === "inlineStr") {
          val = Array.from(c.getElementsByTagName("t")).map(t => t.textContent).join("") || null;
        } else if (type === "str") {
          const v = c.getElementsByTagName("v")[0];
          val = v ? v.textContent : null;
        } else if (type === "b") {
          const v = c.getElementsByTagName("v")[0];
          val = v ? v.textContent === "1" : null;
        } else if (type === "e") {
          val = null;                                   // cellule en erreur
        } else {
          const v = c.getElementsByTagName("v")[0];
          if (v && v.textContent !== "") {
            const n = Number(v.textContent);
            val = isFinite(n) ? n : v.textContent;
          }
        }
        while (line.length < idx) line.push(null);
        line[idx] = val;
      }
      const r = parseInt(row.getAttribute("r") || "0", 10);
      if (r > 0) { while (out.length < r - 1) out.push([]); out[r - 1] = line; }
      else out.push(line);
    }
    return out;
  }

  /* ===================== XLSX : écriture ===================== */

  function xmlEsc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  }
  function colName(i) {
    let s = "";
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
    return s;
  }

  async function writeXlsx(aoa, sheetName) {
    const name = xmlEsc((sheetName || "Feuille1").slice(0, 31));
    const rows = aoa.map((row, r) => {
      const cells = row.map((v, c) => {
        if (v === null || v === undefined || v === "") return "";
        const ref = colName(c) + (r + 1);
        if (typeof v === "number" && isFinite(v))
          return '<c r="' + ref + '"><v>' + v + "</v></c>";
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">'
          + xmlEsc(v) + "</t></is></c>";
      }).join("");
      return '<row r="' + (r + 1) + '">' + cells + "</row>";
    }).join("");

    const files = [
      { name: "[Content_Types].xml", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + "</Types>" },
      { name: "_rels/.rels", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + "</Relationships>" },
      { name: "xl/workbook.xml", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + "</Relationships>" },
      { name: "xl/worksheets/sheet1.xml", data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + "<sheetData>" + rows + "</sheetData></worksheet>" }
    ];
    return zipStore(files);
  }

  global.XlsxLite = { readXlsx, writeXlsx };

})(window);
