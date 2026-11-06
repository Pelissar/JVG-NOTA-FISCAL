# JVG Nota Fiscal — ERP Web (Piloto Netlify)

Repositório do sistema JVG Nota Fiscal. O código da versão web está na pasta [`web/`](web/), e as migrações do Supabase em [`supabase/migrations/`](supabase/migrations/).

## Onde editar

| Arquivo | Responsabilidade |
| --- | --- |
| `web/public/erp/index.html` | Estrutura visual, menus e painéis |
| `web/public/erp/styles.css` | Estilo, cores e layout responsivo |
| `web/public/erp/app.js` | Navegação, formulários, cadastros e estoque |
| `web/app/api/company/route.ts` | Cadastro da empresa piloto |
| `web/app/api/records/route.ts` | API de produtos, clientes e serviços |
| `web/app/api/stock/route.ts` | Ajustes de estoque |
| `web/app/api/session/route.ts` | Estado da sessão e conexão |
| `web/lib/jvg-backend.ts` | Comunicação segura com Supabase |
| `supabase/migrations/` | Estrutura e permissões do banco |

## Rodar o projeto

No diretório `web/`, instale Node.js 22.13+ e pnpm, então execute:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

A versão atual usa Supabase Auth com sessão por cookies e funciona como aplicativo Next.js na Netlify. O futuro EXE terá uma etapa própria de empacotamento e autenticação.

## Configuração e segurança

- O banco Supabase é definido pela variável de ambiente `NEXT_PUBLIC_SUPABASE_URL`.
- Na Netlify configure `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ambas públicas) e `JVG_SUPABASE_SECRET_KEY` como **segredo de servidor**. Veja `web/.env.example`.
- Tokens da Focus NFe e certificado A1 **não** são parte do código-fonte e não devem ser publicados.
- A emissão fiscal ainda não foi habilitada. A integração com a Focus depende de configuração segura e homologação.
- Esta é a versão piloto. Não use para emissão de documentos fiscais reais ou comercialização sem testes, auditoria fiscal e ajustes de infraestrutura.

## Publicação

### Netlify

1. Importe este repositório na Netlify por **Add new project > Import an existing project**.
2. A configuração [`netlify.toml`](netlify.toml) escolhe a pasta `web`, executa `pnpm build` e publica o Next.js.
3. Adicione as três variáveis do exemplo em **Project configuration > Environment variables**; a chave `JVG_SUPABASE_SECRET_KEY` deve ter acesso apenas às Functions e não deve aparecer no código, nas variáveis `NEXT_PUBLIC_` ou nos logs.
4. No Supabase, configure a URL de redirecionamento de autenticação para `https://SEU-SITE.netlify.app/auth/callback` e o **Site URL** para o domínio da Netlify.
5. Publique novamente depois de configurar as variáveis. Abra `/login`, crie uma conta e confirme o e-mail para cadastrar a empresa piloto.

**Chave comprometida:** a primeira chave privada foi publicada em um commit do GitHub e deve ser revogada no painel Supabase. A limpeza do arquivo atual não elimina o histórico público.

O Site anterior no ChatGPT Sites continua existindo em um deploy separado. Esta versão do GitHub foi adaptada para o runtime do Next.js na Netlify; alterações aqui não atualizam o Site anterior automaticamente.
