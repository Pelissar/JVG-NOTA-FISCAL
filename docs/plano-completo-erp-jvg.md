# JVG NOTA FISCAL — Auditoria e plano de entrega por etapas
Data da revisão: 2026-11-09. Base: branch feature/erp-vendas-design-unificado. Atualização: auditoria de 53 rotas da Nuts incorporada em `docs/auditoria-referencia-nuts-53-rotas.md`. Documento de trabalho; não é certificado de homologação.

## Legenda
- Implementado no código: funcionalidade identificada no repositório, mas não necessariamente testada em produção.
- Parcial: há telas, APIs ou estruturas, porém falta fluxo de ponta a ponta.
- Não concluído: não demonstrado ou ainda não desenvolvido.
- Bloqueio de produção: exige migração, homologação, segurança, teste ou aprovação antes de ativar.

## Etapa 0 — Estabilização e auditoria (EM ANDAMENTO)
1. Inventariar telas, rotas, APIs, banco, migrações e permissões por empresa.
2. Revisar mudanças não publicadas e corrigir navegação entre módulos.
3. Executar pnpm test:erp, node --check e pnpm build no CI.
4. Testar manualmente desktop/mobile e navegação; registrar evidências.
5. Revisar RLS, permissões, segregação de dados e segredos.
6. Criar critérios de aceite para cada etapa.

## Etapa 1 — Cadastros (PARCIAL)
- Pessoas: cliente/fornecedor/transportadora, múltiplos papéis, filtro, número sequencial por empresa, IE, IM, razão social, CPF/CNPJ, endereço e código IBGE.
- Produtos: SKU, NCM, CEST, GTIN, CFOP, origem, unidade, preços, categoria, perfil tributário.
- Serviços: códigos LC 116/NBS, preço e dados fiscais.
- Empresa/estabelecimentos: CNPJ, IE, IM, CNAE, regime, município IBGE, endereços e responsáveis.
- Migração de numeração aplicada ao Supabase em 2026-11-09 e verificada para o registro existente; faltam testes de persistência e edição, CPF com dígitos verificadores, IE por UF e indicador de contribuinte, inscrição SUFRAMA quando aplicável, importação/exportação segura, deduplicação, cadastro de unidades/filiais e regras de validação por tipo de documento.
- Aceite: CRUD e filtros com banco real, isolamento por empresa, registros antigos preservados e teste de concorrência de numeração.

## Etapa 2 — Vendas (PARCIAL)
- Fluxo de venda e baixa transacional de estoque existe no código; interface redesenhada na branch.
- Faltam: teste real da RPC com autenticação/service role, aplicação e teste da migração de idempotência em homologação, devolução/cancelamento com estorno, descontos, frete, múltiplos pagamentos, integração financeiro/caixa, reserva e permissões.
- Aceite: criar venda, impedir estoque negativo e duplicidade, conferir saldo e trilha de auditoria.

## Etapa 3 — Estoque (PARCIAL)
- Há produtos, movimentos e cálculo de saldo.
- Faltam: entradas por compra/XML, inventário, transferências, depósitos, lotes/validade/série quando aplicável, custo médio, ajustes auditados, reservas e relatórios de divergência.
- Aceite: saldo conciliado por local e rastreabilidade de cada movimento.

## Etapa 4 — Financeiro (NÃO CONCLUÍDO)
- Contas a pagar/receber, títulos, parcelas, vencimentos, baixa, juros/multa/desconto, conciliação, fornecedores e relatórios.
- Integração com vendas, compras e documentos fiscais.
- Aceite: saldos e títulos conciliados, com permissões e auditoria.

## Etapa 5 — Caixa/PDV (NÃO CONCLUÍDO)
- Abertura, suprimento, sangria, fechamento, operadores, meios de pagamento, estorno e conciliação.
- Integrar NFC-e conforme UF, CSC e homologação.
- Aceite: fechamento reproduzível e trilha de cada operação.

## Etapa 6 — Fiscal NF-e modelo 55 (RASCUNHOS, NÃO EMISSOR)
- A interface de rascunhos foi dividida em abas. Transporte e pagamento ainda não persistem; não existe emissão oficial.
- Implementar emitente, destinatário, cabeçalho, finalidade, série, número, CFOP, itens, NCM/CEST/GTIN, CST/CSOSN, ICMS, IPI, PIS/COFINS e IBS/CBS/IS conforme leiaute e vigência.
- Implementar frete/volumes, pagamentos, totais, informações adicionais e documentos referenciados.
- Validar e montar payload Focus NFe, transmitir em homologação, consultar retorno, tratar rejeição/timeout/idempotência, registrar chave, protocolo, XML e DANFE.
- Eventos: cancelamento, CC-e, inutilização, manifestação quando aplicável, armazenamento e auditoria.
- Aceite: homologação ponta a ponta com SEFAZ e validação fiscal; produção somente com autorização explícita.

## Etapa 7 — Outros documentos fiscais (NÃO CONCLUÍDO)
- NFC-e 65: venda ao consumidor, CSC, QR Code, contingência e regras da UF.
- NFS-e: DPS, município/padrão nacional, retenções e eventos.
- CT-e 57 e MDF-e 58: requisitos específicos de transporte, quando necessários.
- NF-e recebidas: distribuição/manifestação, XML, conferência e entrada de estoque/financeiro.
- Aceite: fluxos independentes homologados por modelo e localidade.

## Etapa 8 — Relatórios e indicadores (PARCIAL)
- Indicadores básicos e exportação CSV existem.
- Faltam: vendas por período, margens, estoque, compras, contas, fluxo de caixa, tributos, notas autorizadas/rejeitadas e relatórios por empresa/filial.
- Aceite: resultados reconciliados com registros transacionais e filtros.

## Etapa 9 — Segurança e conformidade (PARCIAL)
- Autenticação, permissões viewer, RLS e segregação por empresa existem em parte.
- Revisar todas as rotas, auditoria de alterações, backup/restauração, retenção LGPD, limites de taxa, CSRF, segredos, certificados, webhooks e alertas.
- Revogar qualquer chave privada anteriormente exposta e rotacionar credenciais.
- Aceite: testes negativos de acesso entre empresas, análise de vulnerabilidades e restauração ensaiada.

## Etapa 10 — Offline/sincronização (NÃO CONCLUÍDO)
- Definir quais operações podem ficar offline, fila local segura, conflitos, reenvio idempotente e sincronização.
- Não transmitir documento fiscal sem as condições legais e técnicas do modelo/UF.
- Aceite: testes de desconexão, reconexão, duplicação e conflito.

## Etapa 11 — Qualidade, publicação e operação (PENDENTE)
- CI de lint/test/build, testes de integração, E2E, acessibilidade, mobile, performance e observabilidade.
- Ambiente de homologação isolado, migrações reversíveis, backup e plano de rollback.
- Publicar somente após aprovação, validar Netlify e percorrer fluxos reais sem dados fictícios.
- Aceite: checklist assinado, métricas, monitoramento e plano de suporte.

## Riscos prioritários identificados
1. Branch contém mudanças ainda não publicadas e sem validação completa.
2. Migração de numeração de cadastros aplicada no banco; ainda faltam testes de concorrência e novos cadastros.
3. Tela fiscal mostra abas de transporte e pagamento sem persistência.
4. Emissão fiscal está bloqueada e não deve ser chamada de pronta.
5. Venda não foi testada ponta a ponta; API, interface e migração de idempotência foram implementadas no código, mas aguardam execução da migração e teste de concorrência em homologação.
6. Financeiro/caixa e demais modelos fiscais não estão concluídos.
7. RLS, segredos, homologação, backup e rollback exigem revisão.

## Ordem recomendada
Estabilização → Cadastros → Vendas/Estoque → Financeiro/Caixa → NF-e 55 homologada → NFC-e/NFS-e → Relatórios → Segurança e Offline → Publicação validada. Segurança e testes acompanham todas as etapas.

## Backlog GitHub derivado da auditoria Nuts (2026-11-09)
- [#3](https://github.com/Pelissar/JVG-NOTA-FISCAL/issues/3): P0 verificar/revogar chave privada comprometida, registrar apenas prova de revogação.
- [#4](https://github.com/Pelissar/JVG-NOTA-FISCAL/issues/4): P0 idempotência transacional de venda.
- [#5](https://github.com/Pelissar/JVG-NOTA-FISCAL/issues/5): P1 paginação e agregação de estoque sem limites silenciosos.
- Correção aplicada: seletor da tela de vendas filtra clientes ativos e elegíveis, sem fornecedores/transportadoras exclusivos; teste de contrato incluído.
- PR de integração: [#2](https://github.com/Pelissar/JVG-NOTA-FISCAL/pull/2), não integrado nem implantado, aguarda testes de CI/preview.

### Implementação inicial em 2026-11-09 — prevenção de venda duplicada
- `supabase/migrations/20261109_jvg_sale_idempotency.sql`: nova assinatura RPC com chave UUID por empresa, tabela de requisições e replay transacional.
- `web/app/api/sales/route.ts`: exige `requestId` válido e encaminha para a RPC.
- `web/public/erp/sales.js`: mantém a mesma chave nas tentativas de reenvio da tela e restringe seleção a clientes ativos.
- `web/scripts/sales-contract.test.mjs`: testes de contrato atualizados; não substituem testes integrados.
- **Bloqueio:** não integrar/deployar esta mudança antes de aplicar a migração em ambiente alvo; caso contrário a API de venda falhará por assinatura RPC ausente. Não aplicada à produção nesta sessão.

### Validação de CPF isolada (2026-11-09)
- Extraído `isValidCpf` para `web/lib/fiscal/cpf.ts` para reutilização e teste direto.
- `web/scripts/cpf-validation.test.mjs` cobre CPFs válidos e inválidos; incluído na suíte `test:erp` com suporte a strip-types do Node 22.
- Execução local/CI ainda pendente; código registrado na branch de desenvolvimento.

### Histórico de vendas aprimorado (2026-11-09)
- `web/public/erp/sales.html`, `.js`, `.css`: pesquisa por ID/observação/situação/cliente ID, filtro por situação, contagem de resultados e exportação CSV dos registros filtrados.
- `web/scripts/sales-contract.test.mjs`: testes de contrato para os controles.
- **Limitação:** a API `/api/sales` retorna somente as 200 vendas mais recentes; a exportação é apenas desse conjunto carregado, não de todo o histórico. Paginação e exportação server-side são trabalho futuro.
- Testes automatizados e deploy não foram verificados nesta etapa.

### Paginação de vendas e proteção de exportação CSV (2026-11-09)
- `GET /api/sales?page=N` retorna até 50 vendas por página, mais `hasMore`, respeitando tenant e empresa; paginação por offset com limite de página validado.
- Histórico com botões Anterior/Próxima; KPIs e pesquisa continuam representando apenas a página carregada, não o universo inteiro.
- CSV corrigido para usar CRLF e BOM UTF-8 reais, e neutralizar células iniciadas por operadores de fórmula; exporta somente a página filtrada.
- Testes de contrato atualizados. **Sem migração ou publicação em produção**; execução completa dos testes ainda não confirmada.

### Orçamentos comerciais — implementação inicial (2026-11-09)
- Migração **pendente**, não aplicada: `supabase/migrations/20261109_jvg_quotes.sql`, com rascunhos por empresa, itens em JSONB, validade, situação e total.
- API `GET/POST /api/quotes`: autenticação, escopo tenant/empresa, validação de cliente, produtos, serviços, quantidades, centavos, totais e permissões; listagem paginada de 30 registros.
- Interface `/erp/quotes.html` e `quotes.js`: seleção de cliente, itens de catálogo real, validade, observações, cálculo de total, gravação de rascunho e histórico; link no menu.
- Não converte em venda, não movimenta estoque, não gera cobrança ou NF-e. Status adicionais ainda não têm fluxo de aprovação.
- Corrigido snapshot de unidade para serviços nos SQLs de venda (serviços não possuem coluna `unit`).
- **Não publicar** sem revisão de migração, testes e autorização do usuário. Não houve deploy manual nem aplicação em Supabase nesta etapa.

### Ciclo de situação dos orçamentos (2026-11-09)
- API `PATCH /api/quotes` com autenticação, permissão de escrita, validação de transições e atualização condicional por tenant, empresa, ID e situação anterior.
- Rascunho → enviado ou recusado; enviado → aceito, recusado ou expirado. Situações finais não têm transição reversa nesta versão.
- Histórico de orçamentos oferece ações com confirmação e atualização da lista; testes de contrato adicionados.
- Aceitar orçamento **não** cria pedido, venda ou movimentação de estoque; conversão transacional será etapa separada.
- Migração `jvg_quotes` permanece pendente. Sem publicação em produção.

### Pedido comercial a partir de orçamento aceito (2026-11-09)
- Migração **não aplicada** `supabase/migrations/20261109_jvg_orders.sql`: tabela de pedidos isolada por empresa, snapshot de itens, vínculo obrigatório ao orçamento e unicidade por empresa/orçamento.
- RPC `jvg_create_order_from_quote` cria pedido somente de orçamento aceito, com `ON CONFLICT DO NOTHING` e retorno do mesmo pedido em reenvios. Não movimenta estoque, não confirma venda, não cria cobrança ou nota.
- API autenticada `GET/POST /api/orders`, listagem paginada e conversão com validação de permissões.
- Tela `/erp/orders.html` e menu; botão **Gerar pedido** nos orçamentos aceitos.
- Corrigida consulta de catálogo dos orçamentos: verifica IDs solicitados, sem limitar validação aos primeiros mil produtos/serviços.
- Contratos de teste adicionados, **execução integral ainda pendente**.
- Próximas etapas: aprovar pedidos, reservar/baixar estoque somente em confirmação transacional, evitar duplicidade na conversão pedido→venda e conferir regras de vencimento dos orçamentos.
- **Não publicar sem migrações homologadas, testes e autorização explícita.**

### Controle de cancelamento e validade comercial (2026-11-09)
- API `PATCH /api/orders` permite cancelar somente pedido aberto, com origem, autenticação, permissão e filtros por empresa e estado; ação com confirmação na tela de pedidos.
- Aceite de orçamento verifica `valid_until` em data local de São Paulo, na mesma atualização condicional; propostas vencidas não podem ser aceitas.
- Testes de contrato ampliados. Testes de integração, build e validação de migrações **ainda pendentes**.
- Cancelamento de pedido não estorna venda/estoque (a conversão pedido→venda ainda não foi implementada).
- Sem alterações de produção, migração aplicada ou merge em `main`.

### Requisito permanente: interface responsiva em qualquer computador (2026-11-09)
- Todas as telas novas e alteradas devem adaptar-se automaticamente à largura e altura disponíveis, incluindo monitores grandes, notebooks, janelas lado a lado, tablets e celulares; nunca exigir resolução fixa.
- Usar grids fluidos com `minmax(0,...)`, quebras progressivas, controles sem largura mínima indevida, modais limitados à altura da janela e tabelas com rolagem horizontal local.
- CSS compartilhado `web/public/erp/commercial-responsive.css` aplicado a orçamentos e pedidos; remove estilos fixos/duplicados das páginas.
- `responsive.css` agora mantém rolagem vertical normal nas páginas independentes e rolagem interna no painel com sidebar.
- Contratos de responsividade incluídos em testes de orçamentos e pedidos. Revisão visual real em múltiplas resoluções continua pendente antes de publicação.
- Regra de aceite futura: verificar pelo menos 1366×768, 1920×1080, 1280×720, 1024×768 e 390×844, inclusive com zoom de navegador e janela redimensionada.

### Redesign JVG Horizon e simplificação da navegação (2026-11-09)
- Nova identidade visual própria `design-system.css`: cores, hierarquia, cards, foco acessível, responsividade para monitores grandes e janelas pequenas.
- Menu principal reorganizado por tarefas: Início, Comercial (Orçamentos, Pedidos, Vendas), Cadastros (Pessoas e clientes, Produtos, Serviços), Operação (Estoque, Relatórios), Fiscal (Central, Rascunhos NF-e, Configuração fiscal expansível) e Administração (Configurações).
- Removidos links duplicados para a mesma central fiscal e itens de navegação que aparentavam funcionalidades ainda indisponíveis (NFC-e, NFS-e, Financeiro e Transporte). Nenhum módulo de dados foi apagado; funcionalidades futuras permanecem documentadas e podem voltar ao menu quando operacionais.
- Painel inicial: retirados cards de módulos repetidos e incluídos atalhos comerciais reais para orçamento, pedido, venda e rascunho NF-e.
- Identidade aplicada ao painel, vendas, orçamentos, pedidos e páginas fiscais; tema fiscal separado para preservar estilos específicos.
- Teste estático `design-navigation.test.mjs` incluído na suíte; **revisão visual, navegação por teclado e execução de testes/build ainda pendentes**.
- Referência Nuts usada apenas como inspiração de organização por módulos; JVG mantém identidade e implementação próprias, sem copiar marca ou layout.
- Não houve merge, deploy manual nem migração no banco de produção.

### Polimento da navegação JVG Horizon (2026-11-09)
- `app.js` agora sincroniza seção selecionada com fragmento da URL e atualiza `aria-current`; o menu móvel mantém `aria-expanded` consistente ao abrir/fechar/navegar.
- `navigation.js` adiciona destaque para links de rota atual e atalhos Home/End no menu lateral; `index.html` declara `aria-controls`.
- Testes estáticos adicionados para verificar navegação e acessibilidade.
- Sem build local ou teste visual em navegador nesta etapa; revisar em preview isolado antes de liberar. Sem deploy manual, merge ou migração de produção.
