# Mapeamento do payload NF-e Focus

Este documento registra o mapeamento estrutural existente no ERP. Não constitui configuração fiscal da JVG e não autoriza transmissão.

## Fonte e regras de segurança

- [Focus: Os tributos](https://doc.focusnfe.com.br/docs/os-tributos): a tributação é declarada por item e a API totaliza os valores informados nos itens.
- [Focus: ICMS e CSOSN](https://doc.focusnfe.com.br/docs/icms-imposto-sobre-circulacao-de-mercadorias-e-servicos): os campos obrigatórios variam por CST/CSOSN; grupo opcional deve ser completo.
- [Focus: IBS/CBS](https://doc.focusnfe.com.br/docs/ibs-e-cbs): os grupos variam pelo par CST e cClassTrib; alguns campos são calculados pela API.
- [Focus: campos da NF-e em homologação](https://campos.focusnfe.com.br/nfe_homologacao/NotaFiscalXML.html): campos e tipos aceitos neste ambiente.
- [Focus: emissão](https://doc.focusnfe.com.br/reference/emitir_nfe): `POST /v2/nfe?ref`; fluxo padrão assíncrono e consulta/webhook para o resultado.

O ERP não escolhe CFOP, CSOSN/CST, alíquotas, bases, créditos ou valores. Não são criados valores fiscais nem dados de cliente para fixtures. Totais de cabeçalho não são duplicados no preview; faltam valores fiscais por item.

## Dados atualmente mapeados

| Origem do ERP | Campo Focus | Regra |
| --- | --- | --- |
| Natureza do rascunho | `natureza_operacao` | Obrigatório; finalidade da nota não é presumida. |
| Tipo de documento | `tipo_documento` | `1`, pois o rascunho atual prepara NF-e de saída. |
| Finalidade selecionada | `finalidade_emissao` | Sem padrão. A prévia aceita somente `1` (normal); complementar, ajuste e devolução exigem referências ainda não capturadas. |
| Data/hora informada no rascunho | `data_emissao` | Obrigatória, ISO 8601 com fuso; validada no servidor. Não recebe data atual automaticamente. |
| UFs do emitente/destinatário | `local_destino` | Interna/interestadual derivada das UFs; exterior não está habilitado. |
| Indicação manual da operação | `consumidor_final` | Sem inferência pelo CPF/CNPJ; converte para `0` ou `1` apenas quando escolhido. |
| Presença informada no rascunho | `presenca_comprador` | Sem valor implícito; aceita os códigos Focus `0`, `1`, `2`, `3`, `4`, `5`, `9`. |
| Modalidade de frete informada | `modalidade_frete` | Sem padrão; aceita `0`, `1`, `2`, `3`, `4`, `9`. Transportadora, veículo e volumes seguem pendentes. |
| Empresa da sessão | campos do emitente | CNPJ, nome, IE, regime confirmado e endereço fiscal da empresa autenticada. |
| Cadastro do cliente | campos do destinatário | CPF/CNPJ, nome, endereço, contato e IE quando cadastrados. |
| Produto + item do rascunho | `codigo_produto`, `descricao`, `codigo_ncm`, `cfop`, unidade, quantidade, preço, `valor_bruto` | Valores comerciais em centavos convertidos para número no preview. |
| Produto | `icms_origem` | Origem cadastrada no produto; não é inferida. |
| Regra do perfil para a operação | `icms_situacao_tributaria` | CSOSN do perfil selecionado para interna/interestadual. |
| Regra do perfil | `pis_situacao_tributaria`, `cofins_situacao_tributaria` | CST de PIS e Cofins orientados pela contabilidade. |
| Regra do perfil | `ibs_cbs_situacao_tributaria`, `ibs_cbs_classificacao_tributaria` | CST e cClassTrib registrados no perfil. |
| Pagamentos quando informados | `formas_pagamento` | Converte indicador, forma e valor para o contrato Focus; a coleção pode ficar vazia. Cartão e forma 99 exigem campos adicionais. |

O perfil fiscal atual pode conter regras de venda interna e interestadual separadas. O rascunho escolhe o ramo pela UF. Perfil legado sem esse recorte fica pendente; não se aplica automaticamente a outra operação. A associação continua sendo `jvg_products.tax_profile_id`; não foi criada tabela ou migration nova.

## Campos condicionais exibidos como pendência

- CSOSN 101: Focus lista `icms_aliquota_credito_simples` e `icms_valor_credito_simples`.
- CSOSN 201: grupo de ICMS-ST e os campos de crédito do Simples.
- CSOSN 202/203: grupo de ICMS-ST.
- CSOSN 102/103/300/400: origem e CSOSN, sem os grupos numéricos listados para esses códigos no guia Focus.
- CSOSN 900: os grupos de ICMS são opcionais; se um grupo for informado, todos os campos daquele grupo precisam estar completos.
- PIS/Cofins CST 01/02: base, alíquota percentual e valor por item; CST 03: quantidade, alíquota por unidade e valor; CST 05: grupo de substituição tributária. Outros CSTs permanecem sujeitos à matriz Focus correspondente.
- IBS/CBS: o CST 000 exige grupo `gIBSCBS` com base, alíquotas e valores de UF/município/CBS indicados no guia. Outros pares CST/cClassTrib precisam da matriz específica; o sistema não os generaliza.

O preview aceita somente nomes de campos fiscais da lista interna autorizada; rejeita chaves arbitrárias e não envia `ibs_valor_total`, marcado pela Focus como calculado pela API.
## Estado de liberação

- Os perfis ficam no status `draft` até um usuário autorizado registrar que recebeu revisão da contabilidade. A tela esclarece que essa declaração não autentica o contador.
- Mesmo com perfil revisado, qualquer grupo obrigatório ausente, finalidade/condição comercial não definida ou dados cadastrais pendentes mantêm a prévia bloqueada.
- A Focus exige `data_emissao`, `tipo_documento`, `local_destino`, `finalidade_emissao`, `consumidor_final`, `presenca_comprador` e `modalidade_frete`. Os campos editáveis ficam sem padrão no rascunho. Por enquanto só a finalidade normal está coberta; série e número não são preenchidos pelo ERP nem alterados em produção.
- `canSend` e `transmissionEnabled` seguem `false`; nenhuma chamada de emissão Focus foi executada.
- Não há XML de NF-e da JVG no repositório. Um XML emitido anteriormente, anonimizado, permitiria conferir o mapeamento sem transformá-lo em regra universal.
