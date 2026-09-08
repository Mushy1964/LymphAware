import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', '.netlify']);
const errors = [];
const warnings = [];
let standaloneScriptCount = 0;
let htmlFileCount = 0;
let inlineScriptCount = 0;

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function nodeCheck(file, label = relative(file)) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    errors.push(`${label}: ${String(result.stderr || result.stdout || 'JavaScript syntax check failed').trim()}`);
  }
}

function checkStandaloneScript(file) {
  standaloneScriptCount += 1;
  nodeCheck(file);
}

function checkInlineScripts(file, html) {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptNumber = 0;

  while ((match = scriptPattern.exec(html))) {
    const attributes = match[1] || '';
    const script = match[2] || '';
    if (/\bsrc\s*=\s*["']/i.test(attributes)) continue;

    const typeMatch = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const type = String(typeMatch?.[1] || 'text/javascript').toLowerCase();
    if (type.includes('json') || (!type.includes('javascript') && type !== 'module' && type !== 'text/ecmascript')) continue;
    if (!script.trim()) continue;

    scriptNumber += 1;
    inlineScriptCount += 1;
    const extension = type === 'module' ? '.mjs' : '.js';
    const temporaryFile = path.join(os.tmpdir(), `lymphaware-audit-${process.pid}-${htmlFileCount}-${scriptNumber}${extension}`);
    fs.writeFileSync(temporaryFile, script, 'utf8');
    nodeCheck(temporaryFile, `${relative(file)} inline script ${scriptNumber}`);
    fs.rmSync(temporaryFile, { force: true });
  }
}

function checkDuplicateIds(file, html) {
  const ids = new Map();
  const idPattern = /\bid\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = idPattern.exec(html))) {
    const id = match[1];
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  for (const [id, count] of ids) {
    if (count > 1) errors.push(`${relative(file)}: duplicate id="${id}" appears ${count} times.`);
  }
}

function checkHtml(file) {
  htmlFileCount += 1;
  const html = fs.readFileSync(file, 'utf8');
  checkInlineScripts(file, html);
  checkDuplicateIds(file, html);
}

function checkProjectConsistency() {
  const checkoutPath = path.join(root, 'netlify/functions/create-checkout-session.mjs');
  const portalPath = path.join(root, 'portal/index.html');
  const translationPath = path.join(root, 'netlify/functions/refresh-language-translations-background.mjs');
  const publicProfilePath = path.join(root, 'p-v3/index.html');

  const checkout = fs.readFileSync(checkoutPath, 'utf8');
  const portal = fs.readFileSync(portalPath, 'utf8');
  const translation = fs.readFileSync(translationPath, 'utf8');
  const publicProfile = fs.readFileSync(publicProfilePath, 'utf8');

  for (const [code, name] of [['FR', 'French'], ['ES', 'Spanish'], ['DE', 'German']]) {
    if (!checkout.includes(`${code}: '${name}'`)) errors.push(`Checkout language configuration is missing ${name} (${code}).`);
    if (!portal.includes(`${code}:'${name}'`) && !portal.includes(`${code}: '${name}'`)) errors.push(`Portal language configuration is missing ${name} (${code}).`);
    if (!translation.includes(`${code}: '${name}'`)) errors.push(`Translation worker is missing ${name} (${code}).`);
    if (!publicProfile.includes(`${code}:{`)) errors.push(`Public QR profile is missing fixed ${name} (${code}) wording.`);
  }

  if (!checkout.includes("if (band === 'UK') return 299") || !checkout.includes("if (band === 'EUROPE') return 499") || !checkout.includes('return 999')) {
    errors.push('Checkout postage rates do not match £2.99 UK / £4.99 Europe / £9.99 Rest of World.');
  }
  if (!portal.includes('SHIPPING_PRICES={UK:299,EUROPE:499,REST_OF_WORLD:999}')) {
    errors.push('Portal postage rates do not match £2.99 UK / £4.99 Europe / £9.99 Rest of World.');
  }
  if (!checkout.includes('amountPence: 650')) errors.push('Checkout additional card/lanyard price is not £6.50.');

  const allText = walk(root)
    .filter(file => /\.(html|js|mjs|css|md)$/i.test(file))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
  if (allText.includes('£5.00') || allText.includes('£7.50')) errors.push('An obsolete £5.00 or £7.50 accessory price remains in the repository.');
  if (/temporary postage rates|these temporary rates/i.test(allText)) warnings.push('Customer-facing copy still describes the agreed postage rates as temporary.');
}

const files = walk(root);
for (const file of files) {
  if (/\.(mjs|js)$/i.test(file)) checkStandaloneScript(file);
  else if (/\.html$/i.test(file)) checkHtml(file);
}
checkProjectConsistency();

console.log(`Checked ${standaloneScriptCount} standalone JavaScript files, ${inlineScriptCount} inline scripts and ${htmlFileCount} HTML files.`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);

if (errors.length) {
  console.error(`\n${errors.length} audit error(s) found:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('LymphAware repository audit passed.');
