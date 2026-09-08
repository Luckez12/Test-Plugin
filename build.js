const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const srcRoot = path.join(__dirname, "src");
const outRoot = path.join(__dirname, "providers");

fs.mkdirSync(outRoot, { recursive: true });

const requested = process.argv[2];

const names = requested
  ? [requested]
  : fs.readdirSync(srcRoot, { withFileTypes: true })
      .filter(x => x.isDirectory() && !x.name.startsWith("_"))
      .map(x => x.name);

(async () => {
  for (const name of names) {
    const entry = path.join(srcRoot, name, "index.js");

    if (!fs.existsSync(entry)) {
      throw new Error(`Missing entry: ${entry}`);
    }

    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2020",
      outfile: path.join(outRoot, `${name}.js`)
    });

    console.log(`Built providers/${name}.js`);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
