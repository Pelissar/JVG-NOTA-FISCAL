# JVG Nota Fiscal — ERP Web (Piloto)

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

O projeto foi inicialmente hospedado via ChatGPT Sites, com autenticação fornecida pela plataforma. Para instalar em hospedagem independente ou transformar em EXE, será necessário adaptar a autenticação e o ambiente do servidor.

## Configuração e segurança

- O banco é o Supabase: `https://gkhxcuysqyvnkdkzsxxm.supabase.co`.
- No servidor, configure `JVG_SUPABASE_SECRET_KEY` como **segredo**, nunca no navegador ou GitHub. Consulte `web/.env.example`.
- Tokens da Focus NFe e certificado A1 **não** são parte do código-fonte e não devem ser publicados.
- A emissão fiscal ainda não foi habilitada. A integração com a Focus depende de configuração segura e homologação.
- Esta é a versão piloto. Não use para emissão de documentos fiscais reais ou comercialização sem testes, auditoria fiscal e ajustes de infraestrutura.

## Publicação

O Site publicado foi criado no ChatGPT Sites e mantém um repositório de deploy separado. **Alterar este GitHub não publica automaticamente no Site atual.** As próximas etapas devem adotar este repositório como fonte principal e configurar um fluxo de publicação adequado.
