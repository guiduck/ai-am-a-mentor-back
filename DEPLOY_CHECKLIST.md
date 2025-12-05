# ✅ Checklist de Deploy - Sistema de Transcrição

## ⚠️ IMPORTANTE: Antes de fazer deploy

### 1. Verificar Build Command no Render

O Build Command deve incluir instalação do FFmpeg:

```bash
apt-get update && apt-get install -y ffmpeg && npm install && npx drizzle-kit migrate --config=drizzle.prod.config.cjs
```

**Como verificar:**
1. Acesse Render Dashboard
2. Vá em Settings do seu Web Service
3. Verifique o campo "Build Command"
4. Deve conter `apt-get install -y ffmpeg`

### 2. Verificar se FFmpeg está instalado

Após o deploy, verifique os logs. Você deve ver:
```
✅ FFmpeg is available
```

Se ver:
```
⚠️ FFmpeg not available
```

**Solução:** Atualize o Build Command no Render.

### 3. Verificar Logs de Transcrição

Quando transcrever um vídeo, você deve ver esta sequência de logs:

```
🎤 Starting transcription for: videos/...
✅ Video downloaded, size: X MB
🎵 Starting audio extraction process...
🔍 Checking FFmpeg availability...
✅ FFmpeg is available
🎵 FFmpeg is available, proceeding with audio extraction...
🎵 Extracting audio from mp4 video (X MB)...
📝 Video written to temp file: ...
🎵 FFmpeg command: ...
⏳ Audio extraction progress: X%
✅ Audio extraction completed
✅ Audio buffer created, size: ...
✅ Audio extracted, size: X MB (reduced from X MB)
📤 Sending audio to OpenAI Whisper API...
✅ Transcription completed, length: X
```

### 4. Problemas Comuns

#### Erro: "413 Maximum content size limit exceeded"
**Causa:** FFmpeg não está instalado ou código antigo em produção
**Solução:** 
- Verificar Build Command
- Fazer novo deploy
- Verificar logs para confirmar extração de áudio

#### Erro: "FFmpeg is not available"
**Causa:** FFmpeg não foi instalado durante o build
**Solução:** Atualizar Build Command no Render

#### Vídeo muito grande mesmo após extração
**Causa:** Vídeo extremamente longo (>3 horas)
**Solução:** Dividir vídeo em partes menores

## 📊 Capacidade Esperada

- **Vídeo de 30 minutos:** ~5-8MB de áudio ✅
- **Vídeo de 1 hora:** ~10-15MB de áudio ✅
- **Vídeo de 2 horas:** ~20-25MB de áudio ✅
- **Vídeo de 3+ horas:** Pode exceder 25MB ⚠️

## 🔧 Comandos Úteis

### Verificar FFmpeg localmente (se testando):
```bash
ffmpeg -version
```

### Testar extração de áudio:
```bash
ffmpeg -i input.mp4 -vn -acodec libmp3lame -ar 16000 -ac 1 -b:a 64k output.mp3
```









