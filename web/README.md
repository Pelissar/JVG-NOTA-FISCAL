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

Não coloque valores reais em `.env.example` ou em arquivos versionados. Use `.env.local` apenas para desenvolvimento local (não versionado) e segredos de ambiente da Netlify em produção.

Na Netlify, **não crie `JVG_SUPABASE_URL`**: esta variável antiga não é utilizada. Configure apenas `NEXT_PUBLIC_SUPABASE_URL` com a URL do projeto (sem marcar como segredo), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` como pública, e `JVG_SUPABASE_SECRET_KEY` como segredo no servidor. A URL e a chave publicável são destinadas ao navegador; a chave secreta nunca deve ser exposta.

## Componentes principais

- `app/login/page.tsx`: login e cadastro com Supabase Auth.
- `app/auth/callback/route.ts`: confirmação de e-mail.
- `app/api/*`: endpoints Next.js com autenticação no servidor.
- `lib/supabase/server.ts`: sessão por cookies.
- `lib/jvg-backend.ts`: acesso seguro e filtrado ao banco.
- `public/erp/`: dashboard, estilos e cadastros da versão piloto.

**Estado fiscal:** a transmissão pela Focus NFe permanece desativada. Não há emissão real de NF-e/NFS-e nesta versão.

Leia também o [README da raiz](../README.md) para o procedimento de publicação na Netlify.
