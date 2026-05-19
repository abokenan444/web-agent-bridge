'use strict';

/**
 * OpenAI tool-calling example agent that uses the WAB system prompt
 * and WABLiveTool to safely interact with a third-party site.
 *
 * Prerequisites:
 *   npm install openai web-agent-bridge
 *   export OPENAI_API_KEY=sk-...
 *
 * Run:
 *   node examples/openai-tools-agent.js "Search shop.example.com for olive oil"
 */

const OpenAI = require('openai');
const { systemPrompt, WABLiveTool } = require('web-agent-bridge');

const client = new OpenAI();
const tool = new WABLiveTool({ agentName: 'wab-openai-demo/1' });

const OPENAI_TOOL_SCHEMA = [{
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.schema
  }
}];

async function run(userTask) {
  const messages = [
    { role: 'system', content: systemPrompt({ agentName: 'wab-openai-demo', agentVersion: '1.0' }) },
    { role: 'user', content: userTask }
  ];

  for (let step = 0; step < 6; step++) {
    const reply = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: OPENAI_TOOL_SCHEMA,
      tool_choice: 'auto'
    });

    const msg = reply.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log('\n=== Final answer ===\n' + msg.content);
      return msg.content;
    }

    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { /* ignore */ }
      console.log(`→ tool call: ${tc.function.name} ${JSON.stringify(args)}`);
      const out = await (tool.invoke ? tool.invoke(args) : tool._call(args));
      console.log('← tool result:', String(out).slice(0, 280));
      messages.push({ role: 'tool', tool_call_id: tc.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
    }
  }
  console.warn('Max steps reached without a final answer.');
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ') || 'Search shop.example.com for olive oil';
  run(task).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
