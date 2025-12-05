# 🎤 Fluxo End-to-End de Transcrição de Vídeo

## Visão Geral

O sistema de transcrição permite que vídeos sejam automaticamente transcritos usando OpenAI Whisper, e essas transcrições são usadas para alimentar um chat com IA que responde perguntas dos estudantes.

## Fluxo Completo

### 1. **Frontend: Usuário solicita transcrição**
```
Página de Lesson → Botão "Transcrever vídeo" → POST /api/videos/transcribe
```

### 2. **Backend: Endpoint de Transcrição** (`POST /api/videos/transcribe`)
- ✅ Valida autenticação do usuário
- ✅ Verifica se usuário tem acesso ao vídeo (criador ou estudante inscrito)
- ✅ Verifica se transcrição já existe (retorna existente se houver)
- ✅ Chama `transcribeVideoFromR2(r2Key)`

### 3. **Serviço de Transcrição** (`openai-transcription.ts`)
```
transcribeVideoFromR2(r2Key)
  ↓
1. downloadFileFromR2(r2Key) → Baixa vídeo do Cloudflare R2 como Buffer
  ↓
2. Cria objeto File do vídeo
  ↓
3. OpenAI Whisper API → Envia vídeo para transcrição
  ↓
4. Recebe texto transcrito (string)
  ↓
5. uploadFileToR2(transcriptKey, buffer) → Salva backup no R2
  ↓
6. Retorna { transcript: string }
```

### 4. **Backend: Salva no Banco de Dados**
- ✅ Insere na tabela `transcripts` (videoId, content)
- ✅ Atualiza `videos.transcriptR2Key` com a chave do backup no R2
- ✅ Retorna transcrição para o frontend

### 5. **Frontend: Chat com IA**
```
Usuário digita pergunta → POST /api/videos/chat
  ↓
Backend busca transcrição do banco
  ↓
generateAIResponse(transcript, question, videoTitle)
  ↓
OpenAI GPT-4o-mini com contexto da transcrição
  ↓
Retorna resposta baseada no conteúdo do vídeo
```

## Estrutura de Dados

### Tabela `transcripts`
```sql
- id: uuid (PK)
- video_id: uuid (FK → videos.id, CASCADE DELETE)
- content: text (transcrição completa)
- created_at: timestamp
```

### Tabela `videos`
```sql
- transcriptR2Key: varchar (chave do backup no R2)
```

## Como Funciona o Chat com IA

1. **Sistema Prompt**: Define o mentor como assistente especializado
2. **Contexto**: Inclui a transcrição completa do vídeo
3. **Pergunta**: Pergunta do estudante
4. **Resposta**: GPT-4o-mini gera resposta baseada APENAS na transcrição
5. **Limitação**: Se informação não estiver na transcrição, informa ao usuário

## Migrations

A tabela `transcripts` já existe na migration inicial (`0000_special_nemesis.sql`), então **não é necessário criar nova migration** para este recurso.

### Verificar se migrations estão aplicadas:

```bash
# No diretório /api
npm run db:check
```

### Aplicar migrations (se necessário):

**Desenvolvimento:**
```bash
cd /home/guiduck/video-learning-platform/api
npm run db:migrate
```

**Produção (Render):**
```bash
# As migrations são aplicadas automaticamente no build
# Ou manualmente:
npm run db:migrate:prod
```

## Variáveis de Ambiente Necessárias

```env
OPENAI_API_KEY=sk-proj-...  # Chave da OpenAI
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_BUCKET_NAME=...
CLOUDFLARE_ACCESS_KEY_ID=...
CLOUDFLARE_SECRET_ACCESS_KEY=...
```

## Custos

- **Whisper API**: ~$0.006 por minuto de áudio/vídeo
- **GPT-4o-mini**: ~$0.15 por 1M tokens de entrada, $0.60 por 1M tokens de saída

## Limitações

- Vídeos muito longos podem ser caros para transcrever
- Whisper tem limite de 25MB por arquivo (pode ser contornado com chunking)
- Transcrições são em português (configurado como `language: "pt"`)









