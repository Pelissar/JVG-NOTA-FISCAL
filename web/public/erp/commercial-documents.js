(function () {
  'use strict';

  var cache = { ready: null, company: null, clients: [] };
  var money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var statusLabels = {
    draft: 'Rascunho', sent: 'Enviado', accepted: 'Aceito', rejected: 'Recusado',
    expired: 'Expirado', open: 'Em aberto', fulfilled: 'Concluído', cancelled: 'Cancelado',
    diagnosis: 'Em diagnóstico', awaiting_approval: 'Aguardando aprovação',
    awaiting_parts: 'Aguardando peça', in_progress: 'Em manutenção',
    ready: 'Pronta para entrega', delivered: 'Entregue', confirmed: 'Confirmada', invoiced: 'Faturada',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function text(value, fallback) {
    var result = String(value == null ? '' : value).trim();
    return result || (fallback || 'Não informado');
  }

  function addressLines(address) {
    address = address && typeof address === 'object' ? address : {};
    var street = [address.street, address.number].filter(Boolean).join(', ');
    if (address.complement) street += (street ? ' · ' : '') + address.complement;
    var location = [address.district, [address.city, address.state].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
    return [street, location, address.postalCode ? 'CEP ' + address.postalCode : ''].filter(Boolean);
  }

  function contactBlock(name, document, email, phone, address) {
    var lines = addressLines(address);
    return '<section class="party"><h2>' + escapeHtml(name) + '</h2>' +
      '<p><b>CPF/CNPJ:</b> ' + escapeHtml(text(document)) + '</p>' +
      '<p><b>Endereço:</b> ' + escapeHtml(lines.length ? lines.join(' · ') : 'Não informado') + '</p>' +
      '<p><b>Telefone:</b> ' + escapeHtml(text(phone)) + ' <span class="sep">·</span> <b>E-mail:</b> ' + escapeHtml(text(email)) + '</p></section>';
  }

  function lineDetails(item) {
    var values = [];
    if (item.brand) values.push('Marca: ' + item.brand);
    if (item.model) values.push('Modelo: ' + item.model);
    if (item.serialNumber) values.push('Nº de série: ' + item.serialNumber);
    if (item.serviceDescription) values.push(item.serviceDescription);
    return values.length ? '<small class="line-detail">' + escapeHtml(values.join(' · ')) + '</small>' : '';
  }

  function compactDescription(value, limit) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return escapeHtml('Não informado');
    if (raw.length <= limit) return escapeHtml(raw);
    return escapeHtml(raw.slice(0, limit).trimEnd()) + '… <span class="continued">(continua na ficha digital)</span>';
  }

  function itemRows(items) {
    return (Array.isArray(items) ? items : []).map(function (item, index) {
      var quantity = Number(item.quantity) || 0;
      var unitPrice = Number(item.unitPrice) || 0;
      var total = Number(item.lineTotal);
      if (!Number.isFinite(total)) total = quantity * unitPrice;
      var kind = item.serviceId ? 'Serviço' : 'Produto';
      return '<tr><td class="index">' + (index + 1) + '</td><td><b>' +
        escapeHtml(text(item.description, kind)) + '</b>' + lineDetails(item) +
        '</td><td class="num">' + escapeHtml(quantity.toLocaleString('pt-BR')) + ' ' +
        escapeHtml(text(item.unit, 'UN')) + '</td><td class="num">' + escapeHtml(money.format(unitPrice)) +
        '</td><td class="num"><b>' + escapeHtml(money.format(total)) + '</b></td></tr>';
    }).join('');
  }

  function load() {
    if (cache.ready) return cache.ready;
    cache.ready = fetch('/api/records', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os dados da empresa.');
          return data;
        });
      })
      .then(function (data) {
        cache.company = data.company || {};
        cache.clients = Array.isArray(data.clients) ? data.clients : [];
      });
    return cache.ready;
  }

  function clientFor(id) {
    return cache.clients.find(function (client) { return client.id === id; }) || null;
  }

  function issuerBlock(company) {
    company = company || {};
    var address = addressLines(company.address);
    var logo = '<img class="logo" src="' + escapeHtml(new URL('/api/company/logo?v=' + Date.now(), window.location.origin).href) +
      '" alt="Logo da empresa">';
    return '<header class="issuer">' + logo + '<div class="issuer-copy"><div class="issuer-name">' +
      escapeHtml(text(company.tradeName || company.legalName, 'Empresa não cadastrada')) + '</div>' +
      (company.tradeName && company.legalName && company.tradeName !== company.legalName ?
        '<div class="muted">' + escapeHtml(company.legalName) + '</div>' : '') +
      '<div class="issuer-lines"><span><b>CNPJ/CPF:</b> ' + escapeHtml(text(company.cnpj)) + '</span>' +
      '<span><b>Inscrição Estadual:</b> ' + escapeHtml(text(company.stateRegistration)) + '</span>' +
      '<span><b>Inscrição Municipal:</b> ' + escapeHtml(text(company.municipalRegistration)) + '</span>' +
      '<span><b>Endereço:</b> ' + escapeHtml(address.length ? address.join(' · ') : 'Não informado') + '</span>' +
      '<span><b>Telefone:</b> ' + escapeHtml(text(company.phone)) + ' <span class="sep">·</span> <b>E-mail:</b> ' +
      escapeHtml(text(company.email)) + '</span></div></div></header>';
  }

  function detailsFor(data) {
    var client = clientFor(data.customerId);
    return contactBlock(
      client ? client.name : 'Consumidor não identificado',
      client ? client.document : '',
      client ? client.email : '',
      client ? client.phone : '',
      client ? {
        street: client.street, number: client.number, complement: client.complement,
        district: client.district, city: client.city, state: client.state, postalCode: client.postalCode,
      } : null,
    );
  }

  function documentBody(kind, data, copyLabel) {
    var company = cache.company || {};
    var title = kind === 'quote' ? 'ORÇAMENTO' : kind === 'order' ? 'PEDIDO' : kind === 'sale' ? 'COMPROVANTE DE VENDA' : 'ORDEM DE SERVIÇO';
    var idShort = String(data.id || '').slice(0, 8).toUpperCase();
    var number = data.number || (kind === 'serviceOrder' ? 'OS-' + String(data.os_number || '').padStart(6, '0') :
      kind === 'sale' ? 'VENDA-' + idShort : idShort);
    var date = data.created_at ? new Date(data.created_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
    if (kind === 'serviceOrder') return serviceOrderCopy(data, number, date, copyLabel);
    var items = Array.isArray(data.items) ? data.items : [];
    var status = statusLabels[data.status] || text(data.status, 'Não informado');
    var extra = kind === 'quote'
      ? '<span><b>Validade:</b> ' + escapeHtml(data.valid_until ? new Date(data.valid_until + 'T12:00:00').toLocaleDateString('pt-BR') : 'Não definida') + '</span>'
      : kind === 'order' ? '<span><b>Orçamento de origem:</b> ' + escapeHtml(String(data.quote_id || '').slice(0, 8).toUpperCase() || 'Não informado') + '</span>' : '';
    return '<article class="document">' + issuerBlock(company) +
      '<div class="doc-title"><div><span class="eyebrow">DOCUMENTO COMERCIAL</span><h1>' + title + '</h1></div>' +
      '<div class="doc-number"><strong>' + escapeHtml(number) + '</strong><span>' + escapeHtml(copyLabel || '') + '</span></div></div>' +
      '<div class="meta"><span><b>Data:</b> ' + escapeHtml(date) + '</span><span><b>Situação:</b> ' + escapeHtml(status) + '</span>' + extra + '</div>' +
      detailsFor(data) +
      '<table><thead><tr><th>#</th><th>Produto ou serviço</th><th class="num">Qtd.</th><th class="num">Unitário</th><th class="num">Total</th></tr></thead>' +
      '<tbody>' + itemRows(items) + '</tbody></table>' +
      '<div class="total"><span>Total do documento</span><strong>' + escapeHtml(money.format(Number(data.total) || 0)) + '</strong></div>' +
      (data.notes ? '<section class="notes"><b>Observações</b><p>' + escapeHtml(data.notes) + '</p></section>' : '') +
      '<section class="signatures"><div>Responsável pela empresa</div><div>Cliente / responsável</div></section>' +
      '<footer>' + (kind === 'sale' ? 'Comprovante comercial sem validade fiscal. Consulte o módulo fiscal para documentos fiscais.' : 'Documento comercial sem validade fiscal. A emissão de documento fiscal ocorre em módulo próprio.') + '</footer></article>';
  }

  function serviceOrderCopy(data, number, date, copyLabel) {
    var equipment = [data.device_type, data.brand, data.model].filter(Boolean).join(' · ');
    var approval = data.customer_approved === true ? 'Aprovado' :
      data.customer_approved === false ? 'Não aprovado' : 'Pendente';
    var company = cache.company || {};
    return '<article class="document os-document">' + issuerBlock(company) +
      '<div class="doc-title"><div><span class="eyebrow">ASSISTÊNCIA TÉCNICA</span><h1>ORDEM DE SERVIÇO</h1></div>' +
      '<div class="doc-number"><strong>' + escapeHtml(number) + '</strong><span>' + escapeHtml(copyLabel || '') + '</span></div></div>' +
      '<div class="meta"><span><b>Entrada:</b> ' + escapeHtml(date) + '</span>' +
      '<span><b>Situação:</b> ' + escapeHtml(statusLabels[data.status] || text(data.status)) + '</span>' +
      '<span><b>Previsão:</b> ' + escapeHtml(data.promised_at ? new Date(data.promised_at + 'T12:00:00').toLocaleDateString('pt-BR') : 'Não definida') + '</span></div>' +
      detailsFor(data) +
      '<div class="os-grid"><section><b>Equipamento</b><p>' + escapeHtml(text(equipment)) + '</p></section>' +
      '<section><b>Número de série / IMEI</b><p>' + escapeHtml(text(data.serial_number)) + '</p></section>' +
      '<section><b>Técnico</b><p>' + escapeHtml(text(data.technician_name)) + '</p></section>' +
      '<section><b>Orçamento estimado</b><p>' + escapeHtml(data.estimated_value == null ? 'A definir' : money.format(Number(data.estimated_value))) + '</p></section>' +
      '<section class="wide"><b>Defeito relatado</b><p>' + compactDescription(data.reported_issue, 300) + '</p></section>' +
      '<section class="wide"><b>Diagnóstico / serviço realizado</b><p>' + compactDescription(data.diagnosis, 380) + '</p></section>' +
      '<section><b>Aprovação do cliente</b><p>' + approval + '</p></section></div>' +
      '<section class="os-terms"><b>Conferência na entrega</b> · Recebi o equipamento e conferi o serviço realizado.</section>' +
      '<section class="signatures"><div>Responsável pela empresa</div><div>Cliente / responsável</div></section>' +
      '<footer>Via destinada ao ' + escapeHtml(copyLabel === 'VIA DO CLIENTE' ? 'cliente' : 'estabelecimento') + ' · Documento de atendimento, sem validade fiscal.</footer></article>';
  }

  function printCss(kind) {
    var os = kind === 'serviceOrder';
    return '<style>' +
      '@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#172a3b;font:10px Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.document{height:auto;min-height:275mm;position:relative;page-break-inside:avoid;padding:0 0 4mm}.issuer{display:flex;align-items:center;gap:14px;border-bottom:2px solid #1262c4;padding:0 0 8px;margin-bottom:10px;min-height:34px}.logo{width:56px;height:45px;object-fit:contain}.issuer-copy{min-width:0;display:grid;gap:3px}.issuer-name{font-size:16px;font-weight:700;color:#123e76}.muted{font-size:10px;color:#52677c}.issuer-lines{display:flex;flex-wrap:wrap;gap:3px 12px;font-size:8.5px;color:#40566e}.doc-title{display:flex;justify-content:space-between;align-items:center;margin:9px 0}.eyebrow{font-size:8px;font-weight:700;letter-spacing:1.3px;color:#1262c4}.doc-title h1{margin:3px 0 0;font-size:21px;letter-spacing:.3px}.doc-number{display:grid;text-align:right;gap:3px}.doc-number strong{font-size:16px;color:#1262c4}.doc-number span{font-size:8px;color:#60758b}.meta{display:flex;flex-wrap:wrap;gap:5px 18px;padding:7px 9px;background:#f0f5fb;border-radius:5px;font-size:9px;margin-bottom:8px}.party{border:1px solid #d9e2ed;border-radius:5px;padding:8px 10px;margin-bottom:10px}.party h2{font-size:11px;margin:0 0 5px}.party p{font-size:8.5px;line-height:1.35;margin:3px 0}.sep{padding:0 4px;color:#91a2b3}table{border-collapse:collapse;width:100%;margin:10px 0}thead th{background:#eaf1f9;color:#284666;text-align:left;font-size:8px;padding:7px 6px;border-bottom:1px solid #cdd9e8}tbody td{padding:7px 6px;border-bottom:1px solid #e1e7ed;font-size:9px;vertical-align:top}.index{width:24px;color:#677d92}.num{text-align:right;white-space:nowrap}.line-detail{display:block;margin-top:3px;font-size:8px;line-height:1.3;color:#586d82}.total{margin:8px 0;display:flex;justify-content:flex-end;align-items:center;gap:18px;padding:8px 10px;background:#f0f5fb;border-radius:5px}.total span{font-size:9px}.total strong{font-size:15px;color:#123e76}.notes{border-left:3px solid #1262c4;background:#f7f9fc;padding:7px 9px;margin:9px 0;font-size:9px}.notes p{margin:4px 0;white-space:pre-wrap;line-height:1.4}.signatures{display:flex;justify-content:space-between;gap:30px;margin:22px 14px 12px}.signatures div{width:45%;border-top:1px solid #64788c;padding-top:4px;text-align:center;font-size:8px}footer{position:absolute;bottom:0;left:0;right:0;border-top:1px solid #dce4ec;padding-top:5px;color:#667b8e;font-size:7.5px;text-align:center}' +
      (os ? '.document.os-document{height:134mm;min-height:134mm;overflow:hidden;padding:0 0 3mm;border-bottom:1px dashed #8093a8;margin-bottom:5mm}.os-document:last-child{margin-bottom:0}.os-document .issuer{margin-bottom:5px;padding-bottom:5px;min-height:28px}.os-document .logo{width:44px;height:32px}.os-document .issuer-name{font-size:13px}.os-document .issuer-lines{font-size:7px;gap:2px 8px}.os-document .doc-title{margin:4px 0}.os-document .doc-title h1{font-size:17px}.os-document .meta{margin-bottom:5px;padding:5px 7px;font-size:7.5px}.os-document .party{padding:5px 7px;margin-bottom:5px}.os-document .party h2{font-size:9px;margin-bottom:3px}.os-document .party p{font-size:7px;margin:2px 0}.os-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}.os-grid section{min-width:0;border-bottom:1px solid #e2e8ef;padding:3px 1px}.os-grid b,.os-terms b{font-size:7px;text-transform:uppercase;color:#526a82;letter-spacing:.25px}.os-grid p{font-size:8px;line-height:1.2;margin:2px 0 0;overflow-wrap:anywhere}.os-grid .wide{grid-column:1/-1}.os-grid .wide p,.os-grid section:not(.wide) p{max-height:18px;overflow:hidden}.os-terms{margin-top:5px;padding:5px;background:#f2f6fb;font-size:7px}.os-document .signatures{margin:12px 8px 8px}.os-document footer{font-size:6.5px;padding-top:3px}' : '') +
      '@media screen{body{padding:10mm;background:#e9eef4}.document{width:190mm;min-height:275mm;margin:0 auto 8mm;background:white;padding:10mm;box-shadow:0 4px 18px #1d365022}.document.os-document{height:134mm;min-height:134mm;padding:6mm;margin-bottom:5mm}}@media print{body{background:#fff}.document{width:auto}.document.os-document{break-inside:avoid}}' +
      (os ? '.os-grid .wide p{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;max-height:30px;overflow:hidden}.continued{font-size:6.5px;color:#60758b;font-style:italic}' : '') +
      '</style>';
  }

  function documentHtml(kind, data) {
    var title = kind === 'quote' ? 'Orcamento' : kind === 'order' ? 'Pedido' : kind === 'sale' ? 'Venda' : 'Ordem de Servico';
    var companyName = (cache.company && (cache.company.tradeName || cache.company.legalName)) || 'Empresa';
    var safeTitle = (companyName + ' - ' + title + ' ' + String(data.id || data.os_number || '').slice(0, 8))
      .replace(/[\\/:*?"<>|]+/g, '-');
    var first = documentBody(kind, data, kind === 'serviceOrder' ? 'VIA DO CLIENTE' : '');
    var content = kind === 'serviceOrder' ? first + documentBody(kind, data, 'VIA DA EMPRESA') : first;
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' +
      escapeHtml(safeTitle) + '</title>' + printCss(kind) + '</head><body>' + content + '</body></html>';
  }

  function print(kind, data) {
    var popup = window.open('', '_blank');
    if (!popup) {
      window.alert('O navegador bloqueou a janela do documento. Permita pop-ups para gerar o PDF.');
      return;
    }
    popup.document.open();
    popup.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Preparando documento</title></head><body style="font:16px Arial;padding:32px">Preparando o documento...</body></html>');
    popup.document.close();
    load().then(function () {
      if (popup.closed) return;
      popup.document.open();
      popup.document.write(documentHtml(kind, data));
      popup.document.close();
      var images = Array.from(popup.document.images);
      images.forEach(function (image) { image.addEventListener('error', function () { image.remove(); }, { once: true }); });
      Promise.all(images.map(function (image) {
        if (image.complete) { if (!image.naturalWidth) image.remove(); return Promise.resolve(); }
        return new Promise(function (resolve) {
          image.onload = resolve;
          image.onerror = resolve;
          setTimeout(resolve, 1800);
        });
      })).then(function () {
        if (!popup.closed) { popup.focus(); popup.print(); }
      });
    }).catch(function (error) {
      if (popup.closed) return;
      popup.document.body.textContent = error.message || 'Não foi possível preparar o documento.';
    });
  }

  window.JvgCommercialDocuments = { load: load, print: print };
})();
