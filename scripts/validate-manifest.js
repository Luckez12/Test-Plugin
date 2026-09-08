const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
);

if (!Array.isArray(manifest)) {
  throw new Error("manifest.json must contain an array");
}

const ids = new Set();

for (const item of manifest) {
  for (const key of ["id", "name", "version", "filename"]) {
    if (!item[key]) {
      throw new Error(`Manifest entry missing ${key}`);
    }
  }

  if (ids.has(item.id)) {
    throw new Error(`Duplicate provider id: ${item.id}`);
  }
  ids.add(item.id);

  const file = path.join(root, item.filename);

  if (!fs.existsSync(file)) {
    throw new Error(`Built provider missing: ${item.filename}`);
  }

  delete require.cache[require.resolve(file)];
  const provider = require(file);

  if (!provider || typeof provider.getStreams !== "function") {
    throw new Error(`${item.filename} must export getStreams()`);
  }
}

console.log(`Manifest valid: ${manifest.length} provider(s)`);
