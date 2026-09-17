const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "manifest.json");
const manifest = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : { name: "Luckez12 Plugins", version: "1.0.0", scrapers: [] };

if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  throw new Error("manifest.json root must be an object");
}
if (!Array.isArray(manifest.scrapers)) manifest.scrapers = [];

const entry = {
  id: "kisskh",
  name: "KissKH",
  description: "KissKH strict TMDB/title gate with stale-context protection and safe search fallback",
  version: "1.0.10",
  author: "Luckez12",
  supportedTypes: ["movie", "tv"],
  filename: "providers/kisskh.js",
  enabled: true,
  hasSettings: false,
  logo: "https://www.google.com/s2/favicons?domain=kisskh.do&sz=128",
  contentLanguage: ["en", "ko", "zh", "ja", "th"],
  formats: ["m3u8", "mp4"],
  limited: false,
  disabledPlatforms: [],
  supportsExternalPlayer: true
};

const index = manifest.scrapers.findIndex(x => x && x.id === entry.id);
if (index >= 0) manifest.scrapers[index] = { ...manifest.scrapers[index], ...entry };
else manifest.scrapers.push(entry);

fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
console.log("Registered KissKH v" + entry.version + " in manifest.json");
