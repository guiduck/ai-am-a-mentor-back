# 🔧 Configuração CORS do Cloudflare R2 para Uploads Diretos

## ❌ Problema

O upload direto de vídeos para o R2 está falhando com erro de CORS:

```
Access to XMLHttpRequest at 'https://...r2.cloudflarestorage.com/...' 
from origin 'http://localhost:3000' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Causa:** A política CORS atual do R2 só permite `GET` e `HEAD`, mas não `PUT` (necessário para uploads diretos).

## ✅ Solução Passo a Passo

### 1. Acesse o Cloudflare Dashboard

1. Vá para [dash.cloudflare.com](https://dash.cloudflare.com)
2. Faça login na sua conta
3. No menu lateral, clique em **R2**

### 2. Selecione seu Bucket

1. Clique no bucket `ai-am-a-mentor` (ou o nome do seu bucket)

### 3. Configure a Política CORS

1. No menu lateral do bucket, clique em **Settings**
2. Role até a seção **CORS Policy**
3. Clique no botão **Edit** (ou **Add** se não houver regra)

### 4. Configure a Regra CORS

**IMPORTANTE:** Substitua a regra existente ou adicione uma nova com estas configurações:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://ai-am-a-mentor.netlify.app",
      "https://ai-am-a-mentor-front.vercel.app"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD",
      "PUT",
      "POST"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag",
      "x-amz-request-id",
      "x-amz-version-id"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

### 5. Campos Explicados

- **`AllowedOrigins`**: 
  - URLs do frontend que podem fazer uploads
  - **Inclua todas as URLs** onde seu app pode rodar (localhost, produção, staging)
  
- **`AllowedMethods`**: 
  - **CRÍTICO:** Deve incluir `PUT` para uploads diretos
  - `POST` também pode ser útil para multipart uploads
  
- **`AllowedHeaders`**: 
  - `*` permite todos os headers (necessário para presigned URLs com assinatura AWS)
  
- **`ExposeHeaders`**: 
  - Headers que o browser pode ler na resposta
  - Útil para debug e verificação de upload
  
- **`MaxAgeSeconds`**: 
  - Tempo de cache do preflight request (3600 = 1 hora)
  - Reduz requisições OPTIONS desnecessárias

### 6. Salve e Aguarde

1. Clique em **Save** (ou **Update**)
2. **Aguarde 10-30 segundos** para a política ser aplicada globalmente
3. A política CORS pode levar alguns segundos para propagar

### 7. Teste o Upload

1. Recarregue a página do frontend
2. Tente fazer upload de um vídeo novamente
3. O erro de CORS deve desaparecer

## 🔍 Verificação

### Teste Manual com cURL

```bash
curl -X OPTIONS \
  "https://ai-am-a-mentor.a9cf0f5....r2.cloudflarestorage.com/videos/test.mp4" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" \
  -v
```

**Resposta esperada:**
```
< HTTP/1.1 200 OK
< Access-Control-Allow-Origin: http://localhost:3000
< Access-Control-Allow-Methods: GET, HEAD, PUT, POST
< Access-Control-Allow-Headers: *
< Access-Control-Max-Age: 3600
```

### Verificar no Browser DevTools

1. Abra o DevTools (F12)
2. Vá na aba **Network**
3. Tente fazer upload
4. Procure por uma requisição `OPTIONS` (preflight)
5. Verifique os headers da resposta:
   - Deve ter `Access-Control-Allow-Origin: http://localhost:3000`
   - Deve ter `Access-Control-Allow-Methods: GET, HEAD, PUT, POST`

## ⚠️ Problemas Comuns

### "Ainda está dando erro de CORS"

1. **Aguarde mais tempo** - A propagação pode levar até 1 minuto
2. **Limpe o cache do browser** - Ctrl+Shift+R (hard refresh)
3. **Verifique se salvou corretamente** - Volte na página de CORS e confirme
4. **Verifique a origem** - Certifique-se que `http://localhost:3000` está na lista

### "Não consigo editar a política CORS"

- Certifique-se que você tem permissões de **Admin** ou **Editor** no Cloudflare
- Alguns planos podem ter limitações

### "Funciona no localhost mas não em produção"

- Adicione a URL de produção em `AllowedOrigins`
- Exemplo: `https://seu-dominio.com`

## 📝 Notas Importantes

- **CORS é configurado no R2, não no código** - Não há como resolver isso apenas no backend
- **Cada bucket precisa de sua própria política CORS** - Se tiver múltiplos buckets, configure cada um
- **Presigned URLs herdam a política CORS** - A URL assinada funciona, mas o browser ainda verifica CORS
- **CORS é verificado pelo browser** - O erro aparece no console do browser, não no servidor

## 🎯 Checklist Final

- [ ] Acessei o Cloudflare Dashboard
- [ ] Encontrei o bucket correto
- [ ] Editei a política CORS
- [ ] Adicionei `PUT` em `AllowedMethods`
- [ ] Incluí `http://localhost:3000` em `AllowedOrigins`
- [ ] Salvei as alterações
- [ ] Aguardei 30 segundos
- [ ] Testei o upload novamente

