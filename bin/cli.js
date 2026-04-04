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
    init        Create .env file from template
    run <file>  Run an agent template (YAML)
    templates   List available agent templates
    help        Show this help message

  Options:
    --port, -p  Set server port (default: 3000)
    --server    WAB server URL (for agent templates)

  Examples:
    npx web-agent-bridge start
    npx web-agent-bridge start --port 4000
    npx web-agent-bridge init
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
    const envExample = path.join(__dirname, '..', '.env.example');
    const envTarget = path.join(process.cwd(), '.env');

    if (fs.existsSync(envTarget)) {
      console.log('  .env file already exists. Skipping.');
    } else if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envTarget);
      console.log('  Created .env file from template.');
      console.log('  Edit .env to set your JWT_SECRET before starting.');
    } else {
      const defaultEnv = 'PORT=3000\nJWT_SECRET=change-this-to-a-strong-random-secret-in-production\nNODE_ENV=development\n';
      fs.writeFileSync(envTarget, defaultEnv);
      console.log('  Created default .env file.');
    }
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
