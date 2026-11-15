// Run: ANTHROPIC_API_KEY=... APP_KEY=... node index.js   (package.json needs "type": "module")
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
const up = multer({ limits: { fileSize: 25e6 } });
const ai = new Anthropic(); // reads ANTHROPIC_API_KEY, which never leaves the server
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';

const SHAPE = `{"blocks":[{"type":"heading|paragraph|list|table|note","level":1,"align":"left|center|right","text":"","items":[""],"rows":[[""]]}]}`;
const img = (f) => ({ type: 'image', source: { type: 'base64', media_type: f.mimetype || 'image/jpeg', data: f.buffer.toString('base64') } });

async function ask(system, content) {
  const r = await ai.messages.create({ model: MODEL, max_tokens: 8000, system, messages: [{ role: 'user', content }] });
  const t = r.content.map((c) => c.text || '').join('');
  return JSON.parse(t.replace(/```json|```/g, '').trim());
}

app.use((q, s, next) => (q.headers['x-app-key'] === process.env.APP_KEY ? next() : s.sendStatus(401)));

// Pass 1: OCR + layout understanding -> structured blocks in reading order
app.post('/extract', up.single('image'), async (q, s) => {
  try {
    s.json(await ask(
      `You rebuild scanned pages as structured documents. Keep every word, number and symbol exactly as printed; write [?] for anything unreadable. Reading order, top to bottom. Return ONLY JSON shaped like ${SHAPE}`,
      [img(q.file), { type: 'text', text: 'Transcribe and structure this page.' }]));
  } catch (e) { s.status(500).json({ error: String(e) }); }
});

// Pass 2: quality control. Compare draft to the image and correct mistakes
app.post('/verify', up.single('image'), async (q, s) => {
  try {
    s.json(await ask(
      `You are a meticulous proofreader of document reconstructions. Compare the draft to the page word by word, checking numbers, tables, headings and order. Fix every error or omission. Return ONLY JSON shaped like {"fixes":["short description of each correction"],"blocks":[...same block shape as ${SHAPE}...]}`,
      [img(q.file), { type: 'text', text: `Draft blocks:\n${q.body.doc}` }]));
  } catch (e) { s.status(500).json({ error: String(e) }); }
});

app.listen(process.env.PORT || 8787);
