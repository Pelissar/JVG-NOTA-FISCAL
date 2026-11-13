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
| `JVG_FOCUS_MASTER_TOKEN` | Somente servidor | Token Master Focus para consulta de CNPJ; nao reutilizar o token de emissao |
| `JVG_FOCUS_PILOT_COMPANY_ID` | Somente servidor | UUID da empresa piloto autorizada a usar o token |

Não coloque valores reais em `.env.example` ou em arquivos versionados. Use `.env.local` apenas para desenvolvimento local (não versionado) e segredos de ambiente da Netlify em produção.

Na Netlify, **não crie `JVG_SUPABASE_URL`**: esta variável antiga não é utilizada. Configure apenas `NEXT_PUBLIC_SUPABASE_URL` com a URL do projeto (sem marcar como segredo), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` como pública, e `JVG_SUPABASE_SECRET_KEY` como segredo no servidor. A URL e a chave publicável são destinadas ao navegador; a chave secreta nunca deve ser exposta.

A configuração de deploy libera **somente** as duas variáveis públicas `NEXT_PUBLIC_` da detecção de segredos da Netlify, pois o Next.js as incorpora legitimamente nos arquivos do navegador. O scanner permanece ativo para `JVG_SUPABASE_SECRET_KEY` e para possíveis outros segredos.

## Componentes principais

- `app/login/page.tsx`: login e cadastro com Supabase Auth.
- `app/auth/callback/route.ts`: confirmação de e-mail.
- `app/api/*`: endpoints Next.js com autenticação no servidor.
- `app/api/lookup/route.ts`: consulta de CEP (ViaCEP) e CNPJ (Focus, BrasilAPI; CNPJ.ws apenas como fallback), com validacao e prazo de resposta.
- `lib/supabase/server.ts`: sessão por cookies.
- `lib/jvg-backend.ts`: acesso seguro e filtrado ao banco.
- `public/erp/`: dashboard, estilos e cadastros da versão piloto.

### Etapa 8 — telas responsivas e consultas cadastrais

- O dashboard adapta a barra lateral para o modo recolhido em telas menores; a tabela pode rolar horizontalmente sem deslocar a página toda.
- Formulários grandes preservam cabeçalho e botões de salvar visíveis enquanto os campos têm rolagem própria, inclusive em notebooks de pouca altura.
- Na edição da empresa, os botões **Consultar** ao lado de CNPJ e CEP sugerem dados públicos de razão social, endereço e código IBGE. Na tela **Clientes**, a busca de CNPJ é para pessoa jurídica, e a de CEP completa o endereço do destinatário.
- A consulta de CNPJ usa a API oficial da Focus (com `JVG_FOCUS_MASTER_TOKEN`) e a BrasilAPI em paralelo para completar os campos disponiveis. A API publica CNPJ.ws fica como alternativa somente se as duas falharem, respeitando seu limite de consultas. CEP usa ViaCEP e BrasilAPI.
- A consulta CNPJ da Focus exige Token Master e aceita apenas CNPJ numerico de 14 digitos. Nao reutilize o token de homologacao de NF-e como Token Master. Se o Token Master nao estiver configurado, a tela informa que foram usadas fontes complementares.
- A Focus nao retorna IE, IM, nome fantasia, e-mail ou telefone nesse endpoint. Fontes complementares podem fornecer alguns desses dados; confirme IE/IM separadamente. Situacao cadastral e opcao pelo Simples sao apenas informativas e nao aprovam regime fiscal para emissao.
- Dados retornados apenas preenchem o formulário: **o usuário precisa conferir e salvar**. Tokens e credenciais do Supabase/Focus não entram em requisições do navegador para esses provedores.
- O endereço do cliente é salvo no JSONB já existente (`jvg_parties.address`). A migração `20261106_jvg_etapa8_cnpj_alfanumerico_clientes.sql` permite armazenar o novo CNPJ alfanumérico no cadastro de clientes, com validação dos dígitos no backend.

### Etapa 6 — cadastro fiscal do emitente

No painel web, vá em **Configurações → Editar empresa** para informar CNPJ, IE, IM, CNAE, contato fiscal, endereço completo com CEP/código IBGE e série/numeração planejada da NF-e de homologação. Os campos ficam em `public.jvg_companies`, com endereço em `address` (JSONB), sob autenticação e vínculo com a empresa.

O CNPJ aceita os formatos numérico e alfanumérico em vigor desde julho de 2026, com validação de dígitos verificadores pela regra da Receita Federal (ASCII - 48, módulo 11). O sistema permite **rascunhos incompletos**, mas apresenta a lista de campos pendentes. Dados preenchidos não representam autorização fiscal: emissão permanece desativada até revisão do contador e credenciamento Focus/SEFAZ.

**Estado fiscal:** a transmissão pela Focus NFe permanece desativada. Não há emissão real de NF-e/NFS-e nesta versão.

### Focus NFe — passo de homologação

1. No painel da Focus, cadastre o CNPJ real da empresa, envie o certificado A1 com senha por conexão segura e habilite NF-e em homologação. Confira IE, credenciamento, série e próxima numeração com o contador.
2. Para emissao em homologacao, configure `JVG_FOCUS_HOMOLOGACAO_TOKEN` e `JVG_FOCUS_PILOT_COMPANY_ID`. Para consulta cadastral de CNPJ, configure tambem `JVG_FOCUS_MASTER_TOKEN`; os tres valores sao segredos somente do servidor. Nao coloque tokens ou certificado no GitHub.
3. Somente o administrador da plataforma pode consultar `GET /api/focus/status`, após login e com vínculo à empresa piloto. `token_valid` significa somente autenticação aceita na consulta de uma referência inexistente: **não comprova certificado, autorização SEFAZ ou prontidão fiscal**.
   O botão de diagnóstico e o nome do fornecedor foram retirados do painel comum e da central fiscal. Os dados de diagnóstico ficam restritos à administração; o UUID de outra empresa e o token não são revelados.
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

### Etapa 9 — rascunhos NF-e em homologação (sem transmissão)

No painel, abra **Notas fiscais → Abrir rascunhos NF-e** ou vá a `/erp/nfe-drafts.html` após o login. A nova tela usa produtos e destinatários ativos já cadastrados e salva no Supabase via `/api/fiscal/nfe-drafts`.

- **GET**: lista até 50 documentos NF-e da empresa autenticada, somente em homologação.
- **POST**: valida destinatário e produtos contra os vínculos de `tenant_id` e `company_id`, verifica quantidade/preço/CFOP/CSOSN e guarda uma cópia de referência em `jvg_fiscal_documents.fiscal_payload` com estado `draft`.
- Valores comerciais são calculados em centavos. A série e numeração não são reservadas nesta fase; o registro não possui referência Focus, chave de acesso ou XML.
- Pendências de documento, NCM, CFOP, CSOSN e cálculos tributários aparecem para revisão. O fluxo inicial atende ao emitente piloto do **Simples Nacional**, sem pretender decidir tributos automaticamente.
- Não há endpoint de autorização, cancelamento ou envio à Focus nesta etapa. Nenhum token ou certificado é enviado pelo navegador.
- Requer a tabela `jvg_fiscal_documents` da migração base já aplicada. A criação fica bloqueada se empresa, destinatário ou produtos não forem válidos/ativos.

Execute `pnpm test:nfe` para conferir as validações básicas. Antes de liberar transmissão real: validar tabela fiscal e regras IBS/CBS com contador, gerenciar numeração idempotente, integrar as respostas assíncronas da Focus, webhooks e arquivos XML/DANFE.

### Etapa 10 — catálogo CFOP com personalização por empresa

No painel privado, abra **Tabela CFOP** na barra lateral ou **Notas fiscais → Consultar CFOP**. A página `/erp/cfop.html` permite pesquisar por código, título, nota explicativa e grupo (entradas e saídas); exibe a nota explicativa oficial completa. O rascunho NF-e tem sugestões dos códigos disponíveis.

- São **619 CFOPs**, importados da **Tabela CFOP do Portal Nacional da NF-e, Informe Técnico 2023.002 v2.10, publicada em 04/09/2026**. Fonte oficial: <https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=0q5q+Cu5ZJ8=>. A cópia versionada está em `data/cfop-official-2026.json`, com URL de origem, data e hash SHA-256 do XLSX. O importador `scripts/import-cfop-official.py` utiliza `openpyxl` e verifica códigos únicos e colunas obrigatórias. **Atualizações oficiais futuras exigem revisão e nova importação; não são automáticas.**
- O backend oferece `GET /api/fiscal/cfop` (catálogo e personalizações), `POST /api/fiscal/cfop` (salvar apelido) e `DELETE /api/fiscal/cfop?code=...` (restaurar padrão), sempre com autenticação, filtro de empresa e verificação de permissão. A interface permite renomear **apenas o nome interno**, nunca o código, título ou descrição fiscal oficial.
- Os apelidos ficam na tabela `public.jvg_cfop_overrides`, com chave `(tenant_id, company_id, code)`, referência obrigatória à empresa e **RLS**. Aplicar uma vez a migração `supabase/migrations/20261106_jvg_etapa10_cfop_personalizado.sql` no Supabase do projeto antes de editar apelidos. Se a migração não estiver aplicada, o catálogo oficial fica consultável, mas sem salvar personalizações.
- Há validação de código oficial no servidor, separação de registros por empresa e acesso de escrita limitado a `owner`, `admin`, `manager` e `operator`. Contas somente de leitura podem consultar a tabela.
- O diagnóstico técnico de autorização fiscal continua no servidor e não é mostrado aos usuários normais; não são fornecidos tokens via navegador. O código-fonte do repositório é público, portanto ocultar o nome do provedor da UI **não significa ocultar a integração de quem inspeciona o código**.
- Verificar com `pnpm test:cfop` e `pnpm build`. O catálogo não é motor de decisão tributária: a seleção do CFOP precisa de revisão fiscal por operação.

### Etapa 11 — cadastros reais e CFOP sugerido por produto

- Foram removidos os produtos, clientes e serviços fictícios predefinidos no painel. O ERP começa com listas vazias e somente carrega registros do Supabase, depois de validar a sessão e o vínculo com a empresa. Erros de conexão não ativam um modo de simulação e operações de cadastro/estoque não são salvas no navegador.
- O antigo armazenamento local da simulação **não é mais lido nem alterado automaticamente**, para não apagar silenciosamente possíveis cadastros manuais não sincronizados. Registros reais existentes no banco não foram excluídos.
- O cadastro de produtos possui o campo opcional `default_cfop`. Só são aceitos códigos presentes no catálogo oficial. O painel oferece sugestões com os nomes personalizados da empresa.
- Ao selecionar um produto no rascunho de NF-e, o CFOP sugerido preenche inicialmente o campo, mas o operador pode alterá-lo. Código inexistente na tabela oficial gera pendência no rascunho; nenhum CFOP é tratado como classificação tributária definitiva.
- Aplicar a migração `supabase/migrations/20261106_jvg_etapa11_cfop_sugerido_produto.sql` antes do deploy que usa a coluna. A transmissão fiscal permanece desabilitada.

### Focus webhook and NFS-e Nacional

- Configure `JVG_FOCUS_WEBHOOK_SECRET` as a server-only random secret with at least 32 characters. `JVG_FOCUS_WEBHOOK_HEADER` is optional and defaults to `X-JVG-Focus-Webhook`.
- When registering hooks with Focus, set the `authorization` value to the same secret and `authorization_header` to the configured header name. Register separate events for `nfe` and `nfsen`; registration is manual.
- The callback only updates fiscal documents stored in homologation. Its SQL migration adds atomic event deduplication and the service ISS code. Apply `supabase/migrations/20261112_jvg_fiscal_webhook_nfse.sql` manually before deploying the callback.
- Focus National NFS-e uses `POST /v2/nfsen?ref=...`; this client is pinned to the homologation host. The mapper accepts service catalog and service order snapshots, but requires accountant-reviewed NFS-e classifications, DPS number/series, service municipality, and National ISS code. It does not infer tax choices or include IBS/CBS fields.
- This is a mapper/client foundation; no NFS-e screen or transmission route is wired yet. The connected Supabase project did not expose the migration columns/RPC when checked, so the webhook cannot process callbacks there yet. Production emission remains unavailable from this integration.
