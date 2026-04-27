#!/usr/bin/env node

/**
 * Web Agent Bridge CLI
 * Usage: npx web-agent-bridge [command]
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0] || 'start';

function printHelp() {
  console.log(`
  Web Agent Bridge CLI

  Usage:
    npx web-agent-bridge <command> [options]

  Commands:
    start       Start the WAB server (default)
    init        Make this site AI-discoverable — scaffold wab.json + security.txt + .env, print DNS records
    run <file>  Run an agent template (YAML)
    templates   List available agent templates
    help        Show this help message

  Options:
    --port, -p     Set server port (default: 3000)
    --server       WAB server URL (for agent templates)
    --site <url>   Canonical site URL for 'init' (default: from package.json or localhost)
    --env-only     'init' skips wab.json, only creates .env
    --force        'init' overwrites existing wab.json

  Examples:
    npx wab init                              # make this site AI-discoverable
    npx wab init --site https://example.com   # explicit site URL
    npx wab start
    npx wab start --port 4000
    npx wab-agent run olive-oil-tunisia.yaml
    npx wab-agent templates
  `);
}

switch (command) {
  case 'start': {
    const portIdx = args.indexOf('--port') !== -1 ? args.indexOf('--port') : args.indexOf('-p');
    if (portIdx !== -1 && args[portIdx + 1]) {
      process.env.PORT = args[portIdx + 1];
    }

    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }

    require('../server/index.js');
    break;
  }

  case 'init': {
    // `npx wab init` — make this site AI-discoverable in 5 minutes.
    // Scaffolds:
    //   1. ./.well-known/wab.json (the discovery contract)
    //   2. ./.well-known/security.txt (RFC 9116, helpful default)
    //   3. .env (server config, only if missing)
    //   4. Prints the exact DNS records to paste at the registrar.
    // Flags:
    //   --site <url>    Canonical site URL (default: detect or http://localhost:3000)
    //   --env-only      Only create .env, skip discovery scaffolding
    //   --force         Overwrite existing wab.json
    const flags = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--env-only') flags.envOnly = true;
      else if (args[i] === '--force') flags.force = true;
      else if (args[i] === '--site' && args[i + 1]) { flags.site = args[i + 1]; i++; }
    }

    const cwd = process.cwd();
    const envExample = path.join(__dirname, '..', '.env.example');
    const envTarget  = path.join(cwd, '.env');

    // Always handle .env
    if (fs.existsSync(envTarget)) {
      console.log('  ✓ .env already exists');
    } else if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envTarget);
      console.log('  ✓ Created .env from template');
    } else {
      const defaultEnv = 'PORT=3000\nJWT_SECRET=change-this-to-a-strong-random-secret-in-production\nNODE_ENV=development\n';
      fs.writeFileSync(envTarget, defaultEnv);
      console.log('  ✓ Created default .env');
    }

    if (flags.envOnly) break;

    // Detect site URL
    let site = flags.site;
    if (!site) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
        site = pkg.homepage || (pkg.repository && pkg.repository.url) || '';
        if (site && !/^https?:\/\//.test(site)) site = '';
      } catch { /* no pkg */ }
    }
    if (!site) site = 'http://localhost:3000';
    site = site.replace(/\/$/, '');

    let host = site;
    try { host = new URL(site).hostname; } catch { /* keep as-is */ }
    const apex = host.replace(/^www\./, '').split('.').slice(-2).join('.') || host;

    // 1. wab.json scaffold
    const wabDir = path.join(cwd, '.well-known');
    const wabFile = path.join(wabDir, 'wab.json');
    if (!fs.existsSync(wabFile) || flags.force) {
      if (!fs.existsSync(wabDir)) fs.mkdirSync(wabDir, { recursive: true });
      const wabJson = {
        version: '1.0',
        protocol: 'wab',
        site: site,
        endpoints: {
          discover: site + '/.well-known/wab.json',
          api: site + '/api/wab',
          actions: site + '/api/wab/actions'
        },
        capabilities: ['readContent', 'click', 'scroll', 'extractData'],
        permissions: { fillForms: false, automatedLogin: false, navigate: false },
        rate_limit: { requests_per_minute: 60 },
        contact: { security: site + '/.well-known/security.txt' },
        ai_friendly: true,
        generated_by: 'npx wab init',
        generated_at: new Date().toISOString()
      };
      fs.writeFileSync(wabFile, JSON.stringify(wabJson, null, 2));
      console.log('  ✓ Created .well-known/wab.json');
    } else {
      console.log('  ✓ .well-known/wab.json already exists (use --force to overwrite)');
    }

    // 2. security.txt scaffold (only if missing)
    const secFile = path.join(wabDir, 'security.txt');
    if (!fs.existsSync(secFile)) {
      const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const sec =
        'Contact: mailto:security@' + apex + '\n' +
        'Expires: ' + expires + '\n' +
        'Preferred-Languages: en, ar\n' +
        'Canonical: ' + site + '/.well-known/security.txt\n';
      fs.writeFileSync(secFile, sec);
      console.log('  ✓ Created .well-known/security.txt');
    }

    // 3. Print DNS records
    console.log('');
    console.log('  ───────────────────────────────────────────────────────────');
    console.log('  Make your site AI-discoverable — paste these at your DNS panel:');
    console.log('  ───────────────────────────────────────────────────────────');
    console.log('');
    console.log('  Type   Name            Value');
    console.log('  ────   ─────────────   ──────────────────────────────────────────────');
    console.log('  TXT    _wab            v=wab1; endpoint=' + site + '/.well-known/wab.json');
    console.log('  TXT    _wab-trust      trust=' + site + '/trust.json; security=' + site + '/.well-known/security.txt');
    console.log('  TXT    _wab-agent      agent=' + site + '/agent-bridge.json; ver=2');
    console.log('');
    console.log('  Apex domain detected: ' + apex);
    console.log('  Verify after propagation: https://webagentbridge.com/dns#verifier');
    console.log('');
    console.log('  ✓ Done. Your site speaks WAB. Run `npx wab start` to launch the local server.');
    console.log('');
    break;
  }

  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;

  case 'run': {
    const templateArg = args[1];
    if (!templateArg) {
      console.error('  Error: Please specify a template file.');
      console.error('  Usage: npx wab-agent run <template.yaml> [--param value ...]');
      console.error('  Run "npx wab-agent templates" to see available templates.');
      process.exit(1);
    }
    const runner = require('./agent-runner');
    const cliParams = {};
    for (let i = 2; i < args.length; i++) {
      if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
        cliParams[args[i].slice(2)] = args[i + 1];
        i++;
      }
    }
    runner.run(templateArg, cliParams).catch(function(err) {
      console.error('  Agent error:', err.message);
      process.exit(1);
    });
    break;
  }

  case 'templates': {
    const templatesDir = path.join(__dirname, '..', 'templates');
    if (!fs.existsSync(templatesDir)) {
      console.log('  No templates directory found.');
      process.exit(0);
    }
    const files = fs.readdirSync(templatesDir).filter(function(f) { return f.endsWith('.yaml') || f.endsWith('.yml'); });
    if (files.length === 0) {
      console.log('  No templates found.');
      process.exit(0);
    }
    console.log('\n  Available Agent Templates:\n');
    console.log('  ' + '─'.repeat(70));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(templatesDir, file), 'utf8');
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const name = nameMatch ? nameMatch[1].trim() : file.replace(/\.ya?ml$/, '');
        const desc = descMatch ? descMatch[1].trim() : '';
        console.log(`  ${name.padEnd(30)} ${desc.slice(0, 50)}`);
      } catch(e) {
        console.log(`  ${file}`);
      }
    }
    console.log('  ' + '─'.repeat(70));
    console.log(`\n  Run: npx wab-agent run <template-name>.yaml\n`);
    break;
  }

  default:
    console.error(`  Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
