import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";
import { chromium, type Browser, type Page } from "playwright";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const fixtures = fileURLToPath(new URL("../../../tests/fixtures/", import.meta.url));

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

function serveDist(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
    let body: Buffer;
    try {
      body = fs.readFileSync(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": contentTypes[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let server: http.Server;
let origin: string;
let browser: Browser;

before(async () => {
  assert.ok(fs.existsSync(path.join(dist, "index.html")), "run `npm run build` first");
  server = await serveDist();
  const { port } = server.address() as { port: number };
  origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function openForm(a: string, b: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.setInputFiles("#pdf-a", path.join(fixtures, a));
  await page.setInputFiles("#pdf-b", path.join(fixtures, b));
  return page;
}

async function openOptions(page: Page) {
  await page.click("#options > summary");
}

async function submitAndDownload(page: Page) {
  const downloaded = page.waitForEvent("download", { timeout: 120_000 });
  await page.click("#submit");
  const download = await downloaded;
  const file = await download.path();
  return { filename: download.suggestedFilename(), bytes: fs.readFileSync(file) };
}

void test("shows the library version", async () => {
  const page = await browser.newPage();
  await page.goto(origin);
  assert.match(await page.locator("#version").innerText(), /^v\d+\.\d+\.\d+/);
  await page.close();
});

void test("a-b-diff-pdf downloads a PDF", async () => {
  const page = await openForm("a.pdf", "b.pdf");
  await openOptions(page);
  await page.setInputFiles("#pdf-mask", path.join(fixtures, "mask.pdf"));
  const { filename, bytes } = await submitAndDownload(page);
  assert.equal(filename, "pdfdiff-a-b-diff.pdf");
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  await page.close();
});

void test("zip downloads the page images", async () => {
  const page = await openForm("a.pdf", "b.pdf");
  await openOptions(page);
  await page.selectOption("#out-type", "zip");
  const { filename, bytes } = await submitAndDownload(page);
  assert.equal(filename, "pdfdiff-result.zip");
  const entries = unzipSync(new Uint8Array(bytes));
  assert.deepEqual(Object.keys(entries).sort(), ["1/a.png", "1/b.png", "1/diff.png"]);
  for (const png of Object.values(entries)) {
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  }
  await page.close();
});

void test("diff-only with identical inputs outputs nothing", async () => {
  const page = await openForm("a.pdf", "a.pdf");
  await openOptions(page);
  await page.check("#diff-only");
  await page.click("#submit");
  await page.getByText("No page was output.").waitFor({ timeout: 120_000 });
  assert.equal(await page.locator("#submit").isEnabled(), true);
  await page.close();
});
