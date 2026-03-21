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
    help        Show this help message

  Options:
    --port, -p  Set server port (default: 3000)

  Examples:
    npx web-agent-bridge start
    npx web-agent-bridge start --port 4000
    npx web-agent-bridge init
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

  default:
    console.error(`  Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
