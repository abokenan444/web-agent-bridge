'use strict';

/**
 * Anthropic Claude tool-use example agent that uses the WAB system prompt
 * and WABLiveTool to safely interact with a third-party site.
 *
 * Prerequisites:
 *   npm install @anthropic-ai/sdk web-agent-bridge
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *
 * Run:
 *   node examples/anthropic-tools-agent.js "Place an order on shop.example.com"
 */

const Anthropic = require('@anthropic-ai/sdk');
const { systemPrompt, WABLiveTool } = require('web-agent-bridge');

const client = new Anthropic();
const tool = new WABLiveTool({ agentName: 'wab-anthropic-demo/1' });

const CLAUDE_TOOL_SCHEMA = [{
  name: tool.name,
  description: tool.description,
  input_schema: tool.schema
}];

async function run(userTask) {
  const messages = [{ role: 'user', content: userTask }];
  const system = systemPrompt({ agentName: 'wab-anthropic-demo', agentVersion: '1.0' });

  for (let step = 0; step < 6; step++) {
    const reply = await client.messages.create({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1024,
      system,
      tools: CLAUDE_TOOL_SCHEMA,
      messages
    });

    messages.push({ role: 'assistant', content: reply.content });

    if (reply.stop_reason !== 'tool_use') {
      const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      console.log('\n=== Final answer ===\n' + text);
      return text;
    }

    const toolUses = reply.content.filter(b => b.type === 'tool_use');
    const results = [];
    for (const tu of toolUses) {
      console.log(`→ tool call: ${tu.name} ${JSON.stringify(tu.input)}`);
      const out = await (tool.invoke ? tool.invoke(tu.input) : tool._call(tu.input));
      console.log('← tool result:', String(out).slice(0, 280));
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
  }
  console.warn('Max steps reached without a final answer.');
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ') || 'Search shop.example.com for olive oil';
  run(task).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
