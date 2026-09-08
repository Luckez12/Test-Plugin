const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error("manifest.json not found");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  throw new Error("manifest.json root must be a JSON object");
}

if (typeof manifest.name !== "string" || !manifest.name.trim()) {
  throw new Error("manifest.json missing repository name");
}

if (
  (typeof manifest.version !== "string" && typeof manifest.version !== "number") ||
  String(manifest.version).trim() === ""
) {
  throw new Error("manifest.json missing repository version");
}

if (!Array.isArray(manifest.scrapers)) {
  throw new Error("manifest.json must contain a scrapers array");
}

const ids = new Set();

for (const item of manifest.scrapers) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Each scraper entry must be a JSON object");
  }

  for (const key of ["id", "name", "filename"]) {
    if (typeof item[key] !== "string" || !item[key].trim()) {
      throw new Error(`Scraper entry missing ${key}`);
    }
  }

  if (ids.has(item.id)) {
    throw new Error(`Duplicate scraper id: ${item.id}`);
  }
  ids.add(item.id);

  const providerPath = path.resolve(root, item.filename);

  if (!providerPath.startsWith(root + path.sep)) {
    throw new Error(`Invalid provider path: ${item.filename}`);
  }

  if (!fs.existsSync(providerPath)) {
    throw new Error(`Provider file missing: ${item.filename}`);
  }

  delete require.cache[require.resolve(providerPath)];
  const provider = require(providerPath);

  if (!provider || typeof provider.getStreams !== "function") {
    throw new Error(`${item.filename} must export getStreams()`);
  }
}

console.log(
  `Manifest valid: ${manifest.name}, ${manifest.scrapers.length} scraper(s)`
);
