#!/usr/bin/env node
/**
 * wab-init — Zero-Config WAB initializer
 *
 * Usage:
 *   npx wab-init                     # interactive
 *   npx wab-init --site=https://acme.com --name="Acme" --yes
 *
 * Detects project type (Next.js, Nuxt, Laravel, WordPress, static) and
 * scaffolds /.well-known/wab.json with sensible defaults plus prints
 * platform-specific DNS TXT instructions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ARG = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...rest] = a.slice(2).split('=');
      out[k] = rest.length ? rest.join('=') : true;
    } else out._.push(a);
  }
  return out;
}

function ask(rl, q, def) {
  return new Promise((resolve) => {
    const prompt = def ? `${q} [${def}]: ` : `${q}: `;
    rl.question(prompt, (ans) => resolve((ans || '').trim() || def || ''));
  });
}

/* ------------------------------------------------------------------ */
/* Project detection                                                  */
/* ------------------------------------------------------------------ */

function detectProject(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f));
  const pkgPath = path.join(cwd, 'package.json');
  let pkg = null;
  if (has('package.json')) {
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch {}
  }
  const deps = pkg ? Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {}) : {};

  if (deps.next) return { type: 'nextjs', pkg };
  if (deps.nuxt || deps.nuxt3 || deps['nuxt-edge']) return { type: 'nuxt', pkg };
  if (deps['@sveltejs/kit']) return { type: 'sveltekit', pkg };
  if (deps.astro) return { type: 'astro', pkg };
  if (deps.gatsby) return { type: 'gatsby', pkg };
  if (deps['react-scripts'] || deps.vite) return { type: 'spa', pkg };
  if (has('wp-config.php') || has('wp-content')) return { type: 'wordpress', pkg };
  if (has('artisan') && has('composer.json')) return { type: 'laravel', pkg };
  if (has('composer.json')) return { type: 'php', pkg };
  if (has('manage.py')) return { type: 'django', pkg };
  if (has('Gemfile')) return { type: 'rails', pkg };
  if (pkg) return { type: 'node', pkg };
  return { type: 'static', pkg: null };
}

function publicDirFor(type, cwd) {
  const candidates = {
    nextjs: ['public'],
    nuxt: ['public', 'static'],
    sveltekit: ['static'],
    astro: ['public'],
    gatsby: ['static'],
    spa: ['public'],
    wordpress: ['.'],
    laravel: ['public'],
    php: ['public', '.'],
    django: ['static'],
    rails: ['public'],
    node: ['public', '.'],
    static: ['.']
  };
  for (const c of candidates[type] || ['.']) {
    if (fs.existsSync(path.join(cwd, c))) return c;
  }
  return '.';
}

/* ------------------------------------------------------------------ */
/* wab.json builder                                                    */
/* ------------------------------------------------------------------ */

function buildWabJson({ siteUrl, name, description, projectType }) {
  const baseActions = [
    { name: 'home', description: 'Open homepage', url: siteUrl }
  ];

  // Project-aware default action hints (heuristic, user can edit).
  const hints = {
    wordpress: [
      { name: 'browseBlog', description: 'Browse blog posts', url: `${siteUrl}/?feed=rss2` },
      { name: 'searchSite', description: 'Search the site', urlTemplate: `${siteUrl}/?s={query}` }
    ],
    nextjs: [
      { name: 'browseSitemap', description: 'Site URL inventory', url: `${siteUrl}/sitemap.xml` }
    ],
    laravel: [
      { name: 'browseSitemap', description: 'Site URL inventory', url: `${siteUrl}/sitemap.xml` }
    ],
    static: []
  };

  return {
    version: '1.0',
    site: name,
    description: description || `${name} — managed by Web Agent Bridge`,
    url: siteUrl,
    project_type: projectType,
    generated_at: new Date().toISOString(),
    generator: 'wab-init',
    discovery: {
      well_known: `${siteUrl}/.well-known/wab.json`,
      dns_txt_record: `_wab.${new URL(siteUrl).hostname}`
    },
    actions: [...baseActions, ...(hints[projectType] || [])],
    trust: {
      signed: false,
      note: 'Run `npm run wab:sign` (or scripts/sign-wab-domain.js) to add an Ed25519 signature.'
    }
  };
}

/* ------------------------------------------------------------------ */
/* DNS instructions                                                   */
/* ------------------------------------------------------------------ */

function dnsInstructions(host) {
  return `
DNS Discovery (recommended for full WAB Trust):
  Add this TXT record at your DNS provider:

    Name:  _wab.${host}
    Type:  TXT
    Value: v=wab1; well-known=https://${host}/.well-known/wab.json

Cloudflare:    DNS → Records → Add record (Type=TXT)
Route 53:      Hosted zones → Create record (Type=TXT)
Namecheap:     Advanced DNS → Add New Record (Type=TXT)
GoDaddy:       DNS Management → Add → TXT
cPanel:        Zone Editor → Add Record → TXT

After publishing, verify at:
  https://www.webagentbridge.com/check?host=${host}
`;
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const cwd = process.cwd();
  const detected = detectProject(cwd);
  console.log(`\n  Web Agent Bridge — wab-init`);
  console.log(`  Detected project: ${detected.type}` +
              (detected.pkg && detected.pkg.name ? ` (${detected.pkg.name})` : '') + '\n');

  let siteUrl = ARG.site || ARG.url;
  let name = ARG.name;
  let description = ARG.description;

  if (!ARG.yes && (!siteUrl || !name)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      siteUrl = siteUrl || await ask(rl, 'Site URL (https://example.com)', 'https://example.com');
      name = name || await ask(rl, 'Site name', detected.pkg && detected.pkg.name || 'My Site');
      description = description || await ask(rl, 'Short description', '');
    } finally {
      rl.close();
    }
  }

  if (!siteUrl) siteUrl = 'https://example.com';
  if (!name) name = (detected.pkg && detected.pkg.name) || 'My Site';

  // Normalize URL
  if (!/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`;
  siteUrl = siteUrl.replace(/\/+$/, '');
  const host = new URL(siteUrl).hostname;

  const wab = buildWabJson({ siteUrl, name, description, projectType: detected.type });

  const pubDir = publicDirFor(detected.type, cwd);
  const wellKnownDir = path.join(cwd, pubDir, '.well-known');
  const wabPath = path.join(wellKnownDir, 'wab.json');

  if (fs.existsSync(wabPath) && !ARG.force && !ARG.yes) {
    console.log(`\n  ! ${path.relative(cwd, wabPath)} already exists. Use --force to overwrite.`);
    process.exit(2);
  }

  fs.mkdirSync(wellKnownDir, { recursive: true });
  fs.writeFileSync(wabPath, JSON.stringify(wab, null, 2) + '\n');

  console.log(`\n  Wrote: ${path.relative(cwd, wabPath)}`);
  console.log(`  URL:   ${siteUrl}/.well-known/wab.json`);
  console.log(dnsInstructions(host));
  console.log(`  Next steps:`);
  console.log(`    1. Deploy your site so /.well-known/wab.json is publicly reachable.`);
  console.log(`    2. Add the DNS TXT record above.`);
  console.log(`    3. (Optional) Sign with Ed25519: see scripts/sign-wab-domain.js`);
  console.log(`    4. Verify: https://www.webagentbridge.com/check?host=${host}\n`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('wab-init failed:', e.message);
    process.exit(1);
  });
}

module.exports = { detectProject, buildWabJson, publicDirFor };
