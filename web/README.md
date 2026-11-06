# JVG Nota Fiscal — aplicativo web

Versão piloto Next.js para publicação na Netlify.

O adaptador `@netlify/plugin-nextjs` está fixado em `package.json` e ativado no `netlify.toml` da raiz. Ele é indispensável para gerar as funções de servidor (Auth e API); publicar somente os arquivos de `.next` resulta em 404.

## Iniciar localmente

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Node.js 22.13+; sem as variáveis do Supabase a tela de login informa que a configuração está pendente.

## Variáveis de ambiente

| Variável | Exposição | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Pública | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Pública | Supabase Auth no navegador |
| `JVG_SUPABASE_SECRET_KEY` | Somente servidor | Operações privilegiadas e onboarding de empresa |
| `JVG_FOCUS_HOMOLOGACAO_TOKEN` | Somente servidor | Token de homologação do emitente piloto na Focus NFe |
| `JVG_FOCUS_PILOT_COMPANY_ID` | Somente servidor | UUID da empresa piloto autorizada a usar o token |

Não coloque valores reais em `.env.example` ou em arquivos versionados. Use `.env.local` apenas para desenvolvimento local (não versionado) e segredos de ambiente da Netlify em produção.

Na Netlify, **não crie `JVG_SUPABASE_URL`**: esta variável antiga não é utilizada. Configure apenas `NEXT_PUBLIC_SUPABASE_URL` com a URL do projeto (sem marcar como segredo), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` como pública, e `JVG_SUPABASE_SECRET_KEY` como segredo no servidor. A URL e a chave publicável são destinadas ao navegador; a chave secreta nunca deve ser exposta.

A configuração de deploy libera **somente** as duas variáveis públicas `NEXT_PUBLIC_` da detecção de segredos da Netlify, pois o Next.js as incorpora legitimamente nos arquivos do navegador. O scanner permanece ativo para `JVG_SUPABASE_SECRET_KEY` e para possíveis outros segredos.

## Componentes principais

- `app/login/page.tsx`: login e cadastro com Supabase Auth.
- `app/auth/callback/route.ts`: confirmação de e-mail.
- `app/api/*`: endpoints Next.js com autenticação no servidor.
- `lib/supabase/server.ts`: sessão por cookies.
- `lib/jvg-backend.ts`: acesso seguro e filtrado ao banco.
- `public/erp/`: dashboard, estilos e cadastros da versão piloto.

**Estado fiscal:** a transmissão pela Focus NFe permanece desativada. Não há emissão real de NF-e/NFS-e nesta versão.

### Focus NFe — passo de homologação

1. No painel da Focus, cadastre o CNPJ real da empresa, envie o certificado A1 com senha por conexão segura e habilite NF-e em homologação. Confira IE, credenciamento, série e próxima numeração com o contador.
2. Configure as duas variáveis `JVG_FOCUS_*` acima no painel da Netlify (Builds e Functions). Não coloque token ou arquivo de certificado no GitHub.
3. Acesse `GET /api/focus/status` após entrar com o usuário da empresa piloto. `token_valid` significa somente autenticação aceita na consulta de uma referência inexistente: **não comprova certificado, autorização SEFAZ ou prontidão fiscal**.
4. Próxima fase: cadastro fiscal completo de emitente/destinatário/produtos, motor de validações e NF-e de teste com referência idempotente, depois consulta de resultado, XML, DANFE e eventos.

Esse endpoint de validação não emite, cancela nem altera documentos. A emissão continuará bloqueada até os requisitos fiscais estarem conferidos. O token de homologação é exclusivo da empresa piloto; cada empresa comercial precisará de credenciais próprias e isolamento por tenant.

Leia também o [README da raiz](../README.md) para o procedimento de publicação na Netlify.
