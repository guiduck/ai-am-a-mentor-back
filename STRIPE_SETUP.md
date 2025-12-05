# 💳 Configuração do Stripe

Este guia explica como configurar o Stripe para processar pagamentos na plataforma.

## 📋 Pré-requisitos

1. Conta no [Stripe](https://stripe.com)
2. Acesso ao dashboard do Stripe
3. Chaves de API (Secret Key e Publishable Key)

## 🚀 Passo a Passo

### 1. Criar Conta no Stripe

1. Acesse [https://stripe.com](https://stripe.com)
2. Clique em **"Sign up"** ou **"Get started"**
3. Preencha seus dados e crie a conta
4. Complete a verificação da conta (pode levar alguns dias)

### 2. Obter Chaves de API

#### Como acessar as chaves:

**URL Direta para API Keys:**

- Modo teste: https://dashboard.stripe.com/test/apikeys
- Modo produção: https://dashboard.stripe.com/apikeys

**Ou pelo menu:**

1. No dashboard do Stripe, procure por **"Developers"** no menu superior direito
2. Clique em **"API keys"**

#### Modo Teste (Development)

1. Certifique-se de que está em **"Test mode"** (toggle no canto superior direito)
2. Você verá duas chaves:
   - **Publishable key** (começa com `pk_test_...`) - já está visível
   - **Secret key** (começa com `sk_test_...`) - clique em **"Reveal test key"** para ver

#### Modo Produção

1. Após ativar sua conta, mude o toggle para **"Live mode"** (canto superior direito)
2. Vá em **"Developers"** → **"API keys"**
3. Obtenha as chaves de produção:
   - **Publishable key** (começa com `pk_live_...`)
   - **Secret key** (começa com `sk_live_...`)

### 3. Configurar Webhook

O webhook permite que o Stripe notifique automaticamente quando um pagamento é concluído.

#### Encontrando a aba Developers:

**Opção 1 - Menu Superior:**

1. No dashboard do Stripe (https://dashboard.stripe.com)
2. Procure no **menu superior direito** por um link chamado **"Developers"** ou **"Desenvolvedores"**
3. Clique nele

**Opção 2 - URL Direta:**

1. Acesse diretamente: https://dashboard.stripe.com/test/webhooks
2. Ou para modo produção: https://dashboard.stripe.com/webhooks

**Opção 3 - Busca:**

1. Use a barra de busca no topo do dashboard
2. Digite "webhooks" e selecione a opção que aparecer

#### Configurando o Webhook:

1. Na página de Webhooks, clique em **"Add endpoint"** ou **"Adicionar endpoint"**
2. Configure:
   - **Endpoint URL:** `https://seu-backend.onrender.com/api/payments/webhook`
     - ⚠️ Substitua `seu-backend.onrender.com` pela URL real do seu backend
     - Exemplo: `https://ai-am-a-mentor-back.onrender.com/api/payments/webhook`
   - **Description (opcional):** "Payment confirmations"
   - **Events to send:**
     - Clique em **"Select events"** ou **"+ Select events"**
     - Na busca, digite `payment_intent.succeeded`
     - Marque a checkbox de `payment_intent.succeeded`
     - Clique em **"Add events"**
3. Clique em **"Add endpoint"** para salvar
4. Após criar, clique no endpoint que você acabou de criar
5. Procure por **"Signing secret"** (começa com `whsec_...`)
6. Clique em **"Reveal"** ou **"Click to reveal"** para ver o secret
7. Copie esse valor

**⚠️ IMPORTANTE sobre Webhooks:**

- Para desenvolvimento local, você pode usar o Stripe CLI ou pular o webhook temporariamente
- O webhook só funcionará quando seu backend estiver acessível publicamente (Render)
- Se não configurar o webhook, você precisará confirmar pagamentos manualmente via API

### 4. Adicionar Variáveis de Ambiente

#### No arquivo `.env.local` (desenvolvimento local):

Crie ou edite o arquivo `api/.env.local`:

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_51abc123... # Cole sua chave aqui
STRIPE_PUBLISHABLE_KEY=pk_test_51abc123... # Cole sua chave aqui
STRIPE_WEBHOOK_SECRET=whsec_abc123... # Cole o webhook secret aqui (opcional para local)
```

#### No Render (produção):

1. Acesse seu Web Service no Render
2. Vá em **"Environment"** no menu lateral
3. Clique em **"Add Environment Variable"**
4. Adicione cada variável:
   - Key: `STRIPE_SECRET_KEY` → Value: `sk_test_51abc123...`
   - Key: `STRIPE_PUBLISHABLE_KEY` → Value: `pk_test_51abc123...`
   - Key: `STRIPE_WEBHOOK_SECRET` → Value: `whsec_abc123...`
5. Clique em **"Save Changes"**
6. O Render vai fazer redeploy automaticamente

**⚠️ IMPORTANTE:**

- Use chaves de **teste** (`sk_test_`, `pk_test_`) durante desenvolvimento
- Use chaves de **produção** (`sk_live_`, `pk_live_`) apenas em produção
- **NUNCA** compartilhe suas chaves secretas publicamente
- **NUNCA** faça commit do arquivo `.env.local` no git

### 5. Testar Pagamentos

#### Cartões de Teste

O Stripe fornece cartões de teste para simular pagamentos:

- **Sucesso:** `4242 4242 4242 4242`
- **Falha:** `4000 0000 0000 0002`
- **3D Secure:** `4000 0027 6000 3184`

Use qualquer:

- **CVV:** 123
- **Data de expiração:** Qualquer data futura (ex: 12/25)
- **CEP:** Qualquer CEP válido

#### Testar no Frontend

1. Use a chave **Publishable Key** no frontend
2. Configure o Stripe Elements ou Checkout
3. Use os cartões de teste acima

## 📊 Estrutura de Pagamentos

### Tipos de Pagamento Suportados

1. **Compra de Créditos**

   - Usuário compra créditos para usar na plataforma
   - Créditos são adicionados automaticamente após pagamento

2. **Compra de Curso (Pagamento Direto)**

   - Usuário paga diretamente pelo curso
   - Inscrição automática após pagamento

3. **Compra de Curso (Com Créditos)**
   - Usuário usa créditos já adquiridos
   - Não requer processamento via Stripe

### Fluxo de Pagamento

```
1. Usuário inicia pagamento
   ↓
2. Frontend cria Payment Intent via API
   ↓
3. Stripe retorna client_secret
   ↓
4. Frontend confirma pagamento com Stripe Elements
   ↓
5. Stripe processa pagamento
   ↓
6. Webhook notifica backend (pagamento concluído)
   ↓
7. Backend atualiza status e adiciona créditos/inscrição
```

## 🔒 Segurança

- ✅ **NUNCA** exponha a Secret Key no frontend
- ✅ Use HTTPS em produção
- ✅ Valide webhooks usando o signing secret
- ✅ Use variáveis de ambiente para chaves
- ✅ Monitore transações no dashboard do Stripe

## 📝 Recursos Adicionais

- [Documentação do Stripe](https://stripe.com/docs)
- [Stripe Testing](https://stripe.com/docs/testing)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Stripe Dashboard](https://dashboard.stripe.com)

## 🆘 Suporte e Troubleshooting

### Não consigo encontrar a aba "Developers"

**Soluções:**

1. **URL Direta:** Acesse https://dashboard.stripe.com/test/webhooks
2. **Menu Superior:** Procure no canto superior direito do dashboard
3. **Idioma:** Se o dashboard estiver em português, procure por "Desenvolvedores"
4. **Conta Nova:** Algumas contas novas podem ter um layout diferente - tente a URL direta

### Webhook não está funcionando

**Para desenvolvimento local:**

- O webhook não funcionará em `localhost` porque o Stripe não consegue acessar sua máquina
- **Opção 1:** Use o Stripe CLI para testar webhooks localmente
- **Opção 2:** Pule o webhook e confirme pagamentos manualmente via API (`/api/payments/confirm`)
- **Opção 3:** Faça deploy no Render e configure o webhook apontando para a URL pública

**Para produção (Render):**

- Certifique-se de que a URL do webhook está correta
- Verifique se o backend está rodando e acessível
- Veja os logs do webhook no dashboard do Stripe (Developers → Webhooks → seu endpoint → "Attempts")

### Outros problemas

Se tiver problemas:

1. Verifique os logs do Stripe no dashboard
2. Verifique os logs do backend no Render
3. Teste com cartões de teste primeiro
4. Consulte a [documentação do Stripe](https://stripe.com/docs)

## 📞 Links Úteis

- **Dashboard:** https://dashboard.stripe.com
- **API Keys (teste):** https://dashboard.stripe.com/test/apikeys
- **Webhooks (teste):** https://dashboard.stripe.com/test/webhooks
- **Documentação:** https://stripe.com/docs
- **Cartões de teste:** https://stripe.com/docs/testing#cards
