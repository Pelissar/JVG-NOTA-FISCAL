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
- `app/api/lookup/route.ts`: consulta de CEP (ViaCEP) e CNPJ (BrasilAPI), com validação e prazo de resposta.
- `lib/supabase/server.ts`: sessão por cookies.
- `lib/jvg-backend.ts`: acesso seguro e filtrado ao banco.
- `public/erp/`: dashboard, estilos e cadastros da versão piloto.

### Etapa 8 — telas responsivas e consultas cadastrais

- O dashboard adapta a barra lateral para o modo recolhido em telas menores; a tabela pode rolar horizontalmente sem deslocar a página toda.
- Formulários grandes preservam cabeçalho e botões de salvar visíveis enquanto os campos têm rolagem própria, inclusive em notebooks de pouca altura.
- Na edição da empresa, os botões **Consultar** ao lado de CNPJ e CEP sugerem dados públicos de razão social, endereço e código IBGE. Na tela **Clientes**, a busca de CNPJ é para pessoa jurídica, e a de CEP completa o endereço do destinatário.
- A consulta de CNPJ usa a **BrasilAPI**, que agrega informações cadastrais públicas, e não constitui consulta direta ou oficial à Receita Federal. A de CEP usa o **ViaCEP**. Ambas podem ficar indisponíveis e nunca substituem a conferência dos dados com o cliente e o contador.
- Em caso de falha do primeiro serviço, o CEP tenta a BrasilAPI e o CNPJ numérico tenta a API pública CNPJ.ws (com limite próprio de consultas). O erro diferencia ausência de cadastro e indisponibilidade dos provedores. O preenchimento manual continua disponível.
- Dados retornados apenas preenchem o formulário: **o usuário precisa conferir e salvar**. Tokens e credenciais do Supabase/Focus não entram em requisições do navegador para esses provedores.
- O endereço do cliente é salvo no JSONB já existente (`jvg_parties.address`). A migração `20261106_jvg_etapa8_cnpj_alfanumerico_clientes.sql` permite armazenar o novo CNPJ alfanumérico no cadastro de clientes, com validação dos dígitos no backend.

### Etapa 6 — cadastro fiscal do emitente

No painel web, vá em **Configurações → Editar empresa** para informar CNPJ, IE, IM, CNAE, contato fiscal, endereço completo com CEP/código IBGE e série/numeração planejada da NF-e de homologação. Os campos ficam em `public.jvg_companies`, com endereço em `address` (JSONB), sob autenticação e vínculo com a empresa.

O CNPJ aceita os formatos numérico e alfanumérico em vigor desde julho de 2026, com validação de dígitos verificadores pela regra da Receita Federal (ASCII - 48, módulo 11). O sistema permite **rascunhos incompletos**, mas apresenta a lista de campos pendentes. Dados preenchidos não representam autorização fiscal: emissão permanece desativada até revisão do contador e credenciamento Focus/SEFAZ.

**Estado fiscal:** a transmissão pela Focus NFe permanece desativada. Não há emissão real de NF-e/NFS-e nesta versão.

### Focus NFe — passo de homologação

1. No painel da Focus, cadastre o CNPJ real da empresa, envie o certificado A1 com senha por conexão segura e habilite NF-e em homologação. Confira IE, credenciamento, série e próxima numeração com o contador.
2. Configure as duas variáveis `JVG_FOCUS_*` acima no painel da Netlify, no ambiente Production. **Se o plano permitir separar escopos**, use apenas **Functions** para o token; a compilação não precisa conhecê-lo. Em planos sem controle de escopo, mantenha os valores nas variáveis privadas da Netlify. Não coloque token ou certificado no GitHub.
3. Acesse `GET /api/focus/status` após entrar com o usuário da empresa piloto. `token_valid` significa somente autenticação aceita na consulta de uma referência inexistente: **não comprova certificado, autorização SEFAZ ou prontidão fiscal**.
   O painel **Configurações → Focus NFe · Homologação** e a **Central de notas fiscais** agora exibem um botão para fazer esta verificação sem conhecer o token.
   Se a empresa autenticada não corresponder ao UUID em `JVG_FOCUS_PILOT_COMPANY_ID`, o painel mostra o UUID **da própria empresa logada** para conferir na Netlify. O UUID de outra empresa e o token não são revelados.
4. Próxima fase: cadastro fiscal completo de emitente/destinatário/produtos, motor de validações e NF-e de teste com referência idempotente, depois consulta de resultado, XML, DANFE e eventos.

Esse endpoint de validação não emite, cancela nem altera documentos. A emissão continuará bloqueada até os requisitos fiscais estarem conferidos. O token de homologação é exclusivo da empresa piloto; cada empresa comercial precisará de credenciais próprias e isolamento por tenant.

Leia também o [README da raiz](../README.md) para o procedimento de publicação na Netlify.

### Página pública, acesso ao ERP e tratamento do cache

- A rota `/` é uma página pública de apresentação. O botão de entrada abre `/login`.
- O `proxy.ts` (Next.js 16) exige sessão Supabase válida nas rotas `/erp/*`. A tela de gestão é privativa; os endpoints de API têm **suas próprias validações de autenticação e autorização**, independentemente do proxy.
- O painel possui navegação recolhível para telas estreitas e configurações em duas colunas nas telas largas. Os módulos fiscais ainda não transmitem documentos.
- `lib/focus/runtime-env.ts` consulta o token e o UUID piloto somente em tempo de execução no servidor, evitando que o compilador os incorpore ao cache Turbopack. **Não desative a verificação de segredos da Netlify** nem coloque `JVG_FOCUS_HOMOLOGACAO_TOKEN` nas variáveis públicas.
- O comando `pnpm build` agora remove automaticamente **apenas** os caches descartáveis `.next/cache/turbopack` e `.netlify/.next/cache/turbopack` após a compilação; eles não são necessários para o site em execução. Isso evita que arquivos `.sst` restaurados de builds antigos sejam incluídos na inspeção da Netlify.
- Se um deploy ainda acusar segredos em outro cache antigo, use **Deploys → Retry without cache** na Netlify para iniciar uma compilação sem cache. Não é preciso compartilhar credenciais nem desabilitar o scanner de segredos.

### Roadmap auditado: pendências antes da comercialização

1. **Segurança multiempresa:** revisão de RLS, permissões por papel, provisionamento administrativo, auditoria de acessos, backups, política de retenção e isolamento dos tokens por empresa.
2. **Dados fiscais completos:** cadastro tributário por regime/UF, NCM/CEST/CFOP/CST/CSOSN, PIS/Cofins/ISS, IBS/CBS, regras atualizáveis, validações por contador e cadastro de emitentes, destinatários e transportadoras.
3. **Emissão NF-e/NFC-e:** geração de rascunhos, itens, totalizadores, sequência/série transacional, referência idempotente, envio em homologação à Focus, tratamento de rejeições, consulta, cancelamento, CC-e e inutilização quando aplicáveis.
4. **Emissão NFS-e/CT-e/MDF-e:** implementação por modelo e município/UF, cenários de serviço e transporte e validação dos dados específicos com as regras vigentes.
5. **Documentos e operação:** XML e DANFE/DACTE/DAMDFE, armazenamento seguro, exportação e compartilhamento com contador, pedidos, vendas/PDV, contas e estoque integrado sem duplicação de movimentos.
6. **Qualidade e entrega:** testes automatizados end-to-end e de integração, homologação com dados fictícios, telemetria, alertas, limites de requisição, reprocessamento e infraestrutura para o futuro EXE conectado ao servidor.

Nenhum módulo deve ser apresentado como autorizado para emissão real antes de seus respectivos testes e credenciamentos.
