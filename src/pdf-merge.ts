type PdfObject =
  | { kind: "dict"; entries: Map<string, PdfObject> }
  | { kind: "array"; items: PdfObject[] }
  | { kind: "ref"; num: number }
  | { kind: "token"; text: string };

type IndirectObject = { value: PdfObject; stream: Uint8Array | null };

type Token =
  | { type: "number"; text: string }
  | { type: "name"; text: string }
  | { type: "string"; text: string }
  | { type: "keyword"; text: string }
  | { type: "<<" }
  | { type: ">>" }
  | { type: "[" }
  | { type: "]" };

const INHERITABLE_PAGE_KEYS = ["/Resources", "/MediaBox", "/CropBox", "/Rotate"];

const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
};

const isWhitespace = (b: number) =>
  b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
const isDelimiter = (b: number) =>
  b === 0x28 ||
  b === 0x29 ||
  b === 0x3c ||
  b === 0x3e ||
  b === 0x5b ||
  b === 0x5d ||
  b === 0x7b ||
  b === 0x7d ||
  b === 0x2f ||
  b === 0x25;
const isRegular = (b: number) => !isWhitespace(b) && !isDelimiter(b);

class Lexer {
  pos = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  skipWhitespace() {
    while (this.pos < this.bytes.length) {
      const b = this.bytes[this.pos]!;
      if (isWhitespace(b)) {
        this.pos++;
      } else if (b === 0x25) {
        while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x0a) this.pos++;
      } else {
        return;
      }
    }
  }

  next(): Token {
    this.skipWhitespace();
    if (this.pos >= this.bytes.length) {
      throw new Error("pdf: unexpected end of data");
    }
    const start = this.pos;
    const b = this.bytes[this.pos]!;
    if (b === 0x2f) {
      this.pos++;
      while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos]!)) this.pos++;
      return { type: "name", text: latin1(this.bytes.subarray(start, this.pos)) };
    }
    if (b === 0x28) {
      let depth = 0;
      for (; this.pos < this.bytes.length; this.pos++) {
        const c = this.bytes[this.pos]!;
        if (c === 0x5c) {
          this.pos++;
        } else if (c === 0x28) {
          depth++;
        } else if (c === 0x29) {
          depth--;
          if (depth === 0) {
            this.pos++;
            return { type: "string", text: latin1(this.bytes.subarray(start, this.pos)) };
          }
        }
      }
      throw new Error("pdf: unterminated string");
    }
    if (b === 0x3c) {
      if (this.bytes[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { type: "<<" };
      }
      while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x3e) this.pos++;
      this.pos++;
      return { type: "string", text: latin1(this.bytes.subarray(start, this.pos)) };
    }
    if (b === 0x3e) {
      if (this.bytes[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { type: ">>" };
      }
      throw new Error("pdf: unexpected '>'");
    }
    if (b === 0x5b) {
      this.pos++;
      return { type: "[" };
    }
    if (b === 0x5d) {
      this.pos++;
      return { type: "]" };
    }
    if (b === 0x7b || b === 0x7d || b === 0x29) {
      throw new Error(`pdf: unexpected delimiter ${String.fromCharCode(b)}`);
    }
    while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos]!)) this.pos++;
    const text = latin1(this.bytes.subarray(start, this.pos));
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)
      ? { type: "number", text }
      : { type: "keyword", text };
  }

  expectKeyword(keyword: string) {
    const token = this.next();
    if (token.type !== "keyword" || token.text !== keyword) {
      throw new Error(`pdf: expected ${keyword}`);
    }
  }

  parseObject(first: Token = this.next()): PdfObject {
    switch (first.type) {
      case "<<": {
        const entries = new Map<string, PdfObject>();
        for (;;) {
          const key = this.next();
          if (key.type === ">>") return { kind: "dict", entries };
          if (key.type !== "name") throw new Error("pdf: expected a name as dictionary key");
          entries.set(key.text, this.parseObject());
        }
      }
      case "[": {
        const items: PdfObject[] = [];
        for (;;) {
          const token = this.next();
          if (token.type === "]") return { kind: "array", items };
          items.push(this.parseObject(token));
        }
      }
      case "number": {
        if (/^\d+$/.test(first.text)) {
          const saved = this.pos;
          const gen = this.next();
          if (gen.type === "number" && /^\d+$/.test(gen.text)) {
            const r = this.next();
            if (r.type === "keyword" && r.text === "R") {
              return { kind: "ref", num: Number.parseInt(first.text, 10) };
            }
          }
          this.pos = saved;
        }
        return { kind: "token", text: first.text };
      }
      case "name":
      case "string":
        return { kind: "token", text: first.text };
      case "keyword":
        if (first.text === "true" || first.text === "false" || first.text === "null") {
          return { kind: "token", text: first.text };
        }
        throw new Error(`pdf: unexpected keyword ${first.text}`);
      default:
        throw new Error(`pdf: unexpected ${first.type}`);
    }
  }
}

function integerOf(obj: PdfObject | undefined, what: string): number {
  if (obj?.kind !== "token" || !/^\d+$/.test(obj.text)) {
    throw new Error(`pdf: ${what} is not an integer`);
  }
  return Number.parseInt(obj.text, 10);
}

function dictOf(obj: PdfObject | undefined, what: string): Map<string, PdfObject> {
  if (obj?.kind !== "dict") throw new Error(`pdf: ${what} is not a dictionary`);
  return obj.entries;
}

class PdfDocument {
  private readonly bytes: Uint8Array;
  private readonly offsets = new Map<number, number>();
  private readonly cache = new Map<number, IndirectObject>();
  readonly trailer: Map<string, PdfObject>;
  readonly header: string;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    const headerEnd = bytes.indexOf(0x0a);
    this.header = latin1(bytes.subarray(0, headerEnd < 0 ? 0 : headerEnd));
    this.trailer = this.readXrefChain(this.findStartXref());
  }

  private findStartXref(): number {
    const tailStart = Math.max(0, this.bytes.length - 2048);
    const at = latin1(this.bytes.subarray(tailStart)).lastIndexOf("startxref");
    if (at < 0) throw new Error("pdf: startxref not found");
    const lexer = new Lexer(this.bytes);
    lexer.pos = tailStart + at + "startxref".length;
    const token = lexer.next();
    if (token.type !== "number") throw new Error("pdf: invalid startxref");
    return Number.parseInt(token.text, 10);
  }

  private readXrefChain(start: number): Map<string, PdfObject> {
    const lexer = new Lexer(this.bytes);
    lexer.pos = start;
    lexer.skipWhitespace();
    const first = lexer.next();
    if (first.type !== "keyword" || first.text !== "xref") {
      throw new Error("pdf: cross-reference streams are not supported");
    }
    for (;;) {
      const token = lexer.next();
      if (token.type === "keyword" && token.text === "trailer") break;
      if (token.type !== "number") throw new Error("pdf: malformed xref subsection");
      const firstNum = Number.parseInt(token.text, 10);
      const count = integerOf(lexer.parseObject(), "xref count");
      for (let i = 0; i < count; i++) {
        const offset = lexer.next();
        const generation = lexer.next();
        const type = lexer.next();
        if (offset.type !== "number" || generation.type !== "number" || type.type !== "keyword") {
          throw new Error("pdf: malformed xref entry");
        }
        const num = firstNum + i;
        if (type.text === "n" && !this.offsets.has(num)) {
          this.offsets.set(num, Number.parseInt(offset.text, 10));
        }
      }
    }
    const trailer = dictOf(lexer.parseObject(), "trailer");
    const prev = trailer.get("/Prev");
    if (prev !== undefined) {
      const older = this.readXrefChain(integerOf(prev, "/Prev"));
      for (const [key, value] of older) if (!trailer.has(key)) trailer.set(key, value);
    }
    return trailer;
  }

  object(num: number): IndirectObject {
    const cached = this.cache.get(num);
    if (cached) return cached;
    const offset = this.offsets.get(num);
    if (offset === undefined) throw new Error(`pdf: object ${num} is not in the xref table`);
    const lexer = new Lexer(this.bytes);
    lexer.pos = offset;
    const declared = lexer.next();
    if (declared.type !== "number" || Number.parseInt(declared.text, 10) !== num) {
      throw new Error(`pdf: object ${num} is not at its xref offset`);
    }
    lexer.next();
    lexer.expectKeyword("obj");
    const value = lexer.parseObject();
    const after = lexer.next();
    let stream: Uint8Array | null = null;
    if (after.type === "keyword" && after.text === "stream") {
      if (this.bytes[lexer.pos] === 0x0d) lexer.pos++;
      if (this.bytes[lexer.pos] === 0x0a) lexer.pos++;
      const length = this.resolveLength(dictOf(value, `stream ${num}`).get("/Length"));
      stream = this.bytes.subarray(lexer.pos, lexer.pos + length);
      lexer.pos += length;
      lexer.expectKeyword("endstream");
      lexer.expectKeyword("endobj");
    } else if (after.type !== "keyword" || after.text !== "endobj") {
      throw new Error(`pdf: object ${num} is not terminated by endobj`);
    }
    const result = { value, stream };
    this.cache.set(num, result);
    return result;
  }

  private resolveLength(length: PdfObject | undefined): number {
    if (length?.kind === "ref") return integerOf(this.object(length.num).value, "/Length");
    return integerOf(length, "/Length");
  }

  pages(): { num: number; inherited: Map<string, PdfObject> }[] {
    const root = this.trailer.get("/Root");
    if (root?.kind !== "ref") throw new Error("pdf: trailer has no /Root");
    const pagesRef = dictOf(this.object(root.num).value, "catalog").get("/Pages");
    if (pagesRef?.kind !== "ref") throw new Error("pdf: catalog has no /Pages");
    const pages: { num: number; inherited: Map<string, PdfObject> }[] = [];
    const walk = (num: number, inherited: Map<string, PdfObject>) => {
      const node = dictOf(this.object(num).value, `page tree node ${num}`);
      const kids = node.get("/Kids");
      if (kids === undefined) {
        pages.push({ num, inherited });
        return;
      }
      if (kids.kind !== "array") throw new Error("pdf: /Kids is not an array");
      const passed = new Map(inherited);
      for (const key of INHERITABLE_PAGE_KEYS) {
        const value = node.get(key);
        if (value !== undefined) passed.set(key, value);
      }
      for (const kid of kids.items) {
        if (kid.kind !== "ref") throw new Error("pdf: /Kids entry is not a reference");
        walk(kid.num, passed);
      }
    };
    walk(pagesRef.num, new Map());
    return pages;
  }
}

class PdfWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly offsets: number[] = [];
  private length = 0;
  private nextNum = 1;
  private readonly encoder = new TextEncoder();

  constructor(header: string) {
    this.push(this.encoder.encode(`${header}\n`));
    this.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  }

  allocate(): number {
    return this.nextNum++;
  }

  write(num: number, value: PdfObject, stream: Uint8Array | null) {
    this.offsets[num] = this.length;
    this.push(this.encoder.encode(`${num} 0 obj\n${serialize(value)}\n`));
    if (stream !== null) {
      this.push(this.encoder.encode("stream\n"));
      this.push(stream);
      this.push(this.encoder.encode("\nendstream\n"));
    }
    this.push(this.encoder.encode("endobj\n"));
  }

  finish(rootNum: number): Uint8Array<ArrayBuffer> {
    const xrefOffset = this.length;
    const size = this.nextNum;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let num = 1; num < size; num++) {
      const offset = this.offsets[num];
      if (offset === undefined) throw new Error(`pdf: object ${num} was allocated but not written`);
      xref += `${offset.toString(10).padStart(10, "0")} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${size} /Root ${rootNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    this.push(this.encoder.encode(xref));
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }

  private push(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
}

function serialize(obj: PdfObject): string {
  switch (obj.kind) {
    case "dict":
      return `<< ${[...obj.entries].map(([key, value]) => `${key} ${serialize(value)}`).join(" ")} >>`;
    case "array":
      return `[ ${obj.items.map(serialize).join(" ")} ]`;
    case "ref":
      return `${obj.num} 0 R`;
    case "token":
      return obj.text;
  }
}

function remapRefs(obj: PdfObject, remap: (num: number) => number): PdfObject {
  switch (obj.kind) {
    case "dict":
      return {
        kind: "dict",
        entries: new Map([...obj.entries].map(([key, value]) => [key, remapRefs(value, remap)])),
      };
    case "array":
      return { kind: "array", items: obj.items.map((item) => remapRefs(item, remap)) };
    case "ref":
      return { kind: "ref", num: remap(obj.num) };
    case "token":
      return obj;
  }
}

export function mergePdfs(pdfs: Uint8Array[]): Uint8Array<ArrayBuffer> {
  if (pdfs.length === 0) throw new Error("pdf: nothing to merge");
  const documents = pdfs.map((bytes) => new PdfDocument(bytes));
  const writer = new PdfWriter(documents[0]!.header);
  const pagesNum = writer.allocate();
  const kids: PdfObject[] = [];

  for (const doc of documents) {
    const numbering = new Map<number, number>();
    const queue: number[] = [];
    const remap = (old: number) => {
      let num = numbering.get(old);
      if (num === undefined) {
        num = writer.allocate();
        numbering.set(old, num);
        queue.push(old);
      }
      return num;
    };
    const pageOverrides = new Map<number, Map<string, PdfObject>>();
    for (const page of doc.pages()) {
      kids.push({ kind: "ref", num: remap(page.num) });
      pageOverrides.set(page.num, page.inherited);
    }
    while (queue.length > 0) {
      const old = queue.shift()!;
      const { value, stream } = doc.object(old);
      const entries = value.kind === "dict" ? new Map(value.entries) : null;
      const inherited = pageOverrides.get(old);
      if (inherited !== undefined) {
        if (entries === null) throw new Error(`pdf: page ${old} is not a dictionary`);
        entries.delete("/Parent");
        for (const [key, inheritedValue] of inherited) {
          if (!entries.has(key)) entries.set(key, inheritedValue);
        }
      }
      if (stream !== null) {
        if (entries === null) throw new Error(`pdf: stream ${old} has no dictionary`);
        entries.set("/Length", { kind: "token", text: `${stream.length}` });
      }
      const copied = remapRefs(entries !== null ? { kind: "dict", entries } : value, remap);
      if (inherited !== undefined) {
        dictOf(copied, `page ${old}`).set("/Parent", { kind: "ref", num: pagesNum });
      }
      writer.write(numbering.get(old)!, copied, stream);
    }
  }

  writer.write(
    pagesNum,
    {
      kind: "dict",
      entries: new Map<string, PdfObject>([
        ["/Type", { kind: "token", text: "/Pages" }],
        ["/Kids", { kind: "array", items: kids }],
        ["/Count", { kind: "token", text: `${kids.length}` }],
      ]),
    },
    null,
  );
  const catalogNum = writer.allocate();
  writer.write(
    catalogNum,
    {
      kind: "dict",
      entries: new Map<string, PdfObject>([
        ["/Type", { kind: "token", text: "/Catalog" }],
        ["/Pages", { kind: "ref", num: pagesNum }],
      ]),
    },
    null,
  );
  return writer.finish(catalogNum);
}
