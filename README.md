# 🚀 AI Am A Mentor - Backend API

API backend standalone para deploy no Render.

## 🚀 Deploy no Render

### Passo 1: Criar Repositório no GitHub

1. Acesse [GitHub](https://github.com/new)
2. Crie um novo repositório:
   - **Name:** `ai-am-a-mentor-backend` (ou o nome que preferir)
   - **NÃO** inicialize com README, .gitignore ou license
3. Clique em **"Create repository"**

### Passo 2: Inicializar Git e Fazer Push

```bash
cd /home/guiduck/video-learning-platform/api

# Inicializar Git
git init

# Adicionar todos os arquivos
git add .

# Fazer o primeiro commit
git commit -m "Initial commit: Backend API for Render"

# Adicionar o repositório remoto (substitua pela sua URL)
git remote add origin https://github.com/guiduck/ai-am-a-mentor-backend.git

# Ou se usar SSH:
# git remote add origin git@github.com:guiduck/ai-am-a-mentor-backend.git

# Fazer push
git branch -M main
git push -u origin main
```

### Passo 3: Deploy no Render

1. Acesse [Render Dashboard](https://dashboard.render.com)
2. Clique em **"New +"** → **"Web Service"**
3. Conecte o repositório `ai-am-a-mentor-backend` que você acabou de criar
4. Configure:

#### Configurações Básicas

- **Name:** `ai-am-a-mentor-api`
- **Environment:** `Node`
- **Root Directory:** (deixe **VAZIO**)
- **Branch:** `main`

#### Build & Start Commands

- **Build Command:**
```bash
npm install && npx drizzle-kit migrate --config=drizzle.prod.config.cjs
```

- **Start Command:**
```bash
npm run prod
```

#### Environment Variables

**⚠️ IMPORTANTE:** Use o **mesmo database** que já está configurado no Render! Copie todas as variáveis do seu Web Service atual.

Adicione todas estas variáveis:

```bash
# Database (use a mesma URL do PostgreSQL que já está no Render)
DATABASE_URL=postgresql://dbuser:password@dpg-xxx.oregon-postgres.render.com/aiamamentor?sslmode=require

# JWT (use o mesmo secret do monorepo)
JWT_SECRET=your-super-secret-jwt-key-for-development-change-in-production

# Server
PORT=10000
NODE_ENV=production

# Cloudflare R2 (use as mesmas credenciais)
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_ACCESS_KEY_ID=your-access-key
CLOUDFLARE_SECRET_ACCESS_KEY=your-secret-key
CLOUDFLARE_BUCKET_NAME=ai-am-a-mentor
CLOUDFLARE_R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com

# OpenAI (use a mesma key)
OPENAI_API_KEY=sk-proj-your-openai-key
```

5. Clique em **"Create Web Service"**
6. Aguarde o deploy (5-10 minutos)

### Passo 4: Testar a API

```bash
curl https://ai-am-a-mentor-api.onrender.com/health
```

## 📝 Scripts Disponíveis

- `npm run dev` - Inicia o servidor em modo desenvolvimento
- `npm run prod` - Inicia o servidor em modo produção
- `npm run db:generate` - Gera migrações do banco de dados
- `npm run db:migrate` - Aplica migrações (desenvolvimento)
- `npm run db:migrate:prod` - Aplica migrações (produção)
- `npm run build` - Build para produção (instala deps e roda migrações)

## ✅ Pronto!

Agora você tem um backend standalone muito mais simples de gerenciar e fazer deploy!


