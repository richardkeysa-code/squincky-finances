export type XlsxCell = string | number | boolean | null | undefined;
export type XlsxSheet = { name: string; rows: XlsxCell[][] };

type ZipEntry = { name: string; data: Uint8Array };

type ZipDirectoryEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, result - 1);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function storedZip(entries: ZipEntry[]) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return concatBytes([...locals, ...centrals, end]);
}

function worksheetXml(rows: XlsxCell[][]) {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => {
          if (cell === null || cell === undefined || cell === "") return "";
          const ref = `${columnName(colIndex)}${rowIndex + 1}`;
          if (typeof cell === "number" && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`;
          if (typeof cell === "boolean") return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(cell))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

export function createXlsxBlob(sheets: XlsxSheet[]) {
  if (sheets.length === 0) throw new Error("At least one worksheet is required.");
  const safeSheets = sheets.map((sheet, index) => ({
    name: (sheet.name || `Sheet ${index + 1}`).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31),
    rows: sheet.rows,
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${safeSheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeSheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safeSheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    ...safeSheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(worksheetXml(sheet.rows)) })),
  ];

  return new Blob([storedZip(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadXlsx(fileName: string, sheets: XlsxSheet[]) {
  const blob = createXlsxBlob(sheets);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function findEocd(bytes: Uint8Array) {
  const min = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  throw new Error("Invalid XLSX ZIP container.");
}

function readZipDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipDirectoryEntry>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid XLSX central directory.");
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.set(name, { name, compression, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress XLSX files. Please use a recent Chrome, Edge, Safari, or Firefox version.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(bytes: Uint8Array, entry: ZipDirectoryEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`Invalid XLSX entry: ${entry.name}`);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return inflateRaw(compressed);
  throw new Error(`Unsupported XLSX compression method ${entry.compression}.`);
}

function xmlDocument(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Could not parse XLSX worksheet XML.");
  return doc;
}

function textOf(node: Element | undefined | null) {
  return node?.textContent ?? "";
}

function normalizeTarget(target: string) {
  const clean = target.replace(/^\//, "");
  if (clean.startsWith("xl/")) return clean;
  return `xl/${clean.replace(/^\.\//, "")}`;
}

function headerScore(row: string[]) {
  const known = ["date", "tanggal", "amount", "net", "gross", "fee", "mdr", "credit", "kredit", "reference", "ref", "rrn", "settlement", "transaction", "trx", "description", "keterangan"];
  return row.reduce((score, cell) => {
    const normalized = cell.toLowerCase().replace(/[^a-z0-9]/g, "");
    return score + (known.some((keyword) => normalized.includes(keyword)) ? 1 : 0);
  }, 0);
}

function rowsToRecords(matrix: string[][]) {
  if (matrix.length === 0) return [];
  const candidates = matrix.slice(0, Math.min(20, matrix.length));
  let headerIndex = 0;
  let bestScore = -1;
  candidates.forEach((row, index) => {
    const score = headerScore(row);
    if (score > bestScore || (score === bestScore && row.filter(Boolean).length > candidates[headerIndex].filter(Boolean).length)) {
      bestScore = score;
      headerIndex = index;
    }
  });
  const headers = matrix[headerIndex].map((value, i) => value.trim() || `Column ${i + 1}`);
  return matrix.slice(headerIndex + 1).map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ""]))).filter((row) => Object.values(row).some((value) => String(value).trim()));
}

export async function parseXlsxRecords(file: File): Promise<Record<string, string>[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const directory = readZipDirectory(bytes);
  const workbookEntry = directory.get("xl/workbook.xml");
  const relsEntry = directory.get("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relsEntry) throw new Error("This XLSX file is missing workbook metadata.");

  const workbookDoc = xmlDocument(decoder.decode(await readZipEntry(bytes, workbookEntry)));
  const relsDoc = xmlDocument(decoder.decode(await readZipEntry(bytes, relsEntry)));
  const relationships = new Map<string, string>();
  Array.from(relsDoc.getElementsByTagName("Relationship")).forEach((node) => relationships.set(node.getAttribute("Id") ?? "", normalizeTarget(node.getAttribute("Target") ?? "")));

  const sharedEntry = directory.get("xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (sharedEntry) {
    const sharedDoc = xmlDocument(decoder.decode(await readZipEntry(bytes, sharedEntry)));
    Array.from(sharedDoc.getElementsByTagName("si")).forEach((node) => sharedStrings.push(textOf(node)));
  }

  const sheetNodes = Array.from(workbookDoc.getElementsByTagName("sheet"));
  for (const sheetNode of sheetNodes) {
    const relationshipId = sheetNode.getAttribute("r:id") ?? sheetNode.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const target = relationships.get(relationshipId);
    if (!target) continue;
    const sheetEntry = directory.get(target);
    if (!sheetEntry) continue;
    const sheetDoc = xmlDocument(decoder.decode(await readZipEntry(bytes, sheetEntry)));
    const matrix: string[][] = [];

    Array.from(sheetDoc.getElementsByTagName("row")).forEach((rowNode) => {
      const row: string[] = [];
      Array.from(rowNode.getElementsByTagName("c")).forEach((cell) => {
        const ref = cell.getAttribute("r") ?? "A1";
        const index = columnIndex(ref);
        const type = cell.getAttribute("t") ?? "n";
        let value = "";
        if (type === "s") value = sharedStrings[Number(textOf(cell.getElementsByTagName("v")[0]))] ?? "";
        else if (type === "inlineStr") value = textOf(cell.getElementsByTagName("is")[0]);
        else value = textOf(cell.getElementsByTagName("v")[0]);
        row[index] = value;
      });
      matrix.push(row);
    });

    const records = rowsToRecords(matrix);
    if (records.length > 0) return records;
  }

  throw new Error("No tabular rows were found in this XLSX workbook.");
}
