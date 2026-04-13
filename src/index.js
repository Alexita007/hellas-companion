require('dotenv').config();

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const hellasSystemPrompt = require('./systemPrompt');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());

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

app.use(express.json());

function buildSystemPrompt(candidatoId) {
  return `${hellasSystemPrompt}\n\nEl candidato activo es: ${candidatoId}.`;
}

function extractTextFromContent(content) {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/chat', async (req, res) => {
  const { messages, candidatoId } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Falta configurar ANTHROPIC_API_KEY en el entorno.',
    });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: '`messages` debe ser un arreglo no vacio.',
    });
  }

  if (!candidatoId) {
    return res.status(400).json({
      error: '`candidatoId` es obligatorio.',
    });
  }

  try {
    const systemPrompt = buildSystemPrompt(candidatoId);

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    return res.json({
      response: extractTextFromContent(response.content),
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

// Algunos entornos (tareas, integraciones) cierran stdin de inmediato; sin un
// handle activo en stdin, Node puede salir aunque el servidor HTTP siga vivo.
if (process.stdin && typeof process.stdin.resume === 'function') {
  process.stdin.resume();
}
