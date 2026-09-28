import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assets = [
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/app.js", "app.js", "text/javascript; charset=utf-8"],
  ["/styles.css", "styles.css", "text/css; charset=utf-8"],
  ["/data/members.json", "data/members.json", "application/json; charset=utf-8"],
  ["/data/shelves.json", "data/shelves.json", "application/json; charset=utf-8"]
];
const contents = Object.fromEntries(await Promise.all(assets.map(async ([route, file, type]) => [
  route, { body: await readFile(resolve(root, "dist", file), "utf8"), type }
])));
const source = await readFile(resolve(root, "worker/index.js"), "utf8");
await mkdir(resolve(root, "dist/server"), { recursive:true });
await mkdir(resolve(root, "dist/.openai"), { recursive:true });
await writeFile(resolve(root, "dist/server/index.js"), `const STATIC_FILES = ${JSON.stringify(contents)};\n${source}`);
const hostingConfig = resolve(root, ".openai/hosting.json");
if (await access(hostingConfig).then(() => true, () => false)) {
  await copyFile(hostingConfig, resolve(root, "dist/.openai/hosting.json"));
}
