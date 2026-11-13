# Referência fiscal da JVG piloto

Este registro reúne as orientações informadas pela usuária com base no XML da JVG e nas mensagens da contabilidade. É específico da empresa piloto e não constitui um padrão automático para as empresas SaaS.

- Regime informado pela empresa: Simples Nacional, CRT 1.
- Para venda de mercadoria classificada como tributada pelo Simples Nacional, a contabilidade orientou usar CSOSN 102, sem permissão de crédito de ICMS ao destinatário.
- O CSOSN 102 descreve uma operação tributada pelo Simples sem permissão para indicar alíquota e valor de crédito de ICMS na NF-e. [SEFAZ-SP, Resposta à Consulta 30.793/2024](https://legislacao.fazenda.sp.gov.br/Paginas/RC30793_2024.aspx).
- Esse código não determina, por si só, se a JVG pode aproveitar créditos relativos às mercadorias que compra.
- A contabilidade também orientou verificar se uma mercadoria comprada de fora do estado está sujeita à substituição tributária na UF da JVG ou se é tributada normalmente. Uma mercadoria classificada como ST exige regra própria; não aplicar 102 automaticamente nesse caso.
- A regra CSOSN 102 deve ser vinculada a operações e produtos identificados como tributados, não usada como padrão global do SaaS nem inferida do CFOP ou do tratamento fiscal do fornecedor.
- Para o item DEP-450, o XML de entrada fornece NCM 85255019, CEST 0106000 e CFOP 5949. O CFOP 5949 é da operação do fornecedor e não define o CFOP da venda da JVG. A classificação da mercadoria como tributada ou sujeita à ST ainda deve ser confirmada antes de vincular um perfil de saída.
- A orientação recebida não define CFOP, CST de PIS/Cofins, IBS/CBS, bases ou valores de impostos. Esses campos continuam sem inferência e a emissão permanece bloqueada enquanto obrigatórios ou pendentes de aprovação.

## Orientação recebida sobre o lançamento de compras

Na conversa de 10/11/2026, a contabilidade confirmou que o lançamento da mercadoria comprada influencia o tratamento fiscal do item. Para compras de fora do estado, orientou verificar se a mercadoria, dentro do estado da JVG, está sujeita à substituição tributária ou à tributação comum. A orientação foi: mercadoria tributada usa CSOSN 102.

A classificação da compra ajuda a identificar o tratamento do produto, mas não faz o ERP calcular automaticamente todos os impostos da venda. A saída ainda depende da operação, das UFs e dos demais códigos fiscais confirmados pela contabilidade.
