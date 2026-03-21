/**
 * Example: Vision-based AI Agent using WAB
 *
 * This agent demonstrates how a "vision" or "natural language" AI agent
 * (like OpenAI Operator, Claude Computer Use, etc.) can interact with
 * WAB using descriptive intent instead of explicit action names.
 *
 * The agent describes what it wants to do in natural language,
 * and the IntentResolver matches it to available WAB actions.
 *
 * Prerequisites:
 *   npm install puppeteer
 *
 * Usage:
 *   node examples/vision-agent.js <url>
 */

const puppeteer = require('puppeteer');

const TARGET_URL = process.argv[2] || 'http://localhost:3000';

// ─── Intent Resolver: maps natural language to WAB actions ────────────
class IntentResolver {
  constructor(actions) {
    this.actions = actions;
  }

  /**
   * Find the best matching action for a natural language intent.
   * Uses keyword matching and description similarity.
   * @param {string} intent — Natural language description (e.g., "sign up for an account")
   * @returns {{ action: object, confidence: number } | null}
   */
  resolve(intent) {
    const intentLower = intent.toLowerCase();
    const intentWords = intentLower.split(/\s+/);
    let bestMatch = null;
    let bestScore = 0;

    for (const action of this.actions) {
      const descLower = (action.description + ' ' + action.name).toLowerCase();
      let score = 0;

      // Exact name match
      if (intentLower.includes(action.name.replace(/_/g, ' '))) {
        score += 5;
      }

      // Word overlap scoring
      for (const word of intentWords) {
        if (word.length < 3) continue;
        if (descLower.includes(word)) score += 1;
      }

      // Category bonus
      if (action.category === 'navigation' && /navigate|go to|open|visit/i.test(intent)) score += 2;
      if (action.trigger === 'fill_and_submit' && /fill|submit|sign up|register|login|form/i.test(intent)) score += 2;
      if (action.trigger === 'click' && /click|press|tap|select|button/i.test(intent)) score += 1;

      // Synonym matching
      const synonyms = {
        'sign up': ['register', 'create account', 'signup'],
        'log in': ['login', 'sign in', 'signin'],
        'search': ['find', 'look for', 'query'],
        'submit': ['send', 'post', 'confirm'],
        'navigate': ['go to', 'open', 'visit']
      };

      for (const [key, syns] of Object.entries(synonyms)) {
        if (syns.some(s => intentLower.includes(s)) && descLower.includes(key)) score += 3;
        if (intentLower.includes(key) && syns.some(s => descLower.includes(s))) score += 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = action;
      }
    }

    if (!bestMatch || bestScore < 1) return null;

    const confidence = Math.min(1, bestScore / 10);
    return { action: bestMatch, confidence };
  }
}

// ─── Vision Agent ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n👁️  WAB Vision Agent`);
  console.log(`   Target: ${TARGET_URL}\n`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });
  console.log(`✓ Page loaded: ${await page.title()}`);

  // Wait for bridge
  await page.waitForFunction(() => typeof window.AICommands !== 'undefined', { timeout: 10000 });
  console.log('✓ WAB bridge detected\n');

  // Get available actions
  const actions = await page.evaluate(() => window.AICommands.getActions());
  const resolver = new IntentResolver(actions);

  console.log(`📋 Available actions: ${actions.length}`);
  actions.forEach(a => console.log(`   • ${a.name} — ${a.description}`));

  // ── Simulate vision agent intents ─────────────────────────────────
  const intents = [
    'I want to create a new account',
    'Take me to the documentation page',
    'Click the login button',
    'Show me the dashboard'
  ];

  console.log('\n🧠 Resolving natural language intents:\n');

  for (const intent of intents) {
    const match = resolver.resolve(intent);

    if (match) {
      console.log(`  Intent: "${intent}"`);
      console.log(`  → Action: ${match.action.name} (${match.action.trigger})`);
      console.log(`  → Confidence: ${(match.confidence * 100).toFixed(0)}%`);
      console.log(`  → Description: ${match.action.description}`);

      // Execute if confidence is high enough
      if (match.confidence >= 0.3) {
        const result = await page.evaluate(
          (name) => window.AICommands.execute(name),
          match.action.name
        );
        console.log(`  → Executed: ${result.success ? '✓' : '✗ ' + result.error}`);
      } else {
        console.log(`  → Skipped: confidence too low`);
      }
    } else {
      console.log(`  Intent: "${intent}"`);
      console.log(`  → No matching action found`);
    }
    console.log('');
  }

  // ── Demonstrate page info with security context ───────────────────
  const pageInfo = await page.evaluate(() => window.AICommands.getPageInfo());
  console.log('📊 Page Info:');
  console.log(`   Security sandbox: ${pageInfo.security.sandboxActive ? '✓ Active' : '✗ Inactive'}`);
  console.log(`   Self-healing: ${pageInfo.selfHealing.tracked} tracked, ${pageInfo.selfHealing.healed} healed`);
  console.log(`   Stealth mode: ${pageInfo.stealthMode ? 'Enabled' : 'Disabled'}`);

  console.log('\n✓ Vision agent session complete.');
  await browser.close();
}

main().catch((err) => {
  console.error('Agent error:', err.message);
  process.exit(1);
});
