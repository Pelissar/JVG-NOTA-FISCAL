# Auditoria funcional e técnica — sistema Nuts

**Data da inspeção:** 9 de novembro de 2026  
**Endereço:** https://sistema.nuts.app.br  
**Objetivo:** documentar a estrutura funcional para orientar a construção do ERP JVG inspirado no Nuts.

## Escopo e limites

A sessão já estava autenticada. Percorri as 53 rotas observadas entre o painel, o perfil e os menus do sistema. Também examinei telas de lista, filtros avançados, categorias de configuração, o formulário de produto, etapas iniciais de uma NF-e, um lançamento em Contas a Receber, o marketplace, as integrações e o atendimento por chat.

A inspeção foi feita em leitura. Não emiti notas, lancei pagamentos, excluí cadastros, contratei módulos, conectei integrações nem salvei formulários. Nomes, documentos e valores dos registros da empresa foram omitidos.

O nível de cobertura é completo para a navegação e para as opções visíveis nos principais fluxos. Algumas ações dependem de dados obrigatórios ou de credenciais; elas não foram executadas. A rota Pessoas também ficou indisponível por um erro de execução descrito adiante.

## Navegação observada

O cabeçalho organiza o sistema em seis grupos. Além deles há o painel inicial, o perfil e o menu de usuário.

| Grupo | Opções encontradas |
|---|---|
| Movimentações | NF-e; PDV – Pré-venda e NFC-e; Compras; Orçamentos; Pedidos; Monitor NF-e; Atendimento; Ordem de Produção; Ordem de Compra; Relatórios |
| Logística | Veículos; Motoristas; MDF-e |
| Financeiro | Movimento do Caixa; Contas a Receber; Contas a Pagar; Centro de Custos; Crédito de Clientes; Links; Bancos; Conciliação Bancária; Conta Digital; Plano de Contas; DRE; Metas; Relatórios |
| Cadastros | Pessoas; Produtos; Unidades; Grupos; Usuários; Vendedores; Contador; Kit; Variações; Parcelamentos; Terminal de Consulta; Lista de Preços; Relatórios |
| Apps | Marketplace; Integrações; Smart POS; Terminais de Venda |
| Configurações | Emitente; Ambiente; Naturezas; Tributações; Perfil Tributário; Gerais; Arquivos Contábeis; Assinatura |

## Painel inicial

O dashboard reúne indicadores de pessoas e produtos, valores a receber e a pagar, ticket médio, margem, vendas, meta de faturamento, inadimplência, relação financeira e comparação de vendas entre períodos. Há blocos para aniversariantes, produtos mais vendidos, maiores clientes, caixas abertos e estoque crítico.

Os seletores mudam o período ou a métrica de alguns gráficos. Os atalhos abrem NF-e, NFC-e, Orçamentos, Pedidos e Atendimento. Há opção para editar o painel e uma ligação para ver produtos zerados.

## Vendas, compras e documentos fiscais

**NF-e.** A lista mostra número, cliente, CFOP, data de emissão, status e total. O filtro permite número, cliente, CFOP, emissão e status. Os estados visíveis são Todos, Autorizada, Cancelada, Editando, Inutilizada e Rejeitada. Ações por documento incluem visualizar PDF, editar, baixar arquivo, cancelar, compartilhar por WhatsApp e enviar por e-mail. A tabela permite ordenação, paginação de 10 a 100 linhas, impressão e seleção de registros.

**Criação de NF-e.** O formulário é um assistente por etapas: Natureza, Destinatário, Produtos, Total da NF-e, Faturamento, Transportador opcional e Intermediador opcional. A primeira etapa solicita natureza, CFOP, série, finalidade, vendedor, data de emissão, data de saída e hora. A finalidade inicialmente apresentada é Normal. Os atalhos visíveis são F4 para voltar, F5 para avançar e F1 para cancelar. O tipo de NF-e pode ser alternado entre saída e a outra modalidade disponível no controle da tela. As próximas etapas só ficam habilitadas após preencher os dados exigidos.

**PDV e NFC-e.** O menu oferece pré-venda e emissão de NFC-e. A rota observada apresentou vendas realizadas, com número, emissão, cliente, CPF/CNPJ, forma de pagamento, status, chave de acesso e valor. O fluxo de caixa e a criação da venda não foram concluídos.

**Compras.** A lista tem importação de XML e registros com número de NF-e, modelo, fornecedor, datas de entrada e emissão, chave de acesso e total. Também há uma seção separada de vendas realizadas na tela.

**Orçamentos e pedidos.** Orçamentos mostram número, solicitante, cliente, total, status e validade. Pedidos mostram número, cliente, vendedor, solicitante, datas de validade e criação, valor e status. Ambos usam tabela paginada e permitem ordenação.

**Monitor NF-e.** A lista acompanha número, fornecedor, chave de acesso, emissão, total e status, com ações por documento.

**Atendimento.** A lista apresenta número, cliente, usuário, data do atendimento, negócio e ações.

**Ordens.** Ordem de Produção lista produto, responsável, início, término, previsão, status e ações. Ordem de Compra lista fornecedor, datas de solicitação e criação, valor, status e ações.

**Relatórios de movimentações.** A página reúne relatórios de vendas resumidas e detalhadas; vendas por NCM; itens mais vendidos; PIS/COFINS; vendas importadas; fechamento de caixa; SPED; Sintegra; XML de vendas; compras e XML de compras; orçamentos e produtos orçados; pedidos, resumo e carregamento; condicionais e condicionais por vendedor. Existem filtros de período, cliente, fornecedor, grupo, forma de pagamento e modelo de relatório, além de opções para considerar CFOPs de remessa/devolução e mostrar ou ocultar custo/lucro.

## Logística e MDF-e

**Veículos** usa descrição, RENAVAM e placa. **Motoristas** usa nome e CPF. **MDF-e** reúne número, status, jornada, emissão, motorista, veículo e ações. As telas permitem paginação e filtros; nenhuma transmissão fiscal foi executada.

## Financeiro

**Movimento do Caixa** lista data, descrição, meio de pagamento, plano de contas e valor. Há seleção de período e ordenação.

**Contas a Receber** lista documento, cliente, emissão, vencimento, recebido, valor, meio de pagamento, status e ações. O seletor de período oferece Hoje, Ontem, Essa semana, Semana passada e Esse mês. Filtros incluem documento, cliente, CPF/CNPJ, descrição, forma de pagamento, status, vencimento, recebimento, emissão, banco, conta marcada, plano de contas e valor. A tela de lançamento novo contém documento, descrição, banco, cliente, plano de contas, meio de pagamento, datas de emissão e vencimento, valor, juros, multa, desconto, valor a receber, observação, recebido e repetir.

**Contas a Pagar** usa documento, fornecedor, emissão, vencimento, pagamento, valor, meio de pagamento, status e ações. A lista tem seleção de período, ordenação e paginação.

**Centro de Custos** tem busca por nome, opção para mostrar inativos, tabela de nome/status/ações e criação de centro de custo.

**Crédito de Clientes** lista cliente, saldo, data de atualização e ações; há operação de ajuste de crédito.

**Links de pagamento** tem busca por link, descrição e destinatário. A tabela lista código, descrição, destinatário, preço, expiração, pagamento, parcelas, status e ações.

**Bancos** lista banco, saldo e ações. **Conciliação Bancária** gerencia conciliações importadas por OFX, com filtros por banco, status e período; os estados são Todos, Pendente, Parcial e Concluído. **Conta Digital** mostra cartões de resumo, seletor de período e extrato por data, tipo, descrição, valor e saldo.

**Plano de Contas, DRE e Metas.** A DRE aceita períodos predefinidos ou personalizado, periodicidade mensal/trimestral/semestral/anual e regime de competência ou caixa. A página oferece Consultar e Gerar relatório. Metas têm rota própria.

**Relatórios financeiros** incluem contas a receber, contas a pagar, cobranças, movimento e fechamento de caixa, disponibilidade financeira e comissão por vendedor. Filtros incluem datas, status, cliente/fornecedor, forma de pagamento e vendedor.

## Cadastros e estoque

**Produtos.** A lista mostra código, referência, descrição, fornecedor, unidade, custo, preço, quantidade, status e ações. O filtro simples usa código, descrição com comparação Contendo/Começando com/Terminando com, grupo e status Ativo/Inativo. Os filtros avançados são agrupados em:

- Identificação: fornecedor, código de barras, referência, observação, descrição complementar e marca.
- Estoque e valores: número da última compra, custo, preço e quantidade negativa/positiva/zerada.
- Fiscal: tributação, perfil tributário, CFOP, CST/CSOSN e tipo de produto.

As ações de linha permitem editar, duplicar, ajustar estoque e inativar. A tabela também possui impressão, paginação e opções de visualização/colunas.

O cadastro de produto tem descrição, marca, custo, markup, quantidade, preço, preço e quantidade de atacado, referência, unidade, grupo, código de barras, última venda/compra, validade, fornecedor preferencial, peso, estoque mínimo, tipo, origem, descrição complementar e observação. O formulário permite ativar recursos específicos: composto, variação, decompor, pesado, lote, restaurante, retornável, múltiplas embalagens e veículo. Há assistente para cálculo do preço de venda.

A seção fiscal reúne perfil tributário, CST/CSOSN para contribuinte e não contribuinte, CFOP de NF-e e NFC-e, CEST, NCM, exceção fiscal, CENQ, CST de IPI/PIS/COFINS, tributação, ST, FCP e código de benefício. A seção GLP mostra ANP e campos tributários de quantidade/valor. A seção Reforma Tributária apresenta classificações IBS/CBS/IS e CSTs, crédito presumido, indicador de bem móvel usado e campos de alíquotas/valores.

O cadastro aceita foto de produto. A tela recomenda 1200 × 1200 px, JPG/PNG/WebP até 5 MB, recorte 1:1 e área real mínima de 800 × 800 px.

**Outros cadastros.** Foram encontradas listas de unidades (descrição/sigla), grupos (descrição), vendedores (nome/status), contador (nome/CNPJ/status), kits (código/nome/valor), variações (nome), parcelamentos (descrição/quantidade/status), terminais de consulta e listas de preço (descrição/status/ações). Usuários têm busca por usuário e tabela de nome, usuário e status.

**Pessoas.** A lista expõe código, nome, fantasia, telefones, endereço, CPF/CNPJ, data de cadastro e status. No fim da inspeção, porém, essa rota deixou a área principal em branco. A falha está registrada abaixo.

**Relatórios de cadastros.** Incluem estoque, movimentação do item, lista de preços, inventário, etiquetas, totalização de estoque, fornecedor preferencial, previsão de compra, controle e rastreabilidade de lotes, vendas por produto, histórico e totalização de clientes, clientes inativos, aniversariantes e atividade. Há filtros de datas, produtos, fornecedores, clientes, cidade/UF, lotes, formatos e etiquetas.

## Apps, integrações e configurações

**Marketplace.** Tem filtros Todos, Módulos, Plugins e áreas como CRM, Food e Serviços, além de estados Instalados, Disponíveis e Em breve. Os módulos listados incluem transporte, óticas, PDV offline, usuários adicionais, delivery, catálogo digital, agenda, condicional, WhatsApp e IA. O site exibe contratação mensal por app e por terminal/usuário adicional; não contratei nenhum item.

**Integrações.** A tela mostra VendiZap e Asaas como plataformas configuráveis. Não abri os formulários de credenciais.

**Smart POS e Terminais de Venda.** Smart POS lista descrição, modelo, status e ações. A página de terminais de venda mostrava nenhum terminal cadastrado e opção para criar um.

**Emitente e ambiente fiscal.** Emitente tem abas Cadastro, Logomarca e Fiscal e botão Salvar. Ambiente lista ambiente, modelo, série, número do documento fiscal, padrão do PDV web, ativo e ações. Naturezas lista CFOP e descrição; Tributações e Perfil Tributário têm busca por descrição e ações.

**Configurações Gerais.** Há busca por configuração, módulo ou recurso e categorias NFe/NFCe, Compras, Pedidos, Orçamentos, OS, Estoque, Gerais, Impressões e Balanças.

- NFe/NFCe: cálculo de base de PIS/COFINS e ICMS/ST, contas a receber no cartão, abertura de caixa, importação de observações, desconto incondicional, ordenação no PDV, integração POS, natureza padrão, conversão CFOP, vendedor obrigatório, estoque de pré-venda, CBS/IBS e balança.
- Compras: NSU do monitor NF-e, parcelas no financeiro, quantidade tributável de XML, importação de informações do item e data de entrada nas contas a pagar.
- Pedidos: impressão de dados do cliente para produção, inclusão no dashboard, observações do produto e mensagem adicional.
- Orçamentos: observações do produto, mensagem adicional, serviços, foto, identificador, observações fixas nos PDFs e custo operacional.
- OS: observações nos PDFs, controle de horas, número interno e inclusão no dashboard.
- Estoque: verificação de estoque nas vendas e comportamento de estoque em condicionais.
- Gerais: validar pessoa duplicada, juros simples, cor das contas marcadas, casas decimais de preço/quantidade, senha de administrador, código de barras duplicado, preferência entre referência/descrição na busca, sincronização com VendiZap, relatórios HTML e bloqueio por inadimplência.
- Impressões: configuração do QZ Tray e impressoras, PDV/pré-venda, NFC-e, DANFE, recibos, pedidos, orçamentos e OS; opções de vias, formato, margem, paisagem, referência, NCM e dados do emitente.
- Balanças: lista própria de registros e ações.

**Arquivos Contábeis** tem abas Configurações e Histórico, criação/atualização de rotina, destinatários, periodicidade e período, próxima/última execução, status e download de pacote ZIP.

**Assinatura** apresenta plano, apps contratados e resumo da renovação.

## Atendimento integrado

Há um chat da Nuts Tecnologia com assistente, envio de mensagem e opção de anexar imagem após iniciar a conversa. O widget oferece abertura de chamado com nome, e-mail, telefone e descrição; permite cancelar; e exibe avaliação de atendimento com comentário, finalização ou continuação da conversa. Não enviei mensagem nem abri chamado.

## Código entregue ao navegador

Os elementos observáveis são uma aplicação web de página única que depende de JavaScript. O navegador carregou arquivos com nomes versionados para a aplicação, fornecedores e um chunk adicional: app.6ed07b5c.js, chunk-vendors.0ab2d916.js e chunk-8772fbcc.e37337ef.js. Também foram carregados CSS versionados, Google Analytics, Google Tag Manager e o widget de atendimento em ai.codeforce.com.br.

Os nomes dos bundles e a pilha com funções de renderização sugerem Vue com empacotamento Webpack; isso é uma inferência baseada nos arquivos e no erro observado. Não encontrei o repositório-fonte, os mapas de origem nem o código do servidor/API. Tentar abrir o bundle JavaScript diretamente no navegador foi bloqueado por ERR_BLOCKED_BY_CLIENT, e a ferramenta de consulta pública não conseguiu buscar esse recurso. Portanto, esta análise descreve o front-end efetivamente entregue e o que a interface permite observar; não contém o código original completo, regras internas do backend ou esquema do banco.

## Problema observado

Ao abrir a rota Pessoas, a área de conteúdo ficou vazia. O console registrou:

> TypeError: Cannot read properties of undefined (reading 'some')

A pilha aponta para a função canApplyListaPreco dentro do bundle da aplicação, durante a renderização. O erro pode depender de dados ou configuração dessa conta; a inspeção não prova qual campo está ausente. É um defeito prioritário para reproduzir e corrigir no sistema JVG, especialmente porque Pessoas é cadastro central para vendas e financeiro.

## Especificação prática para o JVG

Para transformar esta referência em um sistema próprio, a estrutura funcional mínima é:

1. Cadastros centrais de pessoas, usuários, produtos, unidades, grupos, vendedores, kits, variações, parcelamentos, lista de preços e terminais.
2. Fluxos de venda com pré-venda, NFC-e, orçamento, pedido, faturamento e baixa de estoque.
3. Fluxo de compras com importação XML, entrada de mercadoria, fornecedor, estoque e geração de contas a pagar.
4. NF-e em etapas com destinatário, itens, tributos, total, cobrança e transporte, incluindo rascunho, autorização, cancelamento, PDF, XML e compartilhamento.
5. Financeiro com caixa, contas a receber/pagar, meios de pagamento, bancos, crédito de clientes, conciliação OFX, plano de contas, DRE e relatórios.
6. Estoque com mínimos, reservas, lotes, validade, kits, variações, custo/preço e inventário.
7. Logística com veículos, motoristas e MDF-e.
8. Configuração fiscal do emitente, séries/ambientes, CFOP, tributação, perfil tributário e impressão.
9. Relatórios por módulo, com filtros reaproveitáveis, exportação e permissões.
10. Marketplace e integrações tratados como módulos opcionais, com credenciais protegidas e histórico de sincronização.

O padrão de interface recorrente é cabeçalho com módulos, tabelas paginadas e ordenáveis, filtros expansíveis, impressão, ações por linha e formulários separados em etapas ou abas. Para o JVG, a prioridade técnica é primeiro garantir o modelo de dados e permissões; depois implementar os fluxos com validação fiscal e financeiro; por fim acrescentar widgets, marketplace, impressão e integrações.

## Apêndice — auditoria do código-fonte atual do JVG

**Fonte examinada:** repositório [Pelissar/JVG-NOTA-FISCAL](https://github.com/Pelissar/JVG-NOTA-FISCAL), branch `main`, incluindo a árvore completa do repositório, os arquivos próprios do ERP e as migrações SQL versionadas. Componentes genéricos de interface e arquivos de dependências não foram tratados como funções de negócio. Esta parte descreve o código publicado no GitHub; não confirma sozinha quais variáveis estão configuradas no Netlify nem o estado atual do banco Supabase.

### Como o código está organizado

- A página pública, o login, o callback de confirmação de e-mail, a sessão e a API são um aplicativo Next.js. O painel operacional é servido como HTML/CSS/JavaScript em `web/public/erp/`, com navegação e formulários próprios.
- O navegador autentica pelo Supabase Auth. O `proxy.ts` protege as rotas `/erp/*`; cada API também valida a sessão no servidor. O servidor usa a chave privada para consultar o Supabase REST e escopa operações por `tenant_id` e `company_id`.
- As migrações criam empresas, membros, clientes/pessoas, produtos, serviços, perfis fiscais, vendas, itens de venda, movimentações de estoque, documentos/eventos fiscais, integrações e auditoria. A existência de uma tabela não significa que o módulo tenha tela, API ou fluxo utilizável.
- O banco usa RLS. O desenho guarda a chave privada somente no servidor e desativa escrita direta do navegador para operações transacionais como documentos fiscais, estoque, perfis e vendas.

### O que funciona no código atual

| Área | Implementação encontrada | Limite atual |
|---|---|---|
| Site público e acesso | Página de apresentação; login; criação de conta; confirmação de e-mail; saída; verificação de sessão; redirecionamento para o ERP | Não há recuperação de senha visível no login nem gestão de conta/empresa por usuário |
| Empresa emitente | Cadastro inicial do nome; edição de razão/nome fantasia, CNPJ, IE/IM, CNAE, contato, endereço, CEP, município IBGE e série/numeração planejada da NF-e | Regime é fixo em Simples Nacional no piloto; dados não habilitam emissão |
| Produtos | Criar, editar, inativar; SKU, nome, categoria, unidade, NCM, CEST, GTIN, origem, CFOP sugerido, perfil fiscal, custo, venda e saldo inicial | Não há imagens, marcas, fornecedores preferenciais, lotes, validade, kits, variações, preço atacado ou estoque mínimo |
| Clientes | Criar, editar, inativar; PF/PJ/estrangeiro, CPF/CNPJ, contato e endereço; consultas de CEP e CNPJ | Cadastro único de cliente; não há fornecedor, transportadora, vendedor, contatos múltiplos ou regras de crédito |
| Serviços | Criar, editar, inativar; descrição, código, preço, LC 116 e NBS | Sem fluxo de NFS-e, retenções, município, tomador ou cálculo fiscal |
| Estoque | Saldo inicial; entrada/saída de ajuste com motivo; impede saldo negativo; movimento gravado pelo servidor com bloqueio do produto no banco | Um depósito principal na interface; não há compra, transferência, inventário, reserva, lote ou rastreabilidade |
| Vendas | Registro de venda com cliente opcional, produtos/serviços, quantidade, preço e observação; confirmação atômica; baixa automática de estoque; histórico resumido | Sem orçamento, pedido, pré-venda, PDV, pagamento, desconto, contas a receber, cancelamento, edição ou emissão de NFC-e |
| CFOP | Catálogo versionado com 619 códigos no JSON; busca, filtro pelo primeiro dígito, paginação de 30; apelido interno por empresa e restauração do título | Não escolhe CFOP automaticamente; o CFOP continua dependendo da operação e precisa de validação fiscal |
| Perfis tributários | Cadastro de perfil para NF-e com CFOP, CSOSN, CST PIS/COFINS, CST IBS/CBS, classificação e percentuais manuais para estimativa | Perfis ficam em rascunho; não há edição, exclusão, revisão do contador ou motor tributário; estimativas não são impostos |
| NF-e | Criação e leitura de rascunho de homologação, destinatário, até 20 produtos, quantidade/preço, CFOP/CSOSN, total, pendências e checklist estrutural | Não há rota de edição/exclusão, geração de XML/DANFE, assinatura, transmissão, autorização, cancelamento, inutilização ou envio de e-mail/WhatsApp |
| Consulta cadastral | ViaCEP com fallback BrasilAPI; CNPJ pela BrasilAPI com fallback CNPJ.ws para CNPJ numérico; dados retornados preenchem o formulário para conferência | Dependência dos serviços públicos externos; consulta não salva automaticamente nem substitui validação cadastral/fiscal |
| Relatórios | Cartões básicos de quantidade e valor estimado do estoque; exportação CSV de produtos, clientes e serviços | Sem filtros gerenciais completos, vendas por período, caixa, financeiro, fiscal, contábil, impressão ou relatórios por NCM |
| Financeiro | Estrutura de vendas no banco, sem módulo financeiro operacional | Não existem telas/API de caixa, contas a pagar/receber, bancos, conciliação, crédito, plano de contas, DRE ou metas |
| Compras, produção e logística | Há conceitos parciais no esquema fiscal e no modelo de dados | Sem telas/API para compras e XML, pedidos de compra, produção, OS, veículos, motoristas, CT-e ou MDF-e |
| Usuários e assinatura | Há papéis por empresa e papel de administrador da plataforma no banco; existe uma tela mínima de administrador | Não há convite, criação/remoção de usuários, troca de empresa, assinatura, marketplace, cobrança ou administração global utilizável |
| Integrações | Um endpoint restrito testa se um token Focus de homologação autentica uma consulta inocua | Diagnóstico não emite documento; emissão permanece explicitamente desabilitada. Não há Asaas, VendiZap ou marketplace implementados |

### Opções que aparecem no painel, mas não são ações implementadas

Os itens **Financeiro** e **Transporte** chamam uma tela genérica que informa que os módulos estão planejados. **Notas fiscais** exibe os cinco modelos previstos, mas somente NF-e tem rascunho; NFC-e, NFS-e, CT-e e MDF-e não têm fluxo operacional. **Relatórios** é um resumo dos cadastros, não o conjunto de relatórios da referência. O cabeçalho do ERP mostra um espaço de pesquisa, mas a busca global encaminha para Produtos e só filtra campos dessa tabela. O seletor “Minha empresa” é visual: o código escolhe o primeiro vínculo ativo e não implementa troca de empresa.

### Lacunas e riscos técnicos observáveis

1. **Chave privada do Supabase no histórico:** o README da raiz afirma que uma chave privada foi publicada em um commit anterior e que apagar o arquivo atual não remove o segredo do histórico. Se essa chave ainda não foi revogada, ela deve ser revogada no Supabase e substituída nas variáveis privadas do servidor. Não copiei nem reproduzi o segredo.
2. **Venda sem idempotência no servidor:** a confirmação é transacional e trava os produtos, mas cada chamada bem-sucedida cria uma venda nova. A tela bloqueia reenvio após erro de rede e instrui a atualizar a página, porém a RPC não recebe uma chave idempotente; repetir manualmente após atualização pode duplicar a venda.
3. **Saldo calculado por soma de movimentos:** a API de cadastros lê no máximo 10.000 movimentos por empresa e soma os lançamentos retornados. Quando uma empresa ultrapassar esse limite, a tela pode mostrar saldo incompleto; também não separa depósitos.
4. **Limites de listagem:** a API carrega até 1.000 produtos/clientes/serviços, 200 vendas e 50 rascunhos. Como a busca principal roda no navegador, registros além dos limites não aparecem nessa tela sem paginação no servidor.
5. **Perfil fiscal sem ciclo de aprovação:** o cadastro salva `review_status: draft`; o aplicativo não oferece ação para registrar a revisão. Portanto, a preparação fiscal permanece pendente mesmo que o usuário preencha os campos.
6. **Integração fiscal de teste apenas:** a consulta Focus usa ambiente de homologação e referência aleatória inexistente para verificar autenticação. O código não envia NF-e. `emissionEnabled` e `transmissionEnabled` são devolvidos como `false` nos fluxos observados.
7. **Migrações são parte do funcionamento:** cadastro alfanumérico de CNPJ, campos fiscais, CFOP personalizado, CFOP sugerido e RPC de venda dependem das migrações posteriores. Não confirmei que essas migrações estejam aplicadas no Supabase conectado.

### Arquivos de código principais

| Arquivo | Papel |
|---|---|
| [Painel e navegação](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/public/erp/index.html) / [lógica do painel](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/public/erp/app.js) | Menus, dashboard, cadastros, estoque, filtros, exportação e configurações |
| [Vendas](https://github.com/Pelissar/JVG-NOTA-FISCAL/tree/main/web/public/erp) | `sales.html` e `sales.js`: formulário de venda e histórico resumido |
| [Rascunhos NF-e](https://github.com/Pelissar/JVG-NOTA-FISCAL/tree/main/web/public/erp) | `nfe-drafts.html` e `nfe-drafts.js`: preparação e consulta de pendências |
| [API de registros](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/app/api/records/route.ts) | Produtos, clientes, serviços, movimentos e isolamento por empresa |
| [API de estoque](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/app/api/stock/route.ts) / [RPC de estoque](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/supabase/migrations/20261106_jvg_etapa3_stock_rpc.sql) | Ajustes com validação e concorrência serializada |
| [API de vendas](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/app/api/sales/route.ts) / [RPC de confirmação](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/supabase/migrations/20261109_jvg_confirm_sale.sql) | Validação da venda e confirmação transacional com baixa de estoque |
| [API de rascunhos fiscais](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/app/api/fiscal/nfe-drafts/route.ts) | Criação/consulta de NF-e de preparação; não transmite |
| [API de CFOP](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/app/api/fiscal/cfop/route.ts) / [catálogo](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/lib/fiscal/cfop.ts) | Leitura do catálogo e apelidos por empresa |
| [Perfis tributários](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/app/api/fiscal/tax-profiles/route.ts) / [prévia matemática](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/lib/fiscal/tax-preview.ts) | Regras em rascunho e estimativa explicitamente não fiscal |
| [Login](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/app/login/page.tsx), [proteção de rotas](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/proxy.ts), [backend Supabase](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/web/lib/jvg-backend.ts) | Sessão, proteção, escopo de empresa e acesso servidor-banco |
| [Esquema e permissões principais](https://github.com/Pelissar/JVG-NOTA-FISCAL/blob/main/supabase/migrations/20261106_jvg_etapa2_base.sql) | Tabelas, chaves estrangeiras, RLS e políticas por membro |

### Prioridade para aproximar o JVG do Nuts

1. Resolver a segurança do segredo histórico, confirmar as migrações aplicadas e revisar permissões por papel; implementar administração de usuários e seletor de empresa.
2. Completar os cadastros centrais: pessoas com papéis de cliente/fornecedor/transportador, unidades, grupos, vendedores, listas de preço e regras de duplicidade.
3. Construir orçamento → pedido → venda/PDV → pagamento/caixa → estoque, com idempotência, cancelamento e trilha de auditoria.
4. Construir compras e entrada de XML integradas a estoque e contas a pagar; acrescentar inventário, depósitos, transferências, lotes e validade.
5. Completar o financeiro e relatórios gerenciais antes de liberar telas de produção/logística.
6. Só então avançar com emissão fiscal real por documento e ambiente, após homologação técnica e conferência contábil: NF-e/NFC-e, NFS-e, CT-e e MDF-e, com XML, eventos, documentos auxiliares e consulta de status.
7. Acrescentar configurações, impressão, integrações, arquivos contábeis e marketplace com permissões e segredos isolados por empresa.

**Conclusão da comparação:** a base atual do JVG já tem autenticação, isolamento por empresa, cadastros básicos, estoque simples, registro básico de vendas, CFOP, perfis em rascunho e preparação de NF-e. Ela ainda é um piloto de cadastros e preparação fiscal. A maioria dos módulos operacionais da Nuts está ausente ou aparece apenas como estrutura de banco/planejamento; a construção equivalente exige implementar os fluxos e telas indicados acima. O código original do Nuts não foi obtido: a auditoria do Nuts continua baseada na interface e nos arquivos públicos carregados pelo navegador.


> Nota de integração: a seção de código do JVG considera a branch `main` na data da auditoria; comparar com a branch ativa antes de iniciar cada implementação.
