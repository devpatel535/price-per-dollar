import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pre-submission checks for the Chrome Web Store.
 *
 * Every rule here corresponds to something the store either rejects outright or
 * flags in review: a malformed manifest, a missing icon size, remote code, a
 * dangling file reference, inline script under the MV3 CSP. Catching them here
 * costs seconds; catching them in review costs days.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const assets = path.join(root, 'store', 'assets');

const problems = [];
const warnings = [];
const passes = [];

const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);
const pass = (message) => passes.push(message);

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/** Read a PNG's declared dimensions straight out of its IHDR chunk. */
function pngSize(file) {
  const buffer = fs.readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/ is not built — run `npm run build` first.');
  process.exit(1);
}

const files = walk(dist);
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  pass('manifest.json is valid JSON');
} catch (error) {
  fail(`manifest.json does not parse: ${error.message}`);
  manifest = {};
}

// --- manifest fields the store validates ---
if (manifest.manifest_version === 3) pass('manifest version 3');
else fail(`manifest_version must be 3, found ${manifest.manifest_version}`);

const name = manifest.name ?? '';
if (name && name.length <= 45) pass(`name "${name}" (${name.length}/45 chars)`);
else fail(`name must be 1-45 characters, found ${name.length}`);

const description = manifest.description ?? '';
if (description && description.length <= 132) pass(`description ${description.length}/132 chars`);
else fail(`description must be 1-132 characters, found ${description.length}`);

const version = manifest.version ?? '';
const parts = version.split('.');
const versionOk = /^\d+(\.\d+){0,3}$/.test(version)
  && parts.every((part) => Number(part) <= 65535 && String(Number(part)) === part);
if (versionOk) pass(`version ${version}`);
else fail(`version "${version}" must be 1-4 dot-separated integers, each 0-65535, no leading zeros`);

// --- icons ---
for (const size of ['16', '48', '128']) {
  const relative = manifest.icons?.[size];
  if (!relative) {
    if (size === '128') fail('icons.128 is required for the store listing');
    else warn(`icons.${size} is not declared`);
    continue;
  }
  const file = path.join(dist, relative);
  if (!fs.existsSync(file)) {
    fail(`icons.${size} points at a missing file: ${relative}`);
    continue;
  }
  const dimensions = pngSize(file);
  if (!dimensions) fail(`icons.${size} is not a valid PNG: ${relative}`);
  else if (dimensions.width !== Number(size) || dimensions.height !== Number(size)) {
    fail(`icons.${size} is ${dimensions.width}x${dimensions.height}, expected ${size}x${size}`);
  } else pass(`icon ${size}x${size}`);
}

// --- every referenced file exists ---
const referenced = new Set();
const collect = (value) => {
  if (typeof value === 'string' && /\.(js|css|html|png|json)$/i.test(value)) referenced.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
};
collect(manifest);
let missing = 0;
for (const relative of referenced) {
  if (!fs.existsSync(path.join(dist, relative))) {
    fail(`manifest references a file that is not in the package: ${relative}`);
    missing += 1;
  }
}
if (missing === 0) pass(`all ${referenced.size} manifest file references resolve`);

// --- permissions ---
const permissions = manifest.permissions ?? [];
pass(`permissions: ${permissions.join(', ') || 'none'}`);
if (manifest.host_permissions?.length) {
  warn(`host_permissions requested up front (${manifest.host_permissions.join(', ')}) — expect extra review scrutiny`);
} else {
  pass('no host permissions requested up front');
}
if (!manifest.optional_host_permissions?.length && !manifest.host_permissions?.length
  && !manifest.content_scripts?.length) {
  warn('the extension can only ever run via activeTab — confirm that is intended');
}

// --- remote code and CSP ---
const scripts = files.filter((file) => file.endsWith('.js'));
const REMOTE_CODE = /\b(eval|importScripts)\s*\(|new\s+Function\s*\(/;
const NETWORK = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/;
let remoteHits = 0;
let networkHits = 0;
for (const relative of scripts) {
  const source = fs.readFileSync(path.join(dist, relative), 'utf8');
  if (REMOTE_CODE.test(source)) { fail(`${relative} appears to execute code from a string`); remoteHits += 1; }
  if (NETWORK.test(source)) { warn(`${relative} contains a network call`); networkHits += 1; }
  if (/\/\/[#@]\s*sourceMappingURL=/.test(source)) warn(`${relative} still references a source map`);
}
if (remoteHits === 0) pass('no eval, Function constructor or importScripts');
if (networkHits === 0) pass('no network calls anywhere in the package');

for (const relative of files.filter((file) => file.endsWith('.html'))) {
  const source = fs.readFileSync(path.join(dist, relative), 'utf8');
  if (/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(source)) {
    fail(`${relative} contains an inline script, which the MV3 CSP blocks`);
  }
  const remote = source.match(/<(?:script|link)[^>]+(?:src|href)=["'](https?:)?\/\//gi);
  if (remote) fail(`${relative} loads a remote resource: ${remote[0]}`);
  if (/\son\w+=/i.test(source)) fail(`${relative} uses an inline event handler, which the MV3 CSP blocks`);
}
pass('no inline scripts or remote resources in packaged HTML');

// --- packaging hygiene ---
const junk = files.filter((file) => /(^|\/)(\.DS_Store|Thumbs\.db|\.git|node_modules)(\/|$)/.test(file)
  || file.endsWith('.map'));
if (junk.length) fail(`package contains files that should not ship: ${junk.join(', ')}`);
else pass('no source maps or stray files in the package');

const bytes = files.reduce((total, file) => total + fs.statSync(path.join(dist, file)).size, 0);
pass(`unpacked size ${(bytes / 1024).toFixed(0)} kB across ${files.length} files`);

// --- store listing assets ---
const REQUIRED_ASSETS = [
  ['screenshot-1-grid.png', 1280, 800],
  ['screenshot-2-ranked.png', 1280, 800],
  ['screenshot-3-analysis.png', 1280, 800],
  ['screenshot-4-calculator.png', 1280, 800],
  ['screenshot-5-privacy.png', 1280, 800],
  ['promo-tile-440x280.png', 440, 280],
  ['marquee-1400x560.png', 1400, 560],
];
let assetProblems = 0;
for (const [file, width, height] of REQUIRED_ASSETS) {
  const full = path.join(assets, file);
  if (!fs.existsSync(full)) {
    warn(`listing asset missing: store/assets/${file} — run \`npm run store:assets\``);
    assetProblems += 1;
    continue;
  }
  const dimensions = pngSize(full);
  if (!dimensions || dimensions.width !== width || dimensions.height !== height) {
    fail(`store/assets/${file} must be exactly ${width}x${height}`);
    assetProblems += 1;
  }
}
if (assetProblems === 0) pass(`all ${REQUIRED_ASSETS.length} listing images present at the required sizes`);

// --- report ---
console.log('\nChrome Web Store pre-submission checks\n');
for (const message of passes) console.log(`  ✓ ${message}`);
for (const message of warnings) console.log(`  ! ${message}`);
for (const message of problems) console.log(`  ✗ ${message}`);

console.log(`\n${passes.length} passed, ${warnings.length} warning(s), ${problems.length} problem(s)`);
if (problems.length > 0) {
  console.log('\nFix the problems above before submitting.');
  process.exit(1);
}
console.log('\nReady to submit.');
