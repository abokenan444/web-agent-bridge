/**
 * Example: Using WAB sites via the MCP adapter
 *
 * The WAB-MCP adapter exposes every WAB site action as an MCP tool,
 * so any MCP-compatible AI agent (Claude, GPT, etc.) can interact
 * with WAB-enabled websites through a uniform tool interface.
 *
 * Usage:
 *   node examples/mcp-agent.js <site-url>
 */

const { WABMCPAdapter } = require('../wab-mcp-adapter');

const TARGET = process.argv[2] || 'http://localhost:3000';

async function main() {
  console.log('\n  WAB → MCP Adapter Demo');
  console.log(`  Target: ${TARGET}\n`);

  const adapter = new WABMCPAdapter({
    siteUrl: TARGET,
    transport: 'http'
  });

  // Step 1: Discover site capabilities
  console.log('1. Discovering WAB capabilities...');
  const discovery = await adapter.discover();
  if (discovery) {
    console.log(`   Provider: ${discovery.provider?.name || 'unknown'}`);
    console.log(`   Domain:   ${discovery.provider?.domain || 'unknown'}`);
    console.log(`   Tier:     ${discovery.capabilities?.tier || 'free'}`);
    console.log(`   Features: ${(discovery.capabilities?.features || []).join(', ')}`);
    if (discovery.fairness) {
      console.log(`   Fairness: score=${discovery.fairness.neutrality_score}, independent=${discovery.fairness.is_independent}`);
    }
  } else {
    console.log('   No discovery document found (site may not have WAB configured)');
  }

  // Step 2: List MCP tools
  console.log('\n2. Available MCP tools:');
  const tools = await adapter.getTools();
  tools.forEach(tool => {
    const params = tool.input_schema?.properties
      ? Object.keys(tool.input_schema.properties).join(', ')
      : 'none';
    console.log(`   - ${tool.name}: ${tool.description} (params: ${params})`);
  });

  // Step 3: Execute built-in tools
  console.log('\n3. Executing wab_get_page_info...');
  try {
    const info = await adapter.executeTool('wab_get_page_info', {});
    console.log(`   Title:   ${info.title || 'N/A'}`);
    console.log(`   Version: ${info.bridgeVersion || 'N/A'}`);
  } catch (err) {
    console.log(`   (Requires bridge script on page: ${err.message})`);
  }

  // Step 4: Search the fairness registry
  console.log('\n4. Fairness-weighted search (demo):');
  try {
    const search = await adapter.executeTool('wab_fairness_search', {
      query: 'e-commerce',
      limit: 5
    });
    if (search.results?.length) {
      search.results.forEach(r => {
        console.log(`   - ${r.name} (${r.domain}) — score: ${r.final_score}`);
      });
    } else {
      console.log('   No sites registered in directory yet.');
    }
  } catch (err) {
    console.log(`   Registry not available: ${err.message}`);
  }

  console.log('\nDone. In a real MCP integration, these tools would be');
  console.log('exposed to Claude/GPT via the MCP tool-use protocol.\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
