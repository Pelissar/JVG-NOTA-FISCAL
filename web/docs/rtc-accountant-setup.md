# Calculadora RTC e acesso contábil

## Estado desta entrega

- A consulta RTC é desligada por padrão (`JVG_RTC_ENABLED` ausente ou diferente de `true`).
- A seleção usa o regime tributário confirmado da empresa: Simples Nacional ou regime regular. MEI e regimes sem implementação compatível são recusados; não há fallback para outra calculadora.
- As respostas ficam vinculadas ao rascunho de homologação, com versão da aplicação, versão da base oficial e versão do contrato. O resultado RTC não altera tributos existentes nem é copiado para a Focus NFe.
- O contador usa a associação `accounting` limitada à empresa. A autorização continua sendo validada pelo servidor; a função mapeia esse papel para as permissões de leitura do ERP fora das telas fiscais.
- A migration `supabase/migrations/20261118_jvg_accountant_rtc.sql` e seu rollback estão versionados, mas não foram aplicados. Configurações, convites auditados e resultados RTC dependem da aplicação dessa migration pelo fluxo autorizado do projeto.

## Serviços oficiais necessários

As calculadoras da Receita são serviços Java separados e precisam de Java 21+, banco SQLite e o banco oficial de dados/tabelas gerado pelo projeto correspondente. Hospede cada aplicação em runtime persistente com volume durável para o SQLite; não use o filesystem efêmero de uma função Netlify como armazenamento. O Next.js/Netlify chama esses serviços no servidor. Não exponha seus endereços internos nem credenciais ao navegador.

Use um serviço privado ou um proxy HTTPS que valide `Authorization: Bearer` antes de encaminhar à aplicação Java. O token enviado pelo SigmaFiscal não protege um upstream que simplesmente ignore esse header. Restrinja também a rede para que apenas o backend do SigmaFiscal possa acessar os serviços.

Repositórios oficiais e contratos de implantação:

- [Receita Federal — Calculadora RTC do Simples Nacional](https://github.com/ReceitaFederal/calculadora-rtc-simples-nacional)
- [Receita Federal — Calculadora RTC do regime regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular)

## Variáveis de ambiente somente no servidor

```text
JVG_RTC_ENABLED=false
JVG_RTC_SIMPLE_CALCULATOR_API_BASE=
JVG_RTC_REGULAR_CALCULATOR_API_BASE=
JVG_RTC_CALCULATOR_BEARER_TOKEN=
JVG_RTC_SIMPLE_OPERATION_VERSION=
JVG_RTC_REGULAR_OPERATION_VERSION=
```

Configure cada base somente depois de implantar e testar a aplicação correspondente. A base aceita a raiz HTTPS, `/api` ou `/api/calculadora`; produção exige HTTPS. O token deve ser verificado pelo proxy privado. As variáveis `*_OPERATION_VERSION` indicam a versão do contrato da operação `versao` aceita pela calculadora instalada, não a versão do SigmaFiscal nem da aplicação Receita. Obtenha essa versão na documentação OpenAPI da versão efetivamente implantada.

Não habilite RTC em produção como atalho para emissão. Primeiro valide os contratos no ambiente de testes da calculadora, compare as versões e resultados com a contabilidade e mantenha `JVG_RTC_ENABLED=false` até a aprovação. Mesmo depois da aprovação, a integração de transmissão Focus continua separada e desligada.

## Dados por empresa e operação

O regime confirmado e o CRT precisam refletir os dados conferidos pela contabilidade. Para CRT 3, a tela exige confirmação explícita de `tpRegimeIBSCBS` conforme o contrato oficial. Campos por item não são preenchidos com alíquotas estimadas: o usuário informa códigos, base e demais dados recebidos da contabilidade. Se o serviço oficial deixar um item sem cálculo ou exigir dados condicionais, a resposta é mantida como pendência e não é enviada à Focus.

O serviço Simples valida cAtivSN e a vigência para o tipo de documento; um código desconhecido ou incompatível pode resultar em `NAO_CALCULADO`. No regime regular, a API oficial recebe data/hora com fuso, município IBGE e UF do emitente. A base comercial do rascunho não é assumida como base tributária.
