// Offline asset studio. No Three.js runtime is shipped to the application.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.dirname(fileURLToPath(import.meta.url));
const local = path.resolve(studio, "../../.local/car-studio");
const mime = { ".html": "text/html", ".js": "application/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary" };
createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/export" && req.method === "POST") {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 8_000_000) { res.writeHead(413).end(); return; } chunks.push(chunk); }
    await writeFile(path.join(local, "studio-silver.png"), Buffer.concat(chunks));
    res.writeHead(200, { "Content-Type": "text/plain" }).end("Saved .local/car-studio/studio-silver.png"); return;
  }
  const root = pathname.startsWith("/three/") ? path.join(local, "node_modules/three") : studio;
  const relative = pathname.startsWith("/three/") ? pathname.slice(7) : pathname === "/" ? "index.html" : pathname.slice(1);
  const target = pathname === "/model.glb" ? path.join(local, "car-concept.glb") : path.resolve(root, relative);
  if (pathname !== "/model.glb" && !target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { const bytes = await readFile(target); res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" }).end(bytes); }
  catch { res.writeHead(404).end("Missing studio asset; see README.md"); }
}).listen(5178, "127.0.0.1", () => console.log("Car studio: http://127.0.0.1:5178"));
