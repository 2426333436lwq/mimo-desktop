const cfg = JSON.parse(require('fs').readFileSync('data/config.json', 'utf-8'));
const url = `${cfg.apiEndpoint.replace(/\/$/, '')}/chat/completions`;

async function test(model, maxTokens, label) {
  const body = { model, messages: [{ role: 'user', content: '可以在html界面打开的贪吃蛇游戏' }], temperature: 0.7, max_tokens: maxTokens, stream: true };
  const timeout = setTimeout(() => { console.log(`${label}: 挂起超时`); process.exit(2); }, 30000);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) });
  clearTimeout(timeout);
  if (!res.ok) { console.log(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 150)}`); return; }
  const reader = res.body.getReader(); const decoder = new TextDecoder();
  let buf = '', content = '', reasoning = '', finish = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const ls = buf.split('\n'); buf = ls.pop();
    for (const l of ls) {
      const t = l.trim();
      if (!t.startsWith('data:')) continue;
      const d = t.slice(5).trim();
      if (d === '[DONE]') { finish = 'DONE'; continue; }
      try {
        const c = JSON.parse(d);
        const ch = c.choices?.[0]?.delta || {};
        if (ch.content) content += ch.content;
        if (ch.reasoning_content) reasoning += ch.reasoning_content;
        if (c.choices?.[0]?.finish_reason) finish = c.choices[0].finish_reason;
      } catch {}
    }
  }
  console.log(`${label}: content=${content.length}字 reasoning=${reasoning.length}字 finish=${finish} | ${content.slice(0, 30)}`);
}
(async () => {
  await test('mimo-v2.5-pro', 4096, 'pro+4096');
  await test('mimo-v2.5-pro', 8192, 'pro+8192');
  await test('mimo-v2.5', 4096, 'v2.5+4096');
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
