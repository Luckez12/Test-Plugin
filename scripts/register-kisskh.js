const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "manifest.json");
const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];

if (!Array.isArray(manifest)) throw new Error("manifest.json must contain an array");

const entry = {
  id: "kisskh",
  name: "KissKH",
  description: "KissKH Asian drama and movie provider",
  version: "1.0.0",
  author: "Luckez12",
  supportedTypes: ["movie", "tv"],
  filename: "providers/kisskh.js",
  enabled: true,
  logo: "https://www.google.com/s2/favicons?domain=kisskh.do&sz=128",
  contentLanguage: ["en", "ko", "zh", "ja", "th"],
  formats: ["m3u8", "mp4"],
  limited: false,
  disabledPlatforms: [],
  supportsExternalPlayer: true
};

const index = manifest.findIndex(x => x && x.id === entry.id);
if (index >= 0) manifest[index] = { ...manifest[index], ...entry };
else manifest.push(entry);

fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
console.log("Registered KissKH in manifest.json");
