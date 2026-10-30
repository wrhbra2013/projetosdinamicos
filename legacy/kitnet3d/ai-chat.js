'use strict';
/* KitNet AI — chat com SmolLM2-135M-Instruct (GGUF) rodando via wllama (llama.cpp WASM).
   Tudo carregado de CDN (Hugging Face + jsDelivr) e cacheados no navegador:
   nenhum binário vive no repositório. Detalhes: https://github.com/ngxson/wllama */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.6.1/esm/index.min.js';

const MODEL_URL = 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_0.gguf';

const $ = (id) => document.getElementById(id);
const logEl = $('log'), errEl = $('err'), inp = $('inp'), send = $('send');
const barWrap = $('barwrap'), bar = $('bar'), progLabel = $('progLabel');

const SYS_PROMPT =
  'You are a helpful assistant for the KitNet 3D project, a floor-plan tool. ' +
  'Answer briefly (max 3 sentences), in Brazilian Portuguese when possible.';

let wllama = null;

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function setBusy(busy) {
  inp.disabled = busy;
  send.disabled = busy;
  send.textContent = busy ? '…' : 'Enviar';
}

function showErr(text) {
  errEl.style.display = 'block';
  errEl.textContent = '⚠️ ' + text;
}

function setProgress(pct, label) {
  bar.style.width = pct + '%';
  progLabel.textContent = label || pct.toFixed(0) + '%';
}

async function init() {
  barWrap.classList.add('show');
  progLabel.classList.add('show');
  setProgress(0, 'Baixando engine WASM (wllama) do CDN…');

  wllama = new Wllama({}, { useMultiThread: false });
  wllama.setCompat('default');

  await wllama.loadModelFromUrl(MODEL_URL, {
    progressCallback: ({ loaded, total }) => {
      const mb = (loaded / 1048576).toFixed(0);
      if (total) {
        setProgress((loaded / total) * 100, `Modelo: ${mb} MB de ${(total / 1048576).toFixed(0)} MB`);
      } else {
        setProgress(Math.min(100, loaded / 1048576), `Modelo: ${mb} MB baixados…`);
      }
    },
  });

  addMsg('sys', 'IA pronta — rodando 100% no navegador. Faça sua pergunta!');
  barWrap.classList.remove('show');
  progLabel.classList.remove('show');
  setBusy(false);
}

async function ask(text) {
  addMsg('user', text);
  setBusy(true);
  addMsg('ai', '');
  const outEl = logEl.lastElementChild;
  try {
    const stream = await wllama.createChatCompletion({
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 200,
      temperature: 0.6,
      top_k: 40,
      top_p: 0.9,
      stream: true,
    });
    for await (const chunk of stream) {
      const piece = chunk.choices[0]?.delta?.content;
      if (piece) outEl.textContent += piece;
      logEl.scrollTop = logEl.scrollHeight;
    }
  } catch (e) {
    console.error(e);
    outEl.textContent = '(erro)';
    showErr(e.message || String(e));
  }
  setBusy(false);
}

send.onclick = () => {
  const text = inp.value.trim();
  if (text) { inp.value = ''; ask(text); }
};
inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });

init().catch((e) => {
  console.error(e);
  showErr('Não deu para iniciar a IA: ' + (e.message || String(e)));
});