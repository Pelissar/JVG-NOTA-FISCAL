# Referência fiscal da JVG piloto

Registro de orientação fornecida pela usuária com base no XML da JVG citado por ela. É uma referência da empresa piloto e da operação representada pelo documento; não é uma regra padrão do SaaS.

- Regime informado: Simples Nacional, CRT 1.
- O XML citado contém dois itens com CSOSN 102.
- Para aquela operação, CSOSN 102 significa tributação do Simples Nacional sem permissão de crédito de ICMS ao destinatário. O código não permite informar na NF-e a alíquota do ICMS do Simples nem o valor desse crédito. [SEFAZ-SP, Resposta à Consulta 30.793/2024](https://legislacao.fazenda.sp.gov.br/Paginas/RC30793_2024.aspx).
- Essa conclusão sobre crédito ao destinatário não determina os créditos de ICMS que a JVG pode ou não aproveitar nas compras.
- Vincular CSOSN 102 somente à regra da operação representada pelo XML, depois que a operação for identificada. Não preencher a outra operação e não usar 102 como padrão global de produtos ou vendas.
- A informação disponível não identifica com segurança a chave interna da operação nem aprova CFOP, CST de PIS/Cofins, IBS/CBS, bases ou valores. Esses campos continuam dependendo da orientação contábil específica.

Pergunta pendente para a Walquíria: “Em quais situações das vendas da JVG o CSOSN deixa de ser 102 e o que muda nos impostos?”

## Orientação recebida sobre o lançamento de compras

Na conversa de 10/11/2026, a contabilidade confirmou que o lançamento da mercadoria comprada influencia o tratamento fiscal do item. Para uma compra de fora do estado, orientou verificar se a mercadoria, dentro da UF da JVG, está sujeita à substituição tributária ou à tributação comum.

A mensagem usa a expressão “CST 102”. Como a JVG informou CRT 1, o sistema chama esse código de CSOSN 102 na NF-e de saída. A fala não define todos os produtos ou operações: manter 102 somente no cenário de venda já documentado e não inferir a regra da venda a partir do CST/CSOSN do fornecedor. O cadastro de entrada continua sem calcular tributos ou alterar perfis fiscais automaticamente.

