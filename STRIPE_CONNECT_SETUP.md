# Stripe Connect - Pagamento para Criadores

## 📋 O que é Stripe Connect?

Stripe Connect permite que sua plataforma:
1. Aceite pagamentos de alunos
2. Divida automaticamente o valor entre você (plataforma) e o criador
3. Pague diretamente na conta bancária do criador

---

## 🔧 Configuração Inicial

### 1. Ativar Stripe Connect

1. Acesse: https://dashboard.stripe.com/settings/connect
2. Clique em **"Get started with Connect"**
3. Escolha o tipo **"Standard"** (mais fácil para começar)

### 2. Configurar Onboarding

Os criadores precisarão:
- CPF/CNPJ
- Dados bancários
- Verificação de identidade

O Stripe cuida de tudo isso automaticamente!

---

## 💻 Implementação no Código

### Fluxo para Criadores

1. **Criador se cadastra** na plataforma
2. **Criador conecta conta Stripe** (onboarding)
3. **Aluno compra curso** → Dinheiro vai para conta conectada
4. **Stripe divide** automaticamente (ex: 90% criador, 10% plataforma)

### Código de Exemplo

```typescript
// 1. Criar conta conectada para o criador
const account = await stripe.accounts.create({
  type: 'standard', // ou 'express' para mais controle
  country: 'BR',
  email: creator.email,
  metadata: {
    userId: creator.id,
  },
});

// 2. Gerar link de onboarding
const accountLink = await stripe.accountLinks.create({
  account: account.id,
  refresh_url: 'https://seusite.com/stripe/refresh',
  return_url: 'https://seusite.com/stripe/return',
  type: 'account_onboarding',
});

// Redirecionar criador para accountLink.url

// 3. Criar pagamento com divisão
const paymentIntent = await stripe.paymentIntents.create({
  amount: 2000, // R$ 20,00 em centavos
  currency: 'brl',
  application_fee_amount: 200, // 10% para a plataforma (R$ 2,00)
  transfer_data: {
    destination: creatorStripeAccountId, // Conta do criador
  },
});
```

---

## 📊 Modelo de Comissão Sugerido

| Item | Criador | Plataforma |
|------|---------|------------|
| Venda de Curso | 85-90% | 10-15% |

### Exemplo:
- Curso custa R$ 100
- Criador recebe R$ 85-90
- Plataforma recebe R$ 10-15

---

## 🗄️ Mudanças no Banco de Dados

Adicionar campos na tabela `users`:

```sql
ALTER TABLE users ADD COLUMN stripe_account_id VARCHAR(255);
ALTER TABLE users ADD COLUMN stripe_onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN bank_account_verified BOOLEAN DEFAULT FALSE;
```

---

## 📱 Fluxo de Telas

### Para Criadores:

1. **Perfil** → "Configurar Recebimentos"
2. Redireciona para onboarding Stripe
3. Criador preenche dados bancários
4. Retorna para plataforma com conta verificada

### Para Alunos:

1. **Página do Curso** → "Comprar"
2. Checkout com cartão/boleto
3. Pagamento processado
4. Valor dividido automaticamente

---

## ⚠️ Considerações

### Sobre PIX:
- Stripe Connect **NÃO suporta PIX** como método de pagamento para divisão
- Para PIX, você precisaria de outro gateway (Mercado Pago, PagSeguro)
- Ou fazer a divisão manualmente

### Taxas do Stripe Brasil:
- 3.99% + R$ 0.39 por transação com cartão
- Taxa adicional do Connect: 0.5% ou R$ 0.25

### Alternativa sem Stripe Connect:
1. Todo pagamento vai para sua conta
2. Você calcula manualmente quanto deve ao criador
3. Faz transferência manual (trabalhoso)

---

## 🔗 Links Úteis

- [Stripe Connect Docs](https://stripe.com/docs/connect)
- [Connect Dashboard](https://dashboard.stripe.com/connect/accounts/overview)
- [Onboarding Guide](https://stripe.com/docs/connect/standard-accounts)

---

## 📝 TODO para Implementar

1. [ ] Adicionar `stripe_account_id` na tabela users
2. [ ] Criar endpoint `/api/stripe/connect/create-account`
3. [ ] Criar endpoint `/api/stripe/connect/onboarding-link`
4. [ ] Criar webhook para `account.updated`
5. [ ] Modificar pagamento de curso para usar `transfer_data`
6. [ ] Criar página de configuração de recebimentos para criadores


