# Configuração do PIX no Stripe

## 📋 Pré-requisitos

Para aceitar PIX no Brasil, você precisa:

1. **Conta Stripe verificada** com dados brasileiros
2. **Conta bancária brasileira** cadastrada
3. **PIX habilitado** nas configurações

---

## 🔧 Passo a Passo para Habilitar PIX

### 1. Acessar Configurações de Métodos de Pagamento

1. Acesse: https://dashboard.stripe.com/settings/payment_methods
2. Ou: Dashboard → Configurações → Métodos de Pagamento

### 2. Habilitar PIX

1. Procure por **"PIX"** na lista de métodos
2. Clique em **"Ativar"**
3. Siga as instruções para verificação (se necessário)

### 3. Verificar Requisitos

O Stripe pode exigir:

- CPF/CNPJ verificado
- Conta bancária brasileira ativa
- Informações comerciais completas

---

## 💻 Implementação no Código

### Backend - Atualizar o serviço Stripe

O PIX usa um fluxo diferente do cartão:

1. **Criar Payment Intent com PIX**
2. **Gerar QR Code** para o cliente
3. **Aguardar confirmação** via webhook

### Código de Exemplo

```typescript
// Criar Payment Intent com PIX
const paymentIntent = await stripe.paymentIntents.create({
  amount: amountInCents, // em centavos
  currency: "brl", // PIX só funciona com BRL
  payment_method_types: ["pix"],
  metadata: {
    userId,
    type: "credits",
    creditsAmount: credits.toString(),
  },
});

// O response inclui:
// - paymentIntent.next_action.pix_display_qr_code.data (base64 do QR)
// - paymentIntent.next_action.pix_display_qr_code.expires_at
```

### Frontend - Exibir QR Code

```tsx
// Após criar o payment intent
const qrCodeData = paymentIntent.next_action?.pix_display_qr_code?.data;
const expiresAt = paymentIntent.next_action?.pix_display_qr_code?.expires_at;

// Exibir QR Code
<img src={`data:image/png;base64,${qrCodeData}`} alt="QR Code PIX" />
<p>Expira em: {new Date(expiresAt * 1000).toLocaleString()}</p>
```

---

## ⚠️ Limitações do PIX no Stripe

1. **Apenas BRL**: PIX só funciona com moeda brasileira
2. **Valor mínimo**: R$ 1,00
3. **Valor máximo**: R$ 10.000,00 por transação (pode variar)
4. **Expiração**: QR Code expira em 24 horas (configurável)
5. **Webhook obrigatório**: Precisa do webhook para confirmar pagamento

---

## 🔔 Webhook para PIX

O PIX é **assíncrono**, então você PRECISA do webhook:

```typescript
// Eventos importantes para PIX
switch (event.type) {
  case "payment_intent.succeeded":
    // PIX foi pago com sucesso
    break;
  case "payment_intent.payment_failed":
    // PIX falhou ou expirou
    break;
}
```

---

## 📝 Checklist

- [ ] Conta Stripe verificada com CPF/CNPJ
- [ ] Conta bancária brasileira cadastrada
- [ ] PIX habilitado em payment_methods
- [ ] Webhook configurado para `payment_intent.succeeded`
- [ ] Frontend preparado para exibir QR Code

---

## 🔗 Links Úteis

- [Stripe PIX Docs](https://stripe.com/docs/payments/pix)
- [Payment Methods Settings](https://dashboard.stripe.com/settings/payment_methods)
- [Webhooks](https://dashboard.stripe.com/webhooks)

