require('dotenv').config();

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const hellasSystemPrompt = require('./systemPrompt');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

const clientDir = path.join(__dirname, 'client');
const indexPath = path.join(clientDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`No se encuentra el cliente web: ${indexPath}`);
  process.exit(1);
}

app.get('/', (_req, res) => {
  res.type('html');
  res.sendFile(indexPath);
});

app.use(express.static(clientDir));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function buildSystemPrompt(candidatoId) {
  return `${hellasSystemPrompt}\n\nEl candidato activo es: ${candidatoId}.`;
}

function extractTextFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

// Detectar si la evaluación está completa
function detectarEvaluacionCompleta(messages) {
  const texto = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ').toLowerCase();
  const tieneG = /linaje|ancestr|origen|familia|raíz|raiz/i.test(texto);
  const tieneE = /cuerpo|heredado|herida|don|patrón|patron|epigen/i.test(texto);
  const tieneA = /principio|newen|küpan|kupan|tuwün|tuwun|yamuwün|yamuwun|itrofill/i.test(texto);
  const tieneC = /consciencia|momento|experiencia|movió|movio|algo más grande/i.test(texto);
  const tieneN = /dispuesto|biológico|biologico|post-género|post-edad|hellas planitia/i.test(texto);
  return tieneG && tieneE && tieneA && tieneC && tieneN;
}

// Extraer variable dominante
function extraerVariableDominante(messages) {
  const texto = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
  const counts = {
    G: (texto.match(/linaje|genealog|ancestr|familia/gi) || []).length,
    A: (texto.match(/principio|newen|küpan|kupan|yamuwün|tuwün/gi) || []).length,
    C: (texto.match(/consciencia|experiencia|expanded|coherencia/gi) || []).length,
    N: (texto.match(/nqot|cuántico|quantum|tsvf/gi) || []).length,
    E: (texto.match(/cuerpo|epigen|herencia|biolog/gi) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/chat', async (req, res) => {
  const { messages, candidatoId } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el entorno.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '`messages` debe ser un arreglo no vacío.' });
  }
  if (!candidatoId) {
    return res.status(400).json({ error: '`candidatoId` es obligatorio.' });
  }

  try {
    const systemPrompt = buildSystemPrompt(candidatoId);
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const replyText = extractTextFromContent(response.content);

    // Guardar en Supabase si la evaluación está completa
    if (messages.length >= 3 && process.env.SUPABASE_URL) {
      const allText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
      const isSpanish = /[áéíóúüñ]/i.test(allText);
      const varDominante = extraerVariableDominante(messages);
      const conversacionCompleta = JSON.stringify(messages.slice(-10));

      await supabase.from('aplicantes').insert({
        candidato_id: candidatoId,
        idioma: isSpanish ? 'es' : 'en',
        variable_dominante: varDominante,
        resumen_kupan: replyText.slice(0, 500),
        conversacion: conversacionCompleta,
      });
    }

    return res.json({
      response: replyText,
      content: response.content,
      model: response.model,
      stopReason: response.stop_reason,
    });
  } catch (error) {
    console.error('Error al llamar a Anthropic:', error);
    return res.status(500).json({
      error: 'No se pudo procesar la solicitud con Anthropic.',
      details: error.message,
    });
  }
});

const server = http.createServer(app);

server.on('error', (err) => {
  console.error(`No se pudo abrir el puerto ${PORT}:`, err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

if (process.stdin && typeof process.stdin.resume === 'function') {
  process.stdin.resume();
}
