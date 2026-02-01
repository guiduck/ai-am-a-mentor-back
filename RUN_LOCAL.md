# 🚀 Como Rodar a API Localmente

## 📋 Pré-requisitos

1. Node.js instalado (versão 18+)
2. PostgreSQL rodando (local ou remoto)
3. Variáveis de ambiente configuradas

## 🛠️ Passo a Passo

### 1. Instalar Dependências

```bash
cd /home/guiduck/video-learning-platform/api
npm install
```

### 2. Configurar Variáveis de Ambiente

Crie um arquivo `.env.local` na raiz do projeto `/api`:

```bash
# Database
DATABASE_URL="postgresql://usuario:senha@localhost:5432/nome_do_banco"

# JWT
JWT_SECRET="sua-chave-secreta-jwt-aqui"

# Porta (opcional, padrão é 3333)
PORT=3001
HOST=0.0.0.0

# CORS (opcional para desenvolvimento)
FRONTEND_URL="http://localhost:3000"
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"

# Cloudflare R2 (opcional, apenas se quiser testar uploads)
CLOUDFLARE_ACCOUNT_ID="seu-account-id"
CLOUDFLARE_ACCESS_KEY_ID="sua-access-key"
CLOUDFLARE_SECRET_ACCESS_KEY="sua-secret-key"
CLOUDFLARE_BUCKET_NAME="nome-do-bucket"
CLOUDFLARE_BACKUP_BUCKET_NAME="nome-do-bucket-backup" # opcional
CLOUDFLARE_R2_PUBLIC_URL="https://seu-bucket.r2.cloudflarestorage.com"
```

### 3. Rodar Migrations (se necessário)

**Se você já tem o banco de dados configurado e as migrations aplicadas, pode pular este passo.**

Se precisar rodar migrations:

```bash
# Usar o mesmo banco do Render (produção)
npm run db:migrate:prod

# OU criar um banco local e rodar migrations de desenvolvimento
npm run db:migrate
```

**Nota:** Se estiver usando o mesmo banco do Render, você **NÃO precisa** rodar migrations novamente, pois elas já foram aplicadas.

### 4. Iniciar o Servidor

```bash
# Modo desenvolvimento (usa .env.local)
npm run dev

# OU modo produção simples
npm start
```

A API estará rodando em: `http://localhost:3001`

## 🔍 Verificar se Está Funcionando

Teste o endpoint de saúde:

```bash
curl http://localhost:3001/health
```

Ou acesse no navegador: `http://localhost:3001/health`

## 📝 Comandos Úteis

```bash
# Rodar migrations de desenvolvimento
npm run db:migrate

# Rodar migrations de produção
npm run db:migrate:prod

# Gerar novas migrations (após alterar schema)
npm run db:generate

# Iniciar em modo desenvolvimento
npm run dev

# Iniciar em modo produção
npm start
```

## ⚠️ Problemas Comuns

### Erro: "Cannot connect to database"

- Verifique se o PostgreSQL está rodando
- Confirme se a `DATABASE_URL` está correta no `.env.local`

### Erro: "Port already in use"

- Mude a porta no `.env.local`: `PORT=3002`
- Ou mate o processo que está usando a porta: `lsof -ti:3001 | xargs kill`

### Erro: "JWT_SECRET is required"

- Adicione `JWT_SECRET` no `.env.local`

## 🎯 Testando com o Frontend Local

Se o frontend estiver rodando em `http://localhost:3000`, configure:

```env
# No .env.local do frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

E no `.env.local` da API:

```env
FRONTEND_URL=http://localhost:3000
```



