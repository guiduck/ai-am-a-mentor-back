# 🎵 FFmpeg Setup para Extração de Áudio

## Por que precisamos do FFmpeg?

O serviço de transcrição agora extrai automaticamente o áudio de vídeos grandes (>25MB) para reduzir o tamanho do arquivo antes de enviar para a API da OpenAI Whisper. Isso permite transcrever vídeos de qualquer tamanho.

## Instalação no Render.com

### Opção 1: Build Script (Recomendado)

Adicione ao seu `package.json`:

```json
{
  "scripts": {
    "build": "apt-get update && apt-get install -y ffmpeg && npm install && npx drizzle-kit migrate --config=drizzle.prod.config.cjs"
  }
}
```

### Opção 2: Render Build Command

No painel do Render, configure o **Build Command**:

```bash
apt-get update && apt-get install -y ffmpeg && npm install && npx drizzle-kit migrate --config=drizzle.prod.config.cjs
```

### Opção 3: Dockerfile (Alternativa)

Se preferir usar Docker, crie um `Dockerfile`:

```dockerfile
FROM node:20-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["npm", "start"]
```

## Verificação

O serviço verifica automaticamente se o FFmpeg está disponível. Se não estiver, retornará um erro informativo.

## Como Funciona

1. **Vídeo < 25MB**: Envia diretamente para Whisper
2. **Vídeo > 25MB**: 
   - Extrai áudio usando FFmpeg
   - Converte para MP3 (16kHz, mono, 64kbps)
   - Áudio geralmente fica < 5MB mesmo para vídeos de 100MB+
   - Envia áudio para Whisper

## Redução de Tamanho

Exemplo:
- Vídeo original: 30MB
- Áudio extraído: ~2-3MB
- Redução: ~90%

Isso permite transcrever vídeos de qualquer tamanho!









