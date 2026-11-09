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
