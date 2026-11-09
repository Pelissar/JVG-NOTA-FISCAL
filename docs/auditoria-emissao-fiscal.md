# Auditoria do módulo de emissão fiscal — JVG Nota Fiscal

## Diagnóstico confirmado no código atual

A tela atual `nfe-drafts.html` identifica explicitamente o ambiente como "HOMOLOGAÇÃO · SEM EMISSÃO". Ela salva rascunhos, mostra pendências e uma estimativa aritmética não fiscal. O texto da própria tela informa que não gera XML, DANFE ou nota autorizada. A API `/api/fiscal/nfe-drafts` persiste documentos com `document_type=nfe`, `environment=homologacao`, `status=draft` e devolve `readyToTransmit: false` e `transmissionEnabled: false`.

O arquivo `lib/fiscal/tax-preview.ts` declara que suas alíquotas são informadas pelo usuário e que a estimativa não é válida para emissão. Portanto, o recurso atual não é um emissor fiscal completo e não deve ser apresentado como tal.

## Escopo mínimo para NF-e modelo 55

### 1. Emitente e ambiente
- Dados cadastrais e fiscais do emitente por empresa e estabelecimento.
- Regime tributário, IE, IM quando aplicável, CNAE, endereço fiscal e município IBGE.
- Credenciais Focus NFe segregadas por homologação e produção, guardadas somente no servidor.
- Certificado/credenciamento e validação de ambiente, série e numeração.

### 2. Destinatário
- CPF/CNPJ ou identificação estrangeira, razão social/nome, IE/indicador de IE, IM quando aplicável.
- Endereço completo, município IBGE, UF, país, telefone e e-mail.
- Indicadores fiscais e validação conforme operação.

### 3. Cabeçalho da NF-e
- Natureza da operação, finalidade, tipo de operação, destino, presença do comprador.
- Modelo, série, número, data/hora de emissão e saída, fuso e ambiente.
- Local de retirada/entrega quando aplicável.
- Referências a documentos fiscais anteriores quando aplicável.

### 4. Itens e tributação
- Produto, NCM, CEST, GTIN, unidade comercial e tributável, quantidades e conversões.
- CFOP e origem; CST/CSOSN e regras tributárias conforme regime/operação.
- ICMS e desoneração/FCP quando aplicáveis; IPI; PIS; COFINS; II; IBS/CBS/IS conforme leiaute e vigência.
- Bases, alíquotas, reduções, diferimentos, benefícios, crédito presumido e arredondamentos.
- Frete, seguro, desconto, outras despesas e rateios.
- Validações de consistência entre itens e totais; não usar estimativas aritméticas como cálculo fiscal.

### 5. Totais, pagamentos e transporte
- Totais fiscais calculados a partir dos itens.
- Formas de pagamento, parcelas, troco e integração com meios de pagamento quando aplicável.
- Modalidade de frete, transportador, volumes, pesos, veículo e reboque quando aplicáveis.
- Informações adicionais ao fisco e ao contribuinte.

### 6. Transmissão e ciclo de vida
- Construção/validação do payload Focus NFe e referência idempotente única.
- Envio em homologação, consulta assíncrona e processamento de webhook autenticado.
- Persistência de protocolo, chave de acesso, XML autorizado, DANFE, recibos e eventos.
- Estados explícitos: rascunho, aguardando, autorizado, rejeitado, denegado, cancelado, contingência e falha recuperável.
- Tratamento de rejeições com código/mensagem e possibilidade segura de correção/reenvio.
- Cancelamento com justificativa e prazo aplicável; Carta de Correção (CC-e); inutilização de numeração.
- Download, impressão e envio por e-mail; auditoria imutável de eventos e usuários.

### 7. Segurança e testes
- Autorização por empresa/estabelecimento e perfis de usuário.
- Segredos nunca enviados ao navegador ou registrados em logs.
- Idempotência, proteção contra emissão duplicada e reconciliação após timeout.
- Testes de contrato, cenários homologados, rejeições, webhook duplicado e falha de rede.
- Homologação com o emitente e revisão do contador antes de habilitar produção.

## Outros modelos fiscais

NFC-e (65), NFS-e municipal/nacional, CT-e (57) e MDF-e (58) têm fluxos, leiautes, requisitos e operações próprias. Não são variações simples da NF-e 55 e devem ser implementados e homologados como produtos separados.

## Referências técnicas consultadas

- Portal oficial NF-e: Manual de Orientação ao Contribuinte (MOC) 7.0, Anexo I de leiaute e regras de validação e anexos de contingência.
- Focus NFe: documentação de operações de NF-e, NFC-e e NFS-e; consulta, eventos, cancelamento, inutilização e webhooks.

## Critério de aceite

A emissão só poderá ser considerada pronta quando um documento de homologação percorrer ponta a ponta: preenchimento, validação, transmissão, resposta SEFAZ, consulta, armazenamento do XML e DANFE, tratamento de evento e auditoria. Produção exige autorização explícita separada.
