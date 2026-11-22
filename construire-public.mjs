// Construit le dossier public/ : SEULEMENT ce que le navigateur doit pouvoir telecharger.
// Jamais : api/, tests/, node_modules/, vercel.json, package*.json, scripts serveur ou de developpement.
import fs from "node:fs";
import path from "node:path";
const SORTIE = "public";
const DOSSIERS = ["assets", "audio", "vendor"];
const EXT = new Set([".html", ".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp", ".mp3", ".mp4", ".glb", ".woff", ".woff2"]);
const INTERDITS = new Set(["chat-admin.js", "vercel.json", "package.json", "package-lock.json", "server-local.mjs"]);
fs.rmSync(SORTIE, { recursive: true, force: true });
fs.mkdirSync(SORTIE);
let n = 0;
for (const f of fs.readdirSync(".", { withFileTypes: true })) {
  if (!f.isFile() || INTERDITS.has(f.name) || /\.(avant|bak)/.test(f.name) || !EXT.has(path.extname(f.name).toLowerCase())) continue;
  fs.copyFileSync(f.name, path.join(SORTIE, f.name)); n++;
}
for (const d of DOSSIERS) if (fs.existsSync(d)) { fs.cpSync(d, path.join(SORTIE, d), { recursive: true }); n++; }
for (const obligatoire of ["index.html", "dashboard.html", "sw.js", "vendor"]) if (!fs.existsSync(path.join(SORTIE, obligatoire))) { console.error("public/ incomplet : " + obligatoire); process.exit(1); }
for (const interdit of ["api", "tests", "node_modules", "vercel.json", "package.json", "chat-admin.js"]) if (fs.existsSync(path.join(SORTIE, interdit))) { console.error("public/ contient un fichier interdit : " + interdit); process.exit(1); }
console.log("public/ pret : " + n + " elements");
