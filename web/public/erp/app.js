(function () {
  'use strict';
  var labels = {dashboard:'Visão geral',products:'Produtos',clients:'Clientes',services:'Serviços',fiscal:'Painel fiscal',inventory:'Estoque',reports:'Relatórios',profile:'Meu perfil',settings:'Empresa'};
  // Nunca mostrar dados locais como se fossem cadastros reais da empresa.
  var state = emptyState();
  var view = 'dashboard', query = '', filter = 'all', partyFilter = 'all';
  var cloud = {status:'checking',displayName:'',company:null,moduleAccess:null};
  var profileData = {displayName:'',email:''};
  var logoCompanyId = '';
  var content = document.getElementById('content');
  var modalRoot = document.getElementById('modalRoot');
  var toastRoot = document.getElementById('toastRoot');
  function emptyState(){return {products:[],clients:[],services:[],movements:[],dashboard:null,companyName:'Minha empresa',productTaxDefaultsAvailable:null};}
  var loadedScopes={dashboard:false,products:false,clients:false,services:false,reports:false};
  var loadingScope='';
  var scopeErrors={};
  var dashboardRpcAvailable=null;
  function defaultFilterForView(name){return name==='products'?'active':'all';}
  function scopeForView(name){if(name==='dashboard')return 'dashboard';if(name==='products'||name==='inventory')return 'products';if(name==='clients')return 'clients';if(name==='services')return 'services';if(name==='reports')return 'reports';return '';}
  function loadingPanel(scope){var message=scopeErrors[scope]?'Não foi possível carregar os dados deste módulo.':'Carregando os dados da empresa…';return '<section class="panel"><div class="panel-body" role="status" aria-live="polite"><p>'+message+'</p>'+(scopeErrors[scope]?'<button class="btn" data-action="retry-data">Tentar novamente</button>':'')+'</div></section>';}
  function loadViewData(name){var scope=scopeForView(name);if(!scope||loadedScopes[scope]||loadingScope===scope||cloud.status!=='ready')return;refreshCloud(scope).catch(function(error){toast(error.message,'error');});}
  function h(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function ico(name){return '<svg aria-hidden="true"><use href="#i-'+name+'"></use></svg>';}
  function money(n){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);}
  function num(n){return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(n)||0);}
  function dateStr(d){return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(d));}
  function badge(active){return '<span class="badge '+(active?'green':'gray')+'">'+(active?'Ativo':'Inativo')+'</span>';}
  function btn(text,action,primary){return '<button class="btn '+(primary?'primary':'')+'" data-action="'+h(action)+'">'+(primary?ico('plus'):'')+h(text)+'</button>';}
  function heading(title,subtitle,action,actionText){return '<div class="page-heading"><div><div class="eyebrow">JVG NOTA FISCAL / PAINEL DE GESTÃO</div><h1>'+h(title)+'</h1><p>'+h(subtitle)+'</p></div>'+(action?'<div class="heading-actions">'+btn(actionText,action,true)+'</div>':'')+'</div>';}
  function banner(){
    var needs=cloud.status==='needs_company',pending=cloud.status==='waiting_secret',login=cloud.status==='login_required',billing=cloud.status==='subscription_locked';
    if(cloud.status==='ready'||cloud.status==='checking')return '';
    var title=billing?'Assinatura vencida':needs?'Cadastre a empresa para começar':pending?'O sistema ainda não está pronto para salvar':login?'Entre para acessar a empresa':cloud.status==='error'?'Não foi possível carregar os dados':'Aguarde um instante';
    var detail=billing?'O acesso aos módulos está suspenso. Consulte boletos e Pix, informe um pagamento ou fale com a equipe financeira.':needs?'Informe a razão social e os dados fiscais do emitente.':pending?'Os cadastros ficam indisponíveis até a configuração do servidor ser concluída.':login?'Use seu e-mail e senha para abrir o painel.':cloud.status==='error'?'Tente novamente. Nenhum dado de exemplo será exibido.':'Os dados da empresa estão sendo carregados.';
    var action=billing?'<div class="heading-actions" style="margin-top:10px"><button class="btn primary" data-action="open-billing">'+ico('receipt')+' Ver cobranças</button></div>':needs?'<div class="heading-actions" style="margin-top:10px"><button class="btn primary" data-action="configure-company">'+ico('plus')+' Cadastrar empresa</button></div>':cloud.status==='error'?'<div class="heading-actions" style="margin-top:10px"><button class="btn" data-action="check-connection">Tentar novamente</button></div>':'';
    return '<div class="banner"><span class="banner-icon">'+ico('shield')+'</span><div class="banner-text"><strong>'+title+'</strong><p>'+detail+'</p>'+action+'</div></div>';
  }
  function stat(label,value,icon,color,foot){return '<article class="stat-card"><div class="stat-top"><span>'+h(label)+'</span><div class="stat-icon '+(color||'')+'">'+ico(icon)+'</div></div><div class="stat-value">'+h(value)+'</div><div class="stat-foot">'+h(foot)+'</div></article>';}
  function tableShell(searchPlaceholder,body,count,type){var fiscalRequest=type==='products'?'<button class="btn ghost" data-action="tax-advisor-report">'+ico('file')+' Ficha para contabilidade</button>':'';return '<section class="table-panel"><div class="table-toolbar"><label class="toolbar-search">'+ico('search')+'<input data-search-input placeholder="'+h(searchPlaceholder)+'" value="'+h(query)+'" aria-label="Filtrar registros"></label><div class="toolbar-controls"><select class="filter-select" data-filter aria-label="Filtrar situação"><option value="all" '+(filter==='all'?'selected':'')+'>Todos os status</option><option value="active" '+(filter==='active'?'selected':'')+'>Ativos</option><option value="inactive" '+(filter==='inactive'?'selected':'')+'>Inativos</option></select>'+fiscalRequest+'<button class="btn ghost" data-action="export-'+type+'">'+ico('download')+' Exportar CSV</button></div></div>'+body+'<div class="table-summary"><span>'+count+' registro(s)</span></div></section>';}
  function empty(icon,title,detail,action,actionText){return '<div class="empty-state"><div class="empty-icon">'+ico(icon)+'</div><h3>'+h(title)+'</h3><p>'+h(detail)+'</p>'+(action?btn(actionText,action,true):'')+'</div>';}
  function rowActions(kind,recordId){return '<div class="table-actions"><button class="icon-btn" title="Editar" data-action="edit-'+kind+'" data-id="'+h(recordId)+'">'+ico('edit')+'</button><button class="icon-btn" title="Inativar cadastro" aria-label="Inativar cadastro" data-action="remove-'+kind+'" data-id="'+h(recordId)+'">'+ico('trash')+'</button></div>';}
  function matches(row,keys){var hay=keys.map(function(k){return String(row[k]||'');}).join(' ').toLowerCase();return hay.indexOf(query.toLowerCase())!==-1 &&(filter==='all'||(filter==='active'?row.active:!row.active));}
  function dashboard(){
    var summary=state.dashboard;
    var totalStock=summary?Number(summary.unitsStock||0):state.products.reduce(function(s,p){return s+Number(p.stock||0);},0);
    var low=summary?Number(summary.lowStockCount||0):state.products.filter(function(p){return p.active&&Number(p.stock)<=10;}).length;
    var valuation=summary?Number(summary.stockValue||0):state.products.reduce(function(s,p){return s+Number(p.stock||0)*Number(p.cost||0);},0);
    var recent=summary?(summary.recentMovements||[]).map(function(m){return {title:'Estoque '+(Number(m.delta)>0?'adicionado: ':'reduzido: ')+(m.name||'produto'),at:m.at,icon:'warehouse'};}):[].concat(state.movements.map(function(m){return {title:'Estoque '+(m.delta>0?'adicionado: ':'reduzido: ')+(state.products.find(function(p){return p.id===m.productId;})||{}).name,at:m.at,icon:'warehouse'};})).sort(function(a,b){return new Date(b.at)-new Date(a.at);}).slice(0,5);
    var productCount=summary?Number(summary.productsCount||0):state.products.length;
    var clientCount=summary?Number(summary.clientsCount||0):state.clients.length;
    var quick=[
      ['Registrar venda','Registre uma operação comercial','cash','/erp/sales.html','Comercial'],
      ['Novo orçamento','Prepare uma proposta para o cliente','receipt','/erp/quotes.html','Comercial'],
      ['Ver pedidos','Consulte pedidos em andamento','layers','/erp/orders.html','Comercial'],
      ['Abrir ordem de serviço','Receba equipamento para manutenção','tool','/erp/service-orders.html','Assistência'],
      ['Preparar NF-e','Monte uma nota para homologação','file','/erp/nfe.html','Fiscal'],
      ['Ver estoque','Consulte saldos e movimentações','warehouse','/erp/index.html#inventory','Operação']
    ];
    return '<section class="dashboard-hero"><div class="dashboard-hero-copy"><span class="dashboard-overline">GESTÃO EMPRESARIAL</span><h1>Tudo da sua empresa, em um só lugar.</h1><p>Acesse vendas, estoque, assistência e fiscal com as informações organizadas por empresa.</p><div class="dashboard-hero-actions"><a class="dashboard-primary-link" href="/erp/sales.html">'+ico('cash')+' Abrir vendas</a><a class="dashboard-secondary-link" href="/erp/nfe.html">'+ico('file')+' Preparar NF-e</a></div></div><div class="dashboard-flow-card"><span>FLUXO COMERCIAL</span><strong>Da proposta à venda</strong><div class="dashboard-flow-line"><b>Orçamento</b><i>→</i><b>Pedido</b><i>→</i><b>Venda</b></div><small>Assistência e documentos fiscais ficam em seus módulos.</small></div></section>'+
      banner()+
      '<section class="dashboard-metrics" aria-label="Resumo da empresa">'+stat('Produtos cadastrados',productCount,'box','','Itens no catálogo')+stat('Clientes cadastrados',clientCount,'users','blue','Pessoas e empresas')+stat('Unidades em estoque',num(totalStock),'warehouse','purple',low+' produto(s) com estoque baixo')+stat('Custo estimado do estoque',money(valuation),'cash','amber','Com base nos itens cadastrados')+'</section>'+
      '<section class="dashboard-section"><div class="dashboard-section-heading"><div><span class="eyebrow">ACESSO RÁPIDO</span><h2>O que você quer fazer?</h2><p>Abra uma tarefa comum em um clique.</p></div><a href="/erp/index.html#clients">Ver cadastros '+ico('arrow')+'</a></div><div class="dashboard-action-grid">'+quick.map(function(x){return '<a class="dashboard-action-card" href="'+x[3]+'"><span class="dashboard-action-icon">'+ico(x[2])+'</span><span class="dashboard-action-copy"><small>'+x[4]+'</small><strong>'+x[0]+'</strong><span>'+x[1]+'</span></span><span class="dashboard-action-arrow" aria-hidden="true">'+ico('arrow')+'</span></a>';}).join('')+'</div></section>'+
      '<section class="dashboard-activity panel"><div class="panel-head"><div><span class="eyebrow">ATIVIDADE</span><h2>Movimentações recentes</h2><p>Últimos ajustes registrados no estoque.</p></div><button class="btn" data-view="inventory">Abrir estoque '+ico('arrow')+'</button></div><div class="panel-body"><div class="timeline">'+(recent.length?recent.map(function(x){return '<div class="timeline-row"><span class="timeline-dot">'+ico(x.icon)+'</span><div class="timeline-info"><strong>'+h(x.title)+'</strong><small>'+dateStr(x.at)+'</small></div></div>';}).join(''):'<div class="empty-mini">Ainda não há movimentações. Os ajustes de estoque aparecerão aqui.</div>')+'</div></div></section>';
  }
  function products(){
    var rows=state.products.filter(function(p){return matches(p,['sku','name','category','ncm','gtin']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Produto / Descrição</th><th>SKU</th><th>Categoria</th><th>NCM</th><th>CFOP sugerido</th><th>Estoque</th><th>Preço venda</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td><strong>'+h(p.name)+'</strong><div class="subcell">'+h(p.unit)+' · '+h(p.gtin||'SEM GTIN')+'</div></td><td class="mono">'+h(p.sku)+'</td><td>'+h(p.category||'—')+'</td><td class="mono">'+h(p.ncm||'—')+'</td><td class="mono">'+h(p.defaultCfop||'—')+'</td><td><strong>'+num(p.stock)+'</strong> '+(Number(p.stock)<=10?'<span class="badge amber">Baixo</span>':'')+'</td><td class="inline-price">'+money(p.price)+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('product',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('box','Nenhum produto encontrado','Cadastre o primeiro produto da sua empresa.','new-product','Novo produto');
    return heading('Cadastro de produtos','Organize SKU, descrição, preços, estoque e informações fiscais.','new-product','Novo produto')+banner()+tableShell('Buscar por nome, SKU ou NCM...',body,rows.length,'products');
  }
  function clients(){
    var roleMatches=function(p){return partyFilter==='all'||(partyFilter==='customer'&&p.isCustomer)||(partyFilter==='supplier'&&p.isSupplier)||(partyFilter==='carrier'&&p.isCarrier);};
    var rows=state.clients.filter(function(p){return matches(p,['registrationNumber','name','legalName','document','email','city','stateRegistration','municipalRegistration'])&&roleMatches(p);});
    var roleLabels=function(p){return [p.isCustomer?'Cliente':'',p.isSupplier?'Fornecedor':'',p.isCarrier?'Transportadora':''].filter(Boolean);};
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Nº cadastro</th><th>Nome / Razão social</th><th>Tipo de relacionamento</th><th>CPF / CNPJ</th><th>IE / IM</th><th>Cidade / UF</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td class="mono"><strong>'+h(p.registrationNumber||'—')+'</strong></td><td><strong>'+h(p.name)+'</strong>'+(p.legalName&&p.legalName!==p.name?'<div class="subcell">'+h(p.legalName)+'</div>':'')+'</td><td>'+roleLabels(p).map(function(x){return '<span class="badge blue">'+h(x)+'</span> ';}).join('')+'</td><td class="mono">'+h(p.document||'Não informado')+'</td><td><div class="mono">IE: '+h(p.stateRegistration||'—')+'</div><div class="mono">IM: '+h(p.municipalRegistration||'—')+'</div></td><td>'+h(p.city||'—')+' / '+h(p.state||'—')+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('client',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('users','Nenhum cadastro encontrado','Ajuste o filtro ou cadastre um cliente, fornecedor ou transportadora.','new-client','Novo cadastro');
    var total=state.clients.length,customers=state.clients.filter(function(p){return p.isCustomer;}).length,suppliers=state.clients.filter(function(p){return p.isSupplier;}).length,carriers=state.clients.filter(function(p){return p.isCarrier;}).length;
    var roleFilter='<div class="party-filter-row"><label>Tipo de cadastro <select class="filter-select" id="partyTypeFilter"><option value="all" '+(partyFilter==='all'?'selected':'')+'>Todos ('+total+')</option><option value="customer" '+(partyFilter==='customer'?'selected':'')+'>Clientes ('+customers+')</option><option value="supplier" '+(partyFilter==='supplier'?'selected':'')+'>Fornecedores ('+suppliers+')</option><option value="carrier" '+(partyFilter==='carrier'?'selected':'')+'>Transportadoras ('+carriers+')</option></select></label><span class="small-note">Exibindo '+rows.length+' de '+total+' cadastro(s)</span></div>';
    return heading('Cadastro de pessoas e empresas','Cadastre clientes, fornecedores e transportadoras em um único registro, com identificação fiscal completa.','new-client','Novo cadastro')+banner()+roleFilter+tableShell('Buscar por número, nome, documento, IE ou IM...',body,rows.length,'clients');
  }
  function services(){
    var rows=state.services.filter(function(p){return matches(p,['code','name','description']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Código</th><th>Valor</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td><strong>'+h(p.name)+'</strong><div class="subcell">'+h((p.description||'').slice(0,65))+'</div></td><td class="mono">'+h(p.code)+'</td><td class="inline-price">'+money(p.price)+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('service',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('layers','Nenhum serviço encontrado','Cadastre os serviços usados nas ordens e nos orçamentos.','new-service','Novo serviço');
    return heading('Cadastro de serviços','Organize os serviços usados nas ordens e nos orçamentos.','new-service','Novo serviço')+banner()+tableShell('Buscar serviço, código ou NBS...',body,rows.length,'services');
  }
  function inventory(){
    var rows=state.products.filter(function(p){return matches(p,['sku','name','category']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th>Saldo</th><th>Custo un.</th><th>Valor de custo</th><th>Situação</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){var low=Number(p.stock)<=10;return '<tr><td><strong>'+h(p.name)+'</strong></td><td class="mono">'+h(p.sku)+'</td><td><strong>'+num(p.stock)+'</strong> '+h(p.unit)+'</td><td>'+money(p.cost)+'</td><td class="inline-price">'+money(Number(p.stock)*Number(p.cost))+'</td><td><span class="badge '+(low?'amber':'green')+'">'+(low?'Estoque baixo':'Disponível')+'</span></td><td><div class="table-actions"><button class="btn sm" data-action="adjust-stock" data-id="'+h(p.id)+'">Ajustar saldo</button>'+(p.tracksStock?'<button class="btn sm" data-action="internal-consumption" data-id="'+h(p.id)+'">Registrar consumo</button>':'')+'</div></td></tr>';}).join('')+'</tbody></table></div>':empty('warehouse','Sem produtos em estoque','Cadastre produtos para fazer ajustes locais.','new-product','Cadastrar produto');
    return heading('Controle de estoque','Visualize saldos e registre ajustes reais da sua empresa.','new-product','Cadastrar produto')+banner()+tableShell('Buscar SKU ou descrição...',body,rows.length,'products');
  }
  function fiscal(){
    var entries=[
      ['Emitir NF-e','Prepare e confira uma nota de mercadorias antes do envio.','receipt','/erp/nfe.html','Preparar documento'],
      ['NFC-e · Homologação','Prepare operações ao consumidor no ambiente de homologação.','receipt','/erp/nfce.html','Somente testes'],
      ['NF-e emitidas','Consulte documentos autorizados, filtros, eventos e arquivos.','file','/erp/nfe-issued.html','Histórico de saídas'],
      ['Notas de entrada','Importe XML, confira fornecedor, itens, tributos e estoque.','download','/erp/inbound-nfe.html','Entrada por XML'],
      ['Histórico de documentos fiscais','Pesquise entradas e saídas por cliente, fornecedor, transportadora e situação.','chart','/erp/fiscal-history.html','Entradas e saídas'],
      ['Naturezas e CFOP','Consulte o catálogo e organize descrições internas.','layers','/erp/cfop.html','Consulta fiscal'],
      ['Perfis tributários opcionais','Cadastros opcionais para facilitar o preenchimento dos itens.','shield','/erp/tax-profiles.html','Configuração opcional']
    ];
    return heading('Painel fiscal','Acesse a emissão de NF-e, os documentos recebidos e o histórico da empresa.')+banner()+
      '<section class="fiscal-workspace"><div class="fiscal-workspace-heading"><div><span class="eyebrow">OPERAÇÃO FISCAL</span><h2>Documentos</h2><p>Emissão, notas recebidas e histórico da empresa.</p></div></div><div class="fiscal-workspace-grid">'+
      entries.map(function(x){return '<a class="fiscal-workspace-card" href="'+x[3]+'"><span class="fiscal-workspace-icon">'+ico(x[2])+'</span><span class="fiscal-workspace-copy"><strong>'+x[0]+'</strong><small>'+x[1]+'</small><em>'+x[4]+'</em></span><span class="fiscal-workspace-arrow" aria-hidden="true">'+ico('arrow')+'</span></a>';}).join('')+
      '</div></section>';
  }
  function simpleSoon(title,subtitle,icon,features){
    return heading(title,subtitle)+banner()+'<section class="panel wide-info"><div class="panel-body">'+empty(icon,'Módulo preparado para as próximas etapas','A navegação e a arquitetura deste módulo estão previstas. Ainda não há operação real nesta primeira versão.')+'<div class="info-list">'+features.map(function(x){return '<div class="info-row"><span>'+h(x[0])+'</span><strong>'+h(x[1])+'</strong></div>';}).join('')+'</div></div></section>';
  }
  function reports(){
    var stockValue=state.products.reduce(function(sum,p){return sum+Number(p.stock)*Number(p.cost);},0);
    var saleValue=state.products.reduce(function(sum,p){return sum+Number(p.stock)*Number(p.price);},0);
    return heading('Relatórios','Indicadores dos cadastros da empresa.')+banner()+
      '<div class="stats-grid">'+stat('Itens de produto',state.products.length,'box','','Total cadastrado')+stat('Serviços cadastrados',state.services.length,'layers','blue','No catálogo')+stat('Custo do estoque',money(stockValue),'cash','amber','Valor estimado')+stat('Preço de estoque',money(saleValue),'chart','purple','Potencial de venda teórico')+'</div>'+
      '<section class="panel"><div class="panel-head"><div><h2>Exportar cadastros</h2><p>Planilhas CSV dos registros da empresa</p></div></div><div class="panel-body"><div class="heading-actions"><button class="btn" data-action="export-products">'+ico('download')+' Produtos</button><button class="btn" data-action="export-clients">'+ico('download')+' Clientes</button><button class="btn" data-action="export-services">'+ico('download')+' Serviços</button></div></div></section>';
  }
  function shown(value){var text=String(value==null?'':value).trim();return text||'Não informado';}
  function formatDocument(value){
    var digits=String(value||'').replace(/\D/g,'');
    if(digits.length===14)return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
    return shown(value);
  }
  function regimeName(code){return {mei:'MEI',simples_nacional:'Simples Nacional',lucro_presumido:'Lucro Presumido',lucro_real:'Lucro Real',outro:'Outro'}[code]||'';}
  function settings(){
    var company=cloud.company||{};
    var address=company.address&&typeof company.address==='object'?company.address:{};
    var ready=cloud.status==='ready';
    var missing=ready&&Array.isArray(company.fiscal_missing)?company.fiscal_missing:[];
    var addressLine=[address.street,address.number,address.complement,address.district,address.city,address.state,address.postalCode].filter(function(part){return String(part||'').trim();}).join(', ');
    var regime=company.tax_regime_confirmed===true?regimeName(company.tax_regime):'';
    var items=[['Razão social',company.legal_name||company.legalName],['Nome fantasia',company.trade_name||company.tradeName],['CNPJ',formatDocument(company.cnpj)],['Inscrição estadual',company.state_registration],['Inscrição municipal',company.municipal_registration],['CNAE',company.cnae],['Regime tributário',regime],['E-mail fiscal',company.fiscal_email],['Telefone',company.fiscal_phone],['Endereço',addressLine]];
    var action=ready?'<button class="btn primary" data-action="configure-company">'+ico('edit')+' Editar empresa</button>':cloud.status==='needs_company'?'<button class="btn primary" data-action="configure-company">'+ico('plus')+' Cadastrar empresa</button>':'';
    return heading('Empresa','Dados fiscais do emitente usados na NF-e.')+banner()+
      '<div class="settings-grid"><section class="panel wide-info"><div class="panel-head"><div><h2>Cadastro fiscal do emitente</h2><p>'+h(state.companyName||'Sua empresa')+'</p></div></div><div class="panel-body"><div class="info-list">'+items.map(function(x){return '<div class="info-row"><span>'+h(x[0])+'</span><strong>'+h(shown(x[1]))+'</strong></div>';}).join('')+'</div>'+
      (ready&&missing.length?'<p class="small-note" style="margin-top:16px">Ainda falta: '+missing.map(h).join(', ')+'.</p>':'')+
      '<div class="heading-actions" style="margin-top:24px">'+action+'<button class="btn" data-action="logout">Sair da conta</button></div></div></section></div>';
  }
  function profile(){
    return heading('Meu perfil','Atualize seus dados de acesso e a identidade visual da empresa.')+
      '<div class="profile-grid">'+
      '<section class="panel"><div class="panel-head"><div><h2>Dados da conta</h2><p>Seu nome e e-mail de acesso ao sistema.</p></div></div><div class="panel-body"><form id="profileForm" class="profile-form">'+
      field('displayName','Como devemos chamar você',profileData.displayName,'required maxlength="80" autocomplete="name"',true)+
      field('profileEmail','E-mail de acesso',profileData.email,'type="email" required maxlength="254" autocomplete="email"',true)+
      '<div class="profile-form-actions"><button class="btn primary" type="submit">Salvar dados da conta</button></div><p class="small-note">Para confirmar a troca, siga as mensagens de verificação enviadas pelo sistema aos endereços envolvidos.</p></form></div></section>'+
      '<section class="panel"><div class="panel-head"><div><h2>Segurança</h2><p>Defina uma nova senha para sua conta.</p></div></div><div class="panel-body"><form id="passwordForm" class="profile-form">'+
      field('currentPassword','Senha atual','', 'type="password" required minlength="1" maxlength="128" autocomplete="current-password"',true)+
      field('newPassword','Nova senha','', 'type="password" required minlength="12" maxlength="128" autocomplete="new-password"',true)+
      field('confirmPassword','Confirme a nova senha','', 'type="password" required minlength="12" maxlength="128" autocomplete="new-password"',true)+
      '<div class="profile-form-actions"><button class="btn primary" type="submit">Atualizar senha</button></div><p class="small-note">Use pelo menos 12 caracteres. Não reutilize uma senha de outro serviço.</p></form></div></section>'+
      '<section class="panel profile-logo-panel"><div class="panel-head"><div><h2>Logo da empresa</h2><p>Ela aparece junto à empresa ativa no painel.</p></div></div><div class="panel-body"><form id="logoForm" class="profile-logo-form"><div class="profile-logo-preview"><img id="profileLogoPreview" alt="Prévia da logo da empresa" hidden><span id="profileLogoFallback">SF</span></div><div class="profile-logo-fields"><label class="field"><span>Escolha uma imagem PNG, JPEG ou WebP</span><input id="companyLogoFile" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required></label><small>Até 2 MB. A imagem ficará pública para exibição da marca; os dados da empresa continuam privados.</small><button class="btn primary" type="submit">Enviar logo da empresa</button></div></form></div></section></div>';
  }
  async function loadProfile(){
    try{
      var data=await callApi('/api/profile');
      profileData={displayName:data.displayName||'',email:data.email||''};
      var name=document.getElementById('f-displayName'),email=document.getElementById('f-profileEmail');
      if(name)name.value=profileData.displayName;if(email)email.value=profileData.email;
      var preview=document.getElementById('profileLogoPreview'),fallback=document.getElementById('profileLogoFallback');
      if(preview){preview.onload=function(){preview.hidden=false;if(fallback)fallback.hidden=true;};preview.onerror=function(){preview.hidden=true;if(fallback)fallback.hidden=false;};preview.src='/api/company/logo?v='+Date.now();}
    }catch(error){toast(error.message,'error');}
  }
  async function saveProfile(form){
    var values=Object.fromEntries(new FormData(form).entries()),button=form.querySelector('button[type="submit"]');
    if(button)button.disabled=true;
    try{
      var result=await callApi('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:values.displayName,email:values.profileEmail})});
      profileData={displayName:result.displayName||values.displayName,email:result.email||values.profileEmail};
      cloud.displayName=profileData.displayName;
      if(result.emailChangePending)toast('Dados salvos. Confirme o novo e-mail pelo link enviado.');else toast('Dados da conta atualizados.');
      render();
    }catch(error){toast(error.message,'error');}
    finally{if(button)button.disabled=false;}
  }
  async function savePassword(form){
    var values=Object.fromEntries(new FormData(form).entries()),button=form.querySelector('button[type="submit"]');
    if(values.newPassword!==values.confirmPassword){toast('As senhas informadas não coincidem.','error');return;}
    if(button)button.disabled=true;
    try{await callApi('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:values.newPassword,currentPassword:values.currentPassword})});form.reset();toast('Senha atualizada com segurança.');}
    catch(error){toast(error.message,'error');}
    finally{if(button)button.disabled=false;}
  }
  async function uploadCompanyLogo(form){
    var button=form.querySelector('button[type="submit"]'),file=form.elements.namedItem('logo');
    if(!file||!file.files||!file.files[0]){toast('Escolha uma imagem para enviar.','error');return;}
    if(button){button.disabled=true;button.textContent='Enviando...';}
    try{
      var data=new FormData();data.append('logo',file.files[0]);
      await callApi('/api/company/logo',{method:'POST',body:data});
      var preview=document.getElementById('profileLogoPreview'),fallback=document.getElementById('profileLogoFallback');
      if(preview){preview.onload=function(){preview.hidden=false;if(fallback)fallback.hidden=true;};preview.src='/api/company/logo?v='+Date.now();}
      var avatar=document.getElementById('workspaceAvatar');if(avatar){avatar.classList.remove('has-logo');var logo=document.getElementById('workspaceLogo');if(logo){logo.onload=function(){avatar.classList.add('has-logo');};logo.src='/api/company/logo?v='+Date.now();}}
      form.reset();toast('Logo da empresa atualizada.');
    }catch(error){toast(error.message,'error');}
    finally{if(button){button.disabled=false;button.textContent='Enviar logo da empresa';}}
  }
  function render(){
    document.getElementById('breadcrumb').textContent=labels[view]||labels.dashboard;
    var companyTitle=document.getElementById('workspaceName');if(companyTitle)companyTitle.textContent=state.companyName;
    var initials=document.getElementById('workspaceInitials'),avatar=document.getElementById('workspaceAvatar'),logo=document.getElementById('workspaceLogo');
    if(initials){var parts=String(state.companyName||'Minha empresa').trim().split(/\s+/).filter(Boolean);initials.textContent=(parts.length>1?parts[0][0]+parts[1][0]:parts[0].slice(0,2)).toUpperCase();}
    var profileWorkspace=document.getElementById('workspaceSwitch');if(profileWorkspace){profileWorkspace.setAttribute('aria-label','Abrir menu da empresa ativa: '+state.companyName);profileWorkspace.title='Empresa ativa · '+state.companyName;}
    var companyId=cloud.company&&cloud.company.id?String(cloud.company.id):'';
    if(logo&&companyId!==logoCompanyId){logoCompanyId=companyId;if(avatar)avatar.classList.remove('has-logo');logo.onload=function(){if(avatar)avatar.classList.add('has-logo');};logo.onerror=function(){if(avatar)avatar.classList.remove('has-logo');};logo.src=companyId?'/api/company/logo?v='+encodeURIComponent(companyId):'';}
    document.querySelectorAll('.sidebar .nav-link').forEach(function(b){var active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    var moduleAccess=cloud.moduleAccess&&typeof cloud.moduleAccess==='object'?cloud.moduleAccess:null;
    var moduleAllowed=function(key){return !moduleAccess||moduleAccess[key]!==false;};
    document.querySelectorAll('#sidebarNavigation [data-module]').forEach(function(item){item.hidden=!moduleAllowed(item.dataset.module);});
    document.querySelectorAll('#sidebarNavigation .nav-group').forEach(function(group){var links=group.querySelectorAll('.nav-link');group.hidden=links.length>0&&Array.from(links).every(function(item){return item.hidden;});});
    var views={dashboard:dashboard,products:products,clients:clients,services:services,fiscal:fiscal,inventory:inventory,reports:reports,profile:profile,settings:settings};
    var requiredScope=scopeForView(view);
    var waiting=(requiredScope&&cloud.status==='checking')||(requiredScope&&cloud.status==='ready'&&!loadedScopes[requiredScope]&&!scopeErrors[requiredScope])||(requiredScope&&loadingScope===requiredScope);
    content.innerHTML=waiting?loadingPanel(requiredScope||'dashboard'):(requiredScope&&scopeErrors[requiredScope]?loadingPanel(requiredScope):(views[view]||dashboard)());
    if(moduleAccess){var hrefModule={'/erp/sales.html':'comercial','/erp/quotes.html':'comercial','/erp/orders.html':'comercial','/erp/service-orders.html':'assistencia','/erp/nfe.html':'fiscal_nfe','/erp/index.html#inventory':'estoque'};content.querySelectorAll('.dashboard-action-card, .dashboard-hero-actions a').forEach(function(link){var key=hrefModule[link.getAttribute('href')];if(key&&!moduleAllowed(key))link.hidden=true;});}
    var search=document.getElementById('globalSearch');search.value=query;
    if(view==='profile')loadProfile();
  }
  function setView(next){if(!labels[next])return;view=next;query='';filter=defaultFilterForView(next);if(window.location.hash!=='#'+next)history.pushState(null,'','#'+next);document.getElementById('sidebar').classList.remove('open');document.getElementById('mobileBackdrop').classList.remove('active');document.getElementById('menuBtn').setAttribute('aria-expanded','false');render();loadViewData(next);document.querySelector('.main-column').scrollTop=0;}
  function field(name,label,value,extra,full,help){return '<div class="field '+(full?'full':'')+'"><label for="f-'+h(name)+'">'+h(label)+'</label><input id="f-'+h(name)+'" name="'+h(name)+'" value="'+h(value==null?'':value)+'" '+(extra||'')+'>'+(help?'<small>'+h(help)+'</small>':'')+'</div>';}
  function lookupField(name,label,value,extra,kind,full){return '<div class="field '+(full?'full':'')+'"><label for="f-'+h(name)+'">'+h(label)+'</label><div class="input-action"><input id="f-'+h(name)+'" name="'+h(name)+'" value="'+h(value==null?'':value)+'" '+extra+'><button class="btn ghost lookup-btn" type="button" data-action="lookup-'+kind+'">Consultar</button></div></div>';}
  function select(name,label,options,value,required){return '<div class="field"><label for="f-'+h(name)+'">'+h(label)+(required?' *':'')+'</label><select id="f-'+h(name)+'" name="'+h(name)+'" '+(required?'required':'')+'>'+options.map(function(o){return '<option value="'+h(o[0])+'" '+(String(value)===String(o[0])?'selected':'')+'>'+h(o[1])+'</option>';}).join('')+'</select>'+(name==='origin'?'<small class="field-help">Necessária para NF-e. Informe a origem real do item com a contabilidade.</small>':'')+'</div>';}
  function productForm(p){var taxDisabled=state.productTaxDefaultsAvailable===false?'disabled':'';var taxNotice=state.productTaxDefaultsAvailable===false?'<div class="field full product-tax-notice" role="status">A atualização dos campos fiscais padrão ainda está pendente. O restante do cadastro continua disponível.</div>':'';return field('sku','Código interno (SKU) *',p.sku,'required maxlength="40"',false)+field('name','Descrição do produto *',p.name,'required maxlength="160"',false)+field('category','Categoria',p.category,'maxlength="80"',false)+select('unit','Unidade',[['UN','Unidade (UN)'],['KG','Quilograma (KG)'],['M','Metro (M)'],['L','Litro (L)'],['CX','Caixa (CX)'],['PAR','Par (PAR)'],['PCT','Pacote (PCT)']],p.unit||'UN',true)+field('ncm','NCM',p.ncm,'inputmode="numeric" maxlength="8" pattern="[0-9]{8}"',false,'8 dígitos; confira com seu contador.')+field('cest','CEST (quando aplicável)',p.cest,'maxlength="12"',false)+field('defaultCfop','CFOP sugerido (opcional)',p.defaultCfop,'maxlength="4" inputmode="numeric" pattern="[0-9]{4}" list="productCfopOptions"',false,'Sugestão para NF-e: depende da operação, UF e regime. Consulte seu contador.')+select('taxProfileId','Perfil tributário (NF-e)',[['','Nenhum perfil selecionado']],p.taxProfileId||'')+field('gtin','EAN / GTIN',p.gtin||'SEM GTIN','maxlength="14"',false,'Informe SEM GTIN quando não houver código.')+select('origin','Origem da mercadoria',[['','Selecione para NF-e'],['0','0 · Nacional'],['1','1 · Estrangeira direta'],['2','2 · Estrangeira mercado interno'],['3','3 · Nacional > 40% importação'],['4','4 · Nacional processos básicos'],['5','5 · Nacional ≤ 40% importação'],['6','6 · Estrangeira sem similar'],['7','7 · Estrangeira mercado interno sem similar'],['8','8 · Nacional > 70% importação']],p.origin||'')+'<div class="field full product-tax-section"><strong>Tributação padrão para vendas <span>(opcional)</span></strong><small>Esses códigos só sugerem o preenchimento da NF-e. Podem variar conforme a operação; alterações feitas no item da nota sempre prevalecem.</small></div>'+taxNotice+field('defaultCsosn','CSOSN padrão (opcional)',p.defaultCsosn,'maxlength="3" inputmode="numeric" pattern="[0-9]{3}" '+taxDisabled,false,'Informe somente o código confirmado para este produto.')+field('defaultPisCst','CST do PIS padrão (opcional)',p.defaultPisCst,'maxlength="2" inputmode="numeric" pattern="[0-9]{2}" '+taxDisabled,false,'Código orientado para a saída do produto.')+field('defaultCofinsCst','CST da Cofins padrão (opcional)',p.defaultCofinsCst,'maxlength="2" inputmode="numeric" pattern="[0-9]{2}" '+taxDisabled,false,'Código orientado para a saída do produto.')+field('cost','Preço de custo (R$)',p.cost,'type="number" min="0" step="0.01"',false)+field('price','Preço de venda (R$) *',p.price,'required type="number" min="0" step="0.01"',false)+field('stock','Saldo inicial',p.stock,'type="number" min="0" step="0.001"',false)+select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false');}
  function clientForm(p){return '<div class="field full"><strong>Classificação do cadastro *</strong><small>Uma pessoa pode exercer mais de uma função.</small><div class="party-role-options">'+[['isCustomer','Cliente',p.isCustomer!==false],['isSupplier','Fornecedor',!!p.isSupplier],['isCarrier','Transportadora',!!p.isCarrier]].map(function(x){return '<label class="party-role-option"><input type="checkbox" name="'+x[0]+'" value="true" '+(x[2]?'checked':'')+'><span>'+x[1]+'</span></label>';}).join('')+'</div></div>'+
    field('name','Nome / nome fantasia *',p.name,'required maxlength="160"',true)+
    field('legalName','Razão social',p.legalName,'maxlength="180"',true)+
    select('type','Tipo de pessoa',[['PJ','Pessoa jurídica'],['PF','Pessoa física'],['EXT','Estrangeiro']],p.type||'PJ',true)+
    lookupField('document','CPF / CNPJ (consulta para PJ)',p.document,'maxlength="18"','cnpj',false)+'<p class="lookup-note field full" data-cnpj-lookup-status role="status" aria-live="polite" hidden></p>'+
    field('stateRegistration','Inscrição Estadual (IE)',p.stateRegistration,'maxlength="40"',false)+
    field('municipalRegistration','Inscrição Municipal (IM)',p.municipalRegistration,'maxlength="40"',false)+
    field('email','E-mail',p.email,'type="email" maxlength="160"',false)+
    field('phone','Telefone / WhatsApp',p.phone,'maxlength="25"',false)+
    '<div class="field full"><strong>Endereço do cadastro</strong></div>'+
    lookupField('postalCode','CEP',p.postalCode,'inputmode="numeric" maxlength="9"','cep',false)+
    field('street','Logradouro',p.street,'maxlength="160"',true)+
    field('number','Número',p.number,'maxlength="20"',false)+
    field('complement','Complemento',p.complement,'maxlength="100"',false)+
    field('district','Bairro',p.district,'maxlength="100"',false)+
    field('city','Cidade',p.city,'maxlength="100"',false)+
    field('state','UF',p.state,'maxlength="2"',false)+
    field('cityCode','Código IBGE do município',p.cityCode,'inputmode="numeric" maxlength="7"',false)+
    select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false')+
    '<p class="lookup-note field full">A consulta de CNPJ combina a Focus com fontes cadastrais complementares. Confira os dados antes de salvar; IE e IM podem exigir confirmação direta com a empresa.</p>';}
  function updatePartyRequirements(form){if(!form||form.dataset.kind!=='client')return;var supplier=form.querySelector('[name="isSupplier"]'),type=form.querySelector('[name="type"]'),doc=form.querySelector('[name="document"]'),label=form.querySelector('label[for="f-document"]');var required=!!(supplier&&supplier.checked&&type&&type.value!=='EXT');if(doc)doc.required=required;if(label)label.textContent='CPF / CNPJ'+(required?' *':'');}
  function serviceForm(p){return field('code','Código do serviço *',p.code,'required maxlength="40"',false)+field('name','Descrição do serviço *',p.name,'required maxlength="160"',false)+field('description','Detalhamento',p.description,'maxlength="255"',true)+field('price','Valor (R$) *',p.price,'required type="number" min="0" step="0.01"',false)+select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false');}
  async function callApi(endpoint,options){
    var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},20000);
    try{
      var response=await fetch(endpoint,Object.assign({credentials:'same-origin',cache:'no-store'},options||{},{signal:controller.signal}));
      var result=await response.json().catch(function(){return {error:'Resposta inválida do servidor.'};});
      if(!response.ok)throw new Error(result.error||'A operação não pôde ser concluída.');
      return result;
    }catch(error){
      if(error.name==='AbortError')throw new Error('O servidor demorou a responder. Confira sua conexão e tente novamente.');
      throw error;
    }finally{clearTimeout(timeout);}
  }
  function setFormField(form,name,value){
    var target=form.querySelector('[name="'+name+'"]');
    if(target&&value!==undefined&&value!==null&&String(value).trim())target.value=String(value);
  }
  function setLookupField(form,name,value){
    var target=form.querySelector('[name="'+name+'"]');
    if(target&&value!==undefined&&value!==null&&String(value).trim()&&!String(target.value||'').trim())target.value=String(value);
  }
  function fillAddress(form,data){
    ['postalCode','street','number','complement','district','city','state','cityCode'].forEach(function(name){setFormField(form,name,data[name]);});
  }
  function fillLookupAddress(form,data){
    ['postalCode','street','number','complement','district','city','state','cityCode'].forEach(function(name){setLookupField(form,name,data[name]);});
  }
  function showCnpjLookupStatus(form,data){
    var status=form.querySelector('[data-cnpj-lookup-status]');if(!status)return;
    var parts=['Fonte: '+(data.source||'consulta cadastral')+'.'];
    if(data.registrationStatus)parts.push('Situação cadastral: '+data.registrationStatus+'.');
    if(typeof data.simplesNational==='boolean')parts.push('Opção pelo Simples: '+(data.simplesNational?'sim':'não')+'; confirme com a contabilidade antes de usar na emissão.');
    if(typeof data.mei==='boolean')parts.push('MEI: '+(data.mei?'sim':'não')+'.');
    if(data.cnaeDescription)parts.push('CNAE principal: '+data.cnaeDescription+'.');
    if(data.focusNote)parts.push(data.focusNote);
    (data.notices||[]).forEach(function(notice){parts.push(notice);});
    status.textContent=parts.join(' ');status.hidden=false;
  }
  async function lookupRegistration(button,kind){
    var form=button.closest('form');if(!form)return;
    var field=form.querySelector('[name="'+(kind==='cep'?'postalCode':form.id==='companyForm'?'cnpj':'document')+'"]');
    if(!field)return;
    if(kind==='cnpj'&&form.id==='recordForm'){
      var person=form.querySelector('[name="type"]');
      if(!person||person.value!=='PJ'){toast('A consulta de CNPJ é exclusiva de pessoa jurídica.','error');return;}
    }
    var value=field.value.trim();
    if(kind==='cep'&&value.replace(/\D/g,'').length!==8){toast('Digite um CEP com 8 dígitos.','error');field.focus();return;}
    if(kind==='cnpj'&&value.toUpperCase().replace(/[^A-Z0-9]/g,'').length!==14){toast('Digite um CNPJ com 14 caracteres.','error');field.focus();return;}
    var label=button.textContent;button.disabled=true;button.textContent='Consultando...';
    try{
      var data=await callApi('/api/lookup?type='+kind+'&value='+encodeURIComponent(value));
      if(!form.isConnected)return;
      if(kind==='cep'){fillAddress(form,data);}
      else {
        if(form.id==='companyForm'){
          setLookupField(form,'legalName',data.legalName);
          setLookupField(form,'tradeName',data.tradeName);
          setLookupField(form,'cnae',data.cnae);
          setLookupField(form,'fiscalEmail',data.email);
          setLookupField(form,'fiscalPhone',data.phone);
        } else {
          setLookupField(form,'name',data.tradeName||data.legalName);
          setLookupField(form,'legalName',data.legalName);
          setLookupField(form,'email',data.email);
          setLookupField(form,'phone',data.phone);
        }
        fillLookupAddress(form,data);
        showCnpjLookupStatus(form,data);
        if(data.postalCode&&/^\d{8}$/.test(data.postalCode)){
          try{
            var address=await callApi('/api/lookup?type=cep&value='+data.postalCode);
            if(form.isConnected)fillLookupAddress(form,address);
          }catch(e){/* CNPJ valido mesmo que a consulta complementar do CEP falhe. */}
        }
      }
      if(form.isConnected)toast('Dados sugeridos por '+data.source+'. Confira antes de salvar.');
    }catch(error){if(form.isConnected)toast(error.message,'error');}
    finally{if(button.isConnected){button.disabled=false;button.textContent=label;}}
  }
  async function refreshCloud(scope,invalidateDashboard){
    scope=scope||scopeForView(view)||'dashboard';
    loadingScope=scope;scopeErrors[scope]='';render();
    try{
      var endpoint='/api/records?scope='+encodeURIComponent(scope);
      if(scope==='dashboard'&&dashboardRpcAvailable===false)endpoint+='&summary=skip';
      var data=await callApi(endpoint);
      if(scope==='dashboard'&&typeof data.dashboardAvailable==='boolean')dashboardRpcAvailable=data.dashboardAvailable;
      state.companyName=data.companyName||state.companyName;
      if(scope==='dashboard'){state.dashboard=data.dashboard||null;loadedScopes.dashboard=true;}
      if(Object.prototype.hasOwnProperty.call(data,'products')){state.products=data.products||[];loadedScopes.products=true;}
      if(Object.prototype.hasOwnProperty.call(data,'productTaxDefaultsAvailable'))state.productTaxDefaultsAvailable=data.productTaxDefaultsAvailable===true;
      if(Object.prototype.hasOwnProperty.call(data,'clients')){state.clients=data.clients||[];loadedScopes.clients=true;}
      if(Object.prototype.hasOwnProperty.call(data,'services')){state.services=data.services||[];loadedScopes.services=true;}
      if(Object.prototype.hasOwnProperty.call(data,'movements'))state.movements=data.movements||[];
      if(scope==='reports'){loadedScopes.reports=true;loadedScopes.products=true;loadedScopes.clients=true;loadedScopes.services=true;}
      if(invalidateDashboard){state.dashboard=null;loadedScopes.dashboard=false;loadedScopes.reports=false;scopeErrors.dashboard='';}
      loadingScope='';render();
    }catch(error){loadingScope='';scopeErrors[scope]=error.message;render();throw error;}
  }
  var checkingConnection=false;
  async function checkConnection(){
    if(checkingConnection)return;
    checkingConnection=true;
    var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},12000);
    try{
      var response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',signal:controller.signal}),status=await response.json();
      if(response.status===401&&status.status==='sign_in_required'){window.location.replace('/login');return;}
      if(!response.ok)throw new Error(status.error||'Erro de conexão.');
      if(status.status==='admin_ready'){window.location.replace('/admin');return;}
      cloud={status:status.status,displayName:status.displayName||'',company:status.company||null,moduleAccess:status.moduleAccess&&typeof status.moduleAccess==='object'?status.moduleAccess:null};
      dashboardRpcAvailable=status.dashboardAvailable===true;
      state.companyName=String((cloud.company&& (cloud.company.trade_name||cloud.company.legal_name))||state.companyName||'Minha empresa');
      if(cloud.status==='ready'){
        if(status.dashboard){state.dashboard=status.dashboard;loadedScopes.dashboard=true;dashboardRpcAvailable=true;}
        var initialScope=scopeForView(view);
        if(initialScope&&!loadedScopes[initialScope])await refreshCloud(initialScope);
        else render();
      }else {state=emptyState();state.companyName=String((cloud.company&& (cloud.company.trade_name||cloud.company.legal_name))||'Minha empresa');render();}
    }catch(error){cloud.status='error';state=emptyState();render();toast(error.name==='AbortError'?'Não foi possível carregar agora. Tente novamente.':'Não foi possível carregar os dados.','error');}
    finally{clearTimeout(timeout);checkingConnection=false;}
  }
  function companyFiscalFields(company,includeTaxSetup){
    var a=company.address||{};
    var businessTypes=[['comercio','Comércio e loja'],['restaurante','Restaurante, bar e lanchonete'],['mercado','Mercado e supermercado'],['farmacia','Farmácia e drogaria'],['distribuidora','Distribuidora e atacado'],['industria','Indústria e fabricação'],['logistica','Logística e transportadora'],['tecnologia','Tecnologia e informática'],['assistencia_tecnica','Assistência técnica e manutenção'],['servicos','Prestação de serviços'],['saude','Clínica e saúde'],['construcao','Construção e materiais'],['agronegocio','Agronegócio'],['hotelaria','Hotelaria e hospedagem'],['petshop','Pet shop e veterinária'],['educacao','Educação'],['beleza','Salão e beleza'],['outros','Outro segmento']];
    var businessTypeOptions='<option value="">Selecione o segmento</option>'+businessTypes.map(function(item){return '<option value="'+item[0]+'" '+(String(company.business_type||'')===item[0]?'selected':'')+'>'+item[1]+'</option>';}).join('');
    var regimes=[['mei','MEI'],['simples_nacional','Simples Nacional'],['lucro_presumido','Lucro Presumido'],['lucro_real','Lucro Real'],['outro','Outro']];
    var selectedRegime=company.tax_regime_confirmed===true?company.tax_regime:'';
    var confirmationAvailable=company.tax_regime_confirmation_available===true;
    var regimeOptions='<option value="">Selecione após consultar a contabilidade</option>'+regimes.map(function(item){return '<option value="'+item[0]+'" '+(selectedRegime===item[0]?'selected':'')+'>'+item[1]+'</option>';}).join('');
    var regimeBlock='<label class="field full"><span>Regime tributário informado</span><select name="taxRegime">'+regimeOptions+'</select><small>O regime só será usado em preparação fiscal quando estiver confirmado pela contabilidade.</small></label>'+
      '<label class="field full" style="display:flex;align-items:flex-start;gap:9px"><input type="checkbox" name="taxRegimeConfirmed" value="true" '+(company.tax_regime_confirmed===true?'checked ':'')+(!confirmationAvailable?'disabled ':'')+'style="width:auto;margin-top:3px"><span>Confirmo que este regime foi conferido com a contabilidade.</span></label>'+
      (!confirmationAvailable?'<p class="small-note field full">A confirmação do regime ainda não está disponível.</p>':'');
    return '<div class="field full"><strong>Identificação e contato fiscal</strong></div>'+
      '<label class="field full"><span>Atividade principal da empresa *</span><select name="businessType" required>'+businessTypeOptions+'</select><small>Esse segmento organiza a configuração do ERP. Os recursos específicos aparecem conforme forem habilitados no plano.</small></label>'+
      (includeTaxSetup?'<div class="field full"><strong>Enquadramento tributário</strong></div>'+regimeBlock:'')+
      field('tradeName','Nome fantasia',company.trade_name||'','maxlength="160"',false)+
      lookupField('cnpj','CNPJ (numérico ou alfanumérico)',company.cnpj||'','maxlength="18" placeholder="00.000.000/0000-00"','cnpj',false)+'<p class="lookup-note field full" data-cnpj-lookup-status role="status" aria-live="polite" hidden></p>'+
      '<p class="lookup-note field full">A consulta preenche os dados cadastrais disponíveis. Confira tudo antes de salvar; IE e IM podem precisar de confirmação manual.</p>'+
      field('stateRegistration','Inscrição Estadual (IE)',company.state_registration||'','maxlength="40"',false)+
      field('municipalRegistration','Inscrição Municipal',company.municipal_registration||'','maxlength="40"',false,'Opcional. Use se a prefeitura exigir no cadastro da empresa.')+
      field('cnae','CNAE fiscal (7 dígitos)',company.cnae||'','inputmode="numeric" maxlength="10"',false,'CNAE principal da empresa.')+
      field('fiscalEmail','E-mail fiscal',company.fiscal_email||'','type="email" maxlength="254"',false)+
      field('fiscalPhone','Telefone com DDD',company.fiscal_phone||'','inputmode="tel" maxlength="24"',false)+
      '<div class="field full"><strong>Endereço fiscal da empresa</strong></div>'+
      field('street','Logradouro',a.street||'','maxlength="160"',true)+
      field('number','Número',a.number||'','maxlength="20"',false)+
      field('complement','Complemento',a.complement||'','maxlength="100"',false)+
      field('district','Bairro',a.district||'','maxlength="100"',false)+
      field('city','Município',a.city||'','maxlength="100"',false)+
      field('state','UF',a.state||'','maxlength="2" placeholder="SP"',false)+
      lookupField('postalCode','CEP (8 dígitos)',a.postalCode||'','inputmode="numeric" maxlength="9"','cep',false)+
      field('cityCode','Código IBGE do município (7 dígitos)',a.cityCode||'','inputmode="numeric" maxlength="7"',false)+
      (includeTaxSetup?'<div class="field full"><strong>Numeração da NF-e de homologação</strong><small>A Focus pode atribuir série e número automaticamente; o JVG não enviará esses campos por padrão.</small></div>'+
      field('nfeSeries','Série de controle local',company.nfe_series_homologacao==null?1:company.nfe_series_homologacao,'type="number" min="1" max="999"',false)+
      field('nfeNextNumber','Próximo número de controle local',company.nfe_next_number_homologacao==null?1:company.nfe_next_number_homologacao,'type="number" min="1" max="999999999"',false):'');
  }
  function openCompanyEditor(){
    if(!['needs_company','ready'].includes(cloud.status)){toast('Aguarde a configuração segura do servidor.','error');return;}
    var company=cloud.company||{},existing=cloud.status==='ready';
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">'+(existing?'Editar empresa':'Cadastrar empresa')+'</h2><p>Dados fiscais do emitente.</p></div><button class="icon-btn" type="button" data-action="close-modal">'+ico('x')+'</button></div><form id="companyForm"><div class="modal-body"><div class="form-grid">'+
      field('legalName','Razão social ou nome da empresa *',company.legal_name||'','required maxlength="160"',true)+
      companyFiscalFields(company,existing)+
      '</div><p class="small-note" style="margin-top:16px">O sistema não considera o regime padrão como confirmação fiscal. Perfis são opcionais; os dados fiscais da nota precisam estar corretos antes do envio. Salvar este cadastro não transmite nota.</p></div><div class="modal-footer"><small>* Obrigatório</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar empresa</button></div></div></form></div></div>';
    // O formulario permanece aberto ao clicar no fundo: somente os botoes
    // Fechar/Cancelar ou a conclusao do cadastro podem dispensa-lo.
    modalRoot.querySelector('[name]').focus();
  }
  async function saveCompany(form){
    var values=Object.fromEntries(new FormData(form).entries()),existing=cloud.status==='ready';
    var button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{
      values.taxRegimeConfirmed=!!form.querySelector('[name="taxRegimeConfirmed"]')?.checked;
      var result=await callApi('/api/company',{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
      cloud.status='ready';cloud.company=result.company;closeModal();await checkConnection();toast('Empresa salva.');
    }catch(error){toast(error.message,'error');if(button)button.disabled=false;}
  }
  function openEditor(kind,recordId){
    if(cloud.status!=='ready'&&cloud.status!=='needs_company'){toast('Conecte a empresa ao servidor para cadastrar.','error');return;}
    if(cloud.status==='needs_company'){openCompanyEditor();return;}
    var list=state[kind+'s'];if(!list)return;
    var current=recordId?list.find(function(x){return x.id===recordId;}):null;
    var p=current||{},titles={product:'produto',client:'cliente',service:'serviço'},body=kind==='product'?productForm(p):kind==='client'?clientForm(p):serviceForm(p);
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">'+(current?'Editar ':'Cadastrar novo ')+titles[kind]+'</h2><p>Cadastro da empresa ativa.</p></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Fechar">'+ico('x')+'</button></div><form id="recordForm" data-kind="'+kind+'" data-id="'+h(recordId||'')+'"><div class="modal-body"><div class="form-grid">'+body+'</div></div><div class="modal-footer"><small>* Campos obrigatórios</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">'+ico('check')+' Salvar cadastro</button></div></div></form></div></div>';
    if(kind==='product'&&current&&cloud.status==='ready'){
      var stockField=modalRoot.querySelector('[name="stock"]');
      if(stockField){stockField.readOnly=true;stockField.title='Use Ajustar saldo no módulo Estoque';}
    }
    if(kind==='product'){loadProductCfopOptions();loadProductProfileOptions(p.taxProfileId||'');}if(kind==='client')updatePartyRequirements(document.getElementById('recordForm'));
    // Evita fechamento acidental ao arrastar o mouse para selecionar texto
    // ou escolher opcoes dos campos de cadastro.
    var first=modalRoot.querySelector('[name]');if(first)first.focus();
  }
  async function loadProductProfileOptions(selected){
    try{
      var response=await callApi('/api/fiscal/tax-profiles');
      var field=modalRoot.querySelector('#recordForm [name="taxProfileId"]');
      if(!field)return;
      (response.records||[]).forEach(function(profile){var opt=document.createElement('option');opt.value=profile.id;opt.textContent=profile.name+' · pendente de revisão';field.appendChild(opt);});
      field.value=selected||'';
    }catch(error){toast('Perfis tributários indisponíveis no momento.','error');}
  }
  var productCfopOptionsLoaded=false;
  async function loadProductCfopOptions(){
    if(productCfopOptionsLoaded)return;
    try{
      var response=await callApi('/api/fiscal/cfop');
      var datalist=document.getElementById('productCfopOptions');
      if(!datalist)return;
      datalist.replaceChildren();
      (response.records||[]).forEach(function(cfop){var item=document.createElement('option');item.value=cfop.code;item.label=cfop.customLabel||cfop.title;datalist.append(item);});
      productCfopOptionsLoaded=true;
    }catch(error){/* O código pode ser digitado; o servidor valida contra o catálogo. */}
  }
  function closeModal(){modalRoot.innerHTML='';}
  function toast(msg,kind){var el=document.createElement('div');el.className='toast '+(kind||'');el.innerHTML=ico(kind==='error'?'x':'check')+'<span>'+h(msg)+'</span>';toastRoot.appendChild(el);setTimeout(function(){el.remove();},3800);}
  async function saveRecord(form){
    if(cloud.status!=='ready'){toast('Cadastro indisponível sem conexão com o banco.','error');return;}
    var kind=form.dataset.kind,recordId=form.dataset.id,values=Object.fromEntries(new FormData(form).entries()),list=state[kind+'s'];
    if(!list)return;
    var code=kind==='product'?values.sku:kind==='service'?values.code:null;
    if(code&&list.some(function(x){return x.id!==recordId&&(kind==='product'?x.sku:x.code).trim().toUpperCase()===code.trim().toUpperCase();})){toast('Já existe um cadastro com este código.','error');return;}
    var record={id:recordId||null};
    if(kind==='product'){
      if(values.ncm&&!/^\d{8}$/.test(values.ncm)){toast('NCM deve conter 8 dígitos.','error');return;}
      if(values.gtin && values.gtin!=='SEM GTIN' && !/^\d{8}$|^\d{12,14}$/.test(values.gtin)){toast('GTIN deve conter 8, 12, 13 ou 14 dígitos ou SEM GTIN.','error');return;}
      if(values.defaultCsosn&&!/^\d{3}$/.test(values.defaultCsosn)){toast('O CSOSN padrão deve conter 3 dígitos.','error');return;}
      if(values.defaultPisCst&&!/^\d{2}$/.test(values.defaultPisCst)){toast('O CST padrão do PIS deve conter 2 dígitos.','error');return;}
      if(values.defaultCofinsCst&&!/^\d{2}$/.test(values.defaultCofinsCst)){toast('O CST padrão da Cofins deve conter 2 dígitos.','error');return;}
      record=Object.assign(record,{sku:values.sku.trim(),name:values.name.trim(),category:values.category.trim(),unit:values.unit,ncm:values.ncm,cest:values.cest,defaultCfop:values.defaultCfop.trim(),taxProfileId:values.taxProfileId||null,defaultCsosn:values.defaultCsosn,defaultPisCst:values.defaultPisCst,defaultCofinsCst:values.defaultCofinsCst,gtin:values.gtin||'SEM GTIN',origin:values.origin,cost:Number(values.cost||0),price:Number(values.price||0),stock:Number(values.stock||0),active:values.active==='true'});
      if(record.price<0||record.cost<0||record.stock<0){toast('Valores não podem ser negativos.','error');return;}
    }else if(kind==='client'){
      var doc=values.document.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(values.isSupplier==='true'&&values.type!=='EXT'&&!doc){toast('CPF/CNPJ obrigatório para vincular fornecedor a NF-e de entrada.','error');return;}if(doc&&((values.type==='PF'&&!/^\d{11}$/.test(doc))||(values.type==='PJ'&&!/^[A-Z0-9]{12}\d{2}$/.test(doc)))){toast('CPF/CNPJ tem formato incompatível com o tipo de pessoa.','error');return;}
      var isCustomer=values.isCustomer==='true',isSupplier=values.isSupplier==='true',isCarrier=values.isCarrier==='true';
      if(!isCustomer&&!isSupplier&&!isCarrier){toast('Selecione pelo menos um tipo: cliente, fornecedor ou transportadora.','error');return;}
      record=Object.assign(record,{name:values.name.trim(),legalName:values.legalName.trim(),type:values.type,document:doc,stateRegistration:values.stateRegistration.trim(),municipalRegistration:values.municipalRegistration.trim(),isCustomer:isCustomer,isSupplier:isSupplier,isCarrier:isCarrier,email:values.email.trim(),phone:values.phone.trim(),street:values.street.trim(),number:values.number.trim(),complement:values.complement.trim(),district:values.district.trim(),postalCode:values.postalCode.replace(/\D/g,''),cityCode:values.cityCode.replace(/\D/g,''),city:values.city.trim(),state:values.state.trim().toUpperCase(),active:values.active==='true'});
    }else{
      var current=recordId?list.find(function(x){return x.id===recordId;}):null;
      record=Object.assign(record,{code:values.code.trim(),name:values.name.trim(),description:values.description.trim(),lc116:current&&current.lc116||'',nbs:current&&current.nbs||'',nationalTaxationCode:current&&current.nationalTaxationCode||'',price:Number(values.price||0),active:values.active==='true'});
      if(record.price<0){toast('Valor inválido.','error');return;}
    }
    var submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
    try{
      var saved=await callApi('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind,id:recordId||null,record:record})});
      if(kind==='product'&&!recordId&&record.stock>0){
        try{await callApi('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:saved.id,delta:record.stock,reason:'Saldo inicial do cadastro'})});}
        catch(stockError){toast('Produto salvo, mas ajuste inicial pendente: '+stockError.message,'error');}
      }
      closeModal();await refreshCloud(scopeForView(view),true);toast('Cadastro salvo.');
    }catch(error){toast(error.message,'error');if(submit)submit.disabled=false;}
  }
  async function removeRecord(kind,recordId){
    if(cloud.status!=='ready'){toast('Operação indisponível sem conexão com o banco.','error');return;}
    var list=state[kind+'s'],p=list&&list.find(function(x){return x.id===recordId;});if(!p)return;
    var name=p.name||p.sku||p.code;
    if(!confirm('Remover "'+name+'" da lista ativa? O cadastro ficará inativo e será preservado no histórico da empresa.'))return;
    try{await callApi('/api/records',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind,id:recordId})});filter='active';query='';await refreshCloud(scopeForView(view),true);toast('Cadastro removido da lista ativa. Consulte Inativos para ver o histórico.');}
    catch(error){toast(error.message,'error');}
  }
  function adjustStock(recordId){
    var p=state.products.find(function(x){return x.id===recordId;});if(!p)return;
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">Ajustar estoque</h2><p>'+h(p.name)+' · Saldo atual: '+num(p.stock)+' '+h(p.unit)+'</p></div><button class="icon-btn" type="button" data-action="close-modal">'+ico('x')+'</button></div><form id="stockForm" data-id="'+h(recordId)+'"><div class="modal-body"><div class="form-grid"><div class="field"><label for="stockDelta">Quantidade de ajuste *</label><input id="stockDelta" name="delta" type="number" step="0.001" required placeholder="Ex.: 10 ou -2"><small>Positivo = entrada. Negativo = saída.</small></div><div class="field"><label for="stockReason">Motivo *</label><input id="stockReason" name="reason" maxlength="120" required placeholder="Ex.: Inventário de teste"></div></div><p class="small-note">Ajuste de estoque registrado na sua empresa. Confira antes de confirmar.</p></div><div class="modal-footer"><small>O saldo não poderá ficar negativo.</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Confirmar ajuste</button></div></div></form></div></div>';
    // A janela de ajuste nao fecha ao tocar fora dela.
    document.getElementById('stockDelta').focus();
  }
  function internalConsumption(recordId){
    var p=state.products.find(function(x){return x.id===recordId;});if(!p)return;
    if(!p.tracksStock){toast('Este produto não controla estoque.','error');return;}
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">Registrar consumo interno</h2><p>'+h(p.name)+' · Saldo atual: '+num(p.stock)+' '+h(p.unit)+'</p></div><button class="icon-btn" type="button" data-action="close-modal">'+ico('x')+'</button></div><form id="internalConsumptionForm" data-id="'+h(recordId)+'"><div class="modal-body"><div class="form-grid"><div class="field"><label for="consumptionQuantity">Quantidade consumida *</label><input id="consumptionQuantity" name="quantity" type="number" min="0.001" max="'+h(p.stock)+'" step="0.001" required placeholder="Ex.: 1"></div><div class="field"><label for="consumptionReason">Motivo *</label><input id="consumptionReason" name="reason" maxlength="90" required placeholder="Ex.: uso interno / demonstração"></div></div><p class="small-note">Esta ação dá baixa no estoque e registra o motivo. Não emite NFC-e nem cria lançamento em contas a pagar.</p></div><div class="modal-footer"><small>O saldo não poderá ficar negativo.</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Voltar</button><button class="btn primary" type="submit">Confirmar consumo</button></div></div></form></div></div>';
    document.getElementById('consumptionQuantity').focus();
  }
  async function saveInternalConsumption(form){
    if(cloud.status!=='ready'){toast('Consumo indisponível sem conexão com o banco.','error');return;}
    var p=state.products.find(function(x){return x.id===form.dataset.id;});if(!p)return;
    var data=Object.fromEntries(new FormData(form).entries()),quantity=Number(data.quantity),reason=String(data.reason||'').trim();
    if(!Number.isFinite(quantity)||quantity<=0){toast('Informe uma quantidade consumida válida.','error');return;}
    if(quantity>Number(p.stock)){toast('A quantidade supera o saldo disponível. Atualize o estoque e confira novamente.','error');return;}
    if(reason.length<3){toast('Descreva o motivo do consumo interno.','error');return;}
    try{await callApi('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:p.id,delta:-quantity,reason:'Consumo interno: '+reason.slice(0,96)})});closeModal();await refreshCloud(scopeForView(view),true);toast('Saída por consumo interno registrada; o saldo foi atualizado.');}
    catch(error){toast(error.message,'error');}
  }
  async function saveStock(form){
    if(cloud.status!=='ready'){toast('Ajuste indisponível sem conexão com o banco.','error');return;}
    var p=state.products.find(function(x){return x.id===form.dataset.id;});if(!p)return;
    var data=Object.fromEntries(new FormData(form).entries()),delta=Number(data.delta);
    if(!Number.isFinite(delta)||delta===0){toast('Informe uma quantidade diferente de zero.','error');return;}
    if(Number(p.stock)+delta<0){toast('O saldo não pode ficar negativo.','error');return;}
    try{await callApi('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:p.id,delta:delta,reason:data.reason})});closeModal();await refreshCloud(scopeForView(view),true);toast('Estoque atualizado.');}
    catch(error){toast(error.message,'error');}
  }
    function printTaxAdvisorReport(){
    if(cloud.status!=='ready'){toast('Conecte ao cadastro da empresa para gerar a ficha.','error');return;}
    var products=state.products.filter(function(p){return matches(p,['sku','name','category','ncm','gtin']);});
    if(!products.length){toast('Não há produtos no filtro atual para incluir na ficha.','error');return;}
    var company=cloud.company||{},address=company.address||{};
    var companyName=company.trade_name||company.legal_name||state.companyName||'Empresa';
    var addressText=[address.street,address.number,address.complement,address.district,address.city,address.state,address.postal_code||address.postalCode].filter(Boolean).join(', ');
    var logoUrl=String(company.logo_url||'');
    var logo=logoUrl.indexOf('https://')===0?'<img class="company-logo" src="'+h(logoUrl)+'" alt="Logo da empresa">':'';
    var origins={'0':'0 · Nacional','1':'1 · Estrangeira direta','2':'2 · Estrangeira adquirida no mercado interno','3':'3 · Nacional, conteúdo de importação superior a 40%','4':'4 · Nacional, conforme processo produtivo básico','5':'5 · Nacional, conteúdo de importação inferior ou igual a 40%','6':'6 · Estrangeira, sem similar nacional','7':'7 · Estrangeira adquirida no mercado interno, sem similar nacional','8':'8 · Nacional, conteúdo de importação superior a 70%'};
    var rows=products.map(function(p,index){
      var current=[['CFOP sugerido',p.defaultCfop],['CSOSN',p.defaultCsosn],['CST PIS',p.defaultPisCst],['CST Cofins',p.defaultCofinsCst]];
      return '<article class="product-card"><div class="product-head"><span>PRODUTO '+String(index+1).padStart(2,'0')+'</span><h2>'+h(p.name)+'</h2></div>'+
        '<div class="facts"><div><small>SKU</small><strong>'+h(p.sku||'Não informado')+'</strong></div><div><small>NCM</small><strong>'+h(p.ncm||'Não informado')+'</strong></div><div><small>CEST</small><strong>'+h(p.cest||'Não informado')+'</strong></div><div><small>Origem declarada</small><strong>'+h(origins[String(p.origin||'')]||'Não informada')+'</strong></div><div><small>Unidade</small><strong>'+h(p.unit||'Não informada')+'</strong></div></div>'+
        '<div class="current"><strong>Referências já cadastradas no ERP</strong><span>'+current.map(function(x){return h(x[0])+': '+h(x[1]||'não informado');}).join(' · ')+'</span></div>'+
        '<table><thead><tr><th>Operação / condição</th><th>CFOP</th><th>CSOSN</th><th>CST PIS</th><th>CST Cofins</th><th>Orientação / observações</th></tr></thead><tbody>'+
        '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>'+
        '<p class="prompt">Peça ao escritório que identifique quando a regra muda por operação, regime especial do produto, substituição tributária, tributação monofásica ou exportação.</p></article>';
    }).join('');
    var regime=company.tax_regime_confirmed===true?regimeName(company.tax_regime):'Não confirmado pela contabilidade';
    var printWindow=window.open('','_blank');
    if(!printWindow){toast('O navegador bloqueou a nova janela. Permita pop-ups para abrir a ficha.','error');return;}
    var html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ficha fiscal para contabilidade - '+h(companyName)+'</title><style>'+
      '@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#17263d;margin:0;background:#fff}.report{max-width:1200px;margin:24px auto;padding:24px}.report-actions{display:flex;justify-content:flex-end;margin:0 0 14px}.print-btn{background:#1769d2;color:white;border:0;border-radius:7px;padding:11px 16px;font-weight:700;cursor:pointer}.header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #1769d2;padding-bottom:14px;margin-bottom:16px}.header h1{font-size:20pt;margin:4px 0 6px}.eyebrow{font-size:8pt;letter-spacing:1px;color:#1769d2;font-weight:700}.company{min-width:320px;text-align:right;line-height:1.5}.company-logo{max-width:130px;max-height:55px;object-fit:contain;display:block;margin:0 0 8px auto}.muted{color:#65748a}.notice{background:#eef5ff;border:1px solid #cadcf5;border-radius:7px;padding:10px 12px;margin:14px 0;line-height:1.45}.product-card{border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin:12px 0;break-inside:avoid;page-break-inside:avoid}.product-head span{font-size:7pt;color:#1769d2;font-weight:bold;letter-spacing:.8px}.product-head h2{font-size:13pt;margin:4px 0 10px}.facts{display:grid;grid-template-columns:1.4fr .75fr .75fr 1.5fr .6fr;gap:8px}.facts div{background:#f4f7fb;border-radius:5px;padding:7px}.facts small,.facts strong{display:block}.facts small{font-size:7pt;color:#66758a;margin-bottom:3px}.facts strong{font-size:8.5pt}.current{margin:9px 0;background:#f8fafc;padding:7px 9px;border-left:3px solid #0e7490;font-size:8pt}.current strong{display:block;margin-bottom:3px}.product-card table{width:100%;border-collapse:collapse;margin-top:9px;table-layout:fixed}.product-card th,.product-card td{border:1px solid #cbd5e1;padding:6px;vertical-align:top}.product-card th{background:#eef4fb;text-align:left;font-size:7.5pt}.product-card td{height:29px}.product-card th:first-child{width:24%}.product-card th:nth-child(2),.product-card th:nth-child(3),.product-card th:nth-child(4),.product-card th:nth-child(5){width:8%}.product-card th:last-child{width:36%}.prompt{font-size:7.5pt;color:#53647b;margin:7px 0 0}.signature{display:grid;grid-template-columns:1fr 1fr 1fr;gap:25px;margin-top:22px}.signature span{border-top:1px solid #607085;padding-top:5px;font-size:8pt}.footer{border-top:1px solid #cbd5e1;margin-top:16px;padding-top:8px;font-size:7.5pt;color:#53647b;line-height:1.45}@media print{body{font-size:9pt}.report{max-width:none;margin:0;padding:0}.report-actions{display:none}.header{margin-bottom:10px}.product-card{margin:8px 0;padding:9px}.product-card th,.product-card td{padding:4px}.prompt,.footer{font-size:7pt}}'+
      '</style></head><body><main class="report"><div class="report-actions"><button class="print-btn" type="button" id="printReport">Imprimir / Salvar em PDF</button></div><header class="header"><div><div class="eyebrow">SOLICITAÇÃO DE ORIENTAÇÃO CONTÁBIL</div><h1>Classificação fiscal de produtos</h1><div class="muted">Ficha auxiliar · '+h(new Date().toLocaleDateString('pt-BR'))+' · '+products.length+' produto(s) exibido(s)</div></div><div class="company">'+logo+'<strong>'+h(companyName)+'</strong><br>CNPJ: '+h(formatDocument(company.cnpj))+'<br>'+h(addressText||'Endereço não informado')+'<br>Telefone: '+h(company.fiscal_phone||'Não informado')+' · E-mail: '+h(company.fiscal_email||'Não informado')+'<br>Regime: '+h(regime)+'</div></header>'+
      '<section class="notice"><strong>Para o escritório contábil:</strong> informe os códigos aplicáveis a cada produto e operação nos campos abaixo, incluindo as condições em que a regra muda. Esta ficha não calcula tributos, não define a classificação e não autoriza emissão de NF-e. Os valores atualmente cadastrados aparecem apenas para conferência; a resposta do contador deve ser registrada no produto ou na regra da operação.</section>'+
      rows+
      '<div class="signature"><span>Contador / escritório</span><span>CRC (se aplicável)</span><span>Data e assinatura</span></div><footer class="footer">Documento de apoio para revisão entre empresa e contabilidade. Confirme também o tratamento de mercadorias sujeitas a regime monofásico, substituição tributária, exportação ou outra regra especial. Não usar dados preenchidos nesta ficha como autorização fiscal sem validação profissional.</footer></main></body></html>';
    printWindow.document.open();printWindow.document.write(html);printWindow.document.close();
    printWindow.document.getElementById('printReport').addEventListener('click',function(){printWindow.focus();printWindow.print();});
  }
function exportCsv(kind){
    if(cloud.status!=='ready'){toast('Conecte ao banco antes de exportar.','error');return;}
    var data=state[kind],fields=kind==='products'?['sku','name','category','unit','ncm','cest','defaultCfop','gtin','origin','cost','price','stock','active']:kind==='clients'?['name','type','document','email','phone','postalCode','street','number','complement','district','city','state','cityCode','active']:['code','name','description','price','active'];
    if(!Array.isArray(data)||!data.length){toast('Não há dados para exportar.','error');return;}
    var lines=[fields.join(';')].concat(data.map(function(r){return fields.map(function(f){return '"'+String(r[f]??'').replace(/"/g,'""')+'"';}).join(';');}));
    var blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='JVG_'+kind+'_cadastros.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},300);toast('CSV exportado.');
  }
  document.addEventListener('click',function(e){
    var v=e.target.closest('[data-view]');if(v){var workspaceMenu=document.getElementById('workspaceMenu');if(workspaceMenu&&workspaceMenu.contains(v))workspaceMenu.open=false;document.querySelectorAll('.sidebar-scroll .nav-group[open]').forEach(function(group){group.open=false;});setView(v.dataset.view);return;}
    var b=e.target.closest('[data-action]');if(!b)return;var a=b.dataset.action,recordId=b.dataset.id;
    if(a==='close-modal'){closeModal();return;}
    if(a==='lookup-cep'||a==='lookup-cnpj'){lookupRegistration(b,a.substring(7));return;}
    if(a==='configure-company'){openCompanyEditor();return;}
    if(a==='open-billing'){window.location.href='/billing';return;}
    if(a==='check-connection'){checkConnection();return;}
    if(a==='retry-data'){var retryScope=scopeForView(view);if(retryScope){scopeErrors[retryScope]='';refreshCloud(retryScope).catch(function(error){toast(error.message,'error');});}return;}
    if(a==='logout'){var workspaceMenu=document.getElementById('workspaceMenu');if(workspaceMenu)workspaceMenu.open=false;window.location.assign('/logout');return;}
    if(a.indexOf('new-')===0){openEditor(a.substring(4));return;}
    if(a.indexOf('edit-')===0){openEditor(a.substring(5),recordId);return;}
    if(a.indexOf('remove-')===0){removeRecord(a.substring(7),recordId);return;}
    if(a.indexOf('export-')===0){exportCsv(a.substring(7));return;}
    if(a==='tax-advisor-report'){printTaxAdvisorReport();return;}
    if(a==='adjust-stock'){adjustStock(recordId);return;}
    if(a==='internal-consumption'){internalConsumption(recordId);return;}
    if(a.indexOf('goto-')===0){setView(a.substring(5));return;}
  });
  document.addEventListener('change',function(e){if(e.target.matches('[name="isSupplier"], [name="type"]'))updatePartyRequirements(e.target.form);});
  document.addEventListener('submit',function(e){if(e.target.id==='recordForm'){e.preventDefault();saveRecord(e.target);}if(e.target.id==='stockForm'){e.preventDefault();saveStock(e.target);}if(e.target.id==='internalConsumptionForm'){e.preventDefault();saveInternalConsumption(e.target);}if(e.target.id==='companyForm'){e.preventDefault();saveCompany(e.target);}if(e.target.id==='profileForm'){e.preventDefault();saveProfile(e.target);}if(e.target.id==='passwordForm'){e.preventDefault();savePassword(e.target);}if(e.target.id==='logoForm'){e.preventDefault();uploadCompanyLogo(e.target);}});
  document.addEventListener('input',function(e){
    if(e.target.id==='globalSearch'){var searchText=e.target.value;if(view==='dashboard'){setView('products');query=searchText;render();}else{query=searchText;render();}return;}
    if(e.target.hasAttribute('data-search-input')){query=e.target.value;var pos=e.target.selectionStart;render();var next=document.querySelector('[data-search-input]');if(next){next.focus();next.setSelectionRange(pos,pos);}}
  });
  document.addEventListener('change',function(e){if(e.target.hasAttribute('data-filter')){filter=e.target.value;render();}if(e.target.id==='partyTypeFilter'){partyFilter=e.target.value;render();}});
  function closeSidebar(restoreFocus){var sidebar=document.getElementById('sidebar');var wasOpen=sidebar.classList.contains('open');sidebar.classList.remove('open');document.getElementById('mobileBackdrop').classList.remove('active');document.getElementById('menuBtn').setAttribute('aria-expanded','false');if(restoreFocus&&wasOpen)document.getElementById('menuBtn').focus();}
  document.getElementById('menuBtn').setAttribute('aria-expanded','false');
  document.getElementById('menuBtn').addEventListener('click',function(){document.getElementById('sidebar').classList.add('open');document.getElementById('mobileBackdrop').classList.add('active');this.setAttribute('aria-expanded','true');document.getElementById('closeMenuBtn').focus();});
  document.getElementById('closeMenuBtn').addEventListener('click',function(){closeSidebar(true);});
  document.getElementById('mobileBackdrop').addEventListener('click',function(){closeSidebar(true);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){var workspaceMenu=document.getElementById('workspaceMenu');if(workspaceMenu&&workspaceMenu.open){workspaceMenu.open=false;workspaceMenu.querySelector('summary')?.focus();return;}closeSidebar(true);}if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();document.getElementById('globalSearch').focus();}});
  if('scrollRestoration' in history)history.scrollRestoration='manual';
  window.scrollTo(0,0);
  document.querySelector('.main-column').scrollTop=0;
  var initialHash=decodeURIComponent(window.location.hash.slice(1));
  if(labels[initialHash])view=initialHash;
  filter=defaultFilterForView(view);
  window.addEventListener('hashchange',function(){var next=decodeURIComponent(window.location.hash.slice(1))||'dashboard';if(labels[next]&&next!==view){view=next;query='';filter=defaultFilterForView(next);closeSidebar();render();loadViewData(next);document.querySelector('.main-column').scrollTop=0;}});
  window.addEventListener('popstate',function(){var next=decodeURIComponent(window.location.hash.slice(1))||'dashboard';if(labels[next]&&next!==view){view=next;query='';filter=defaultFilterForView(next);closeSidebar();render();loadViewData(next);document.querySelector('.main-column').scrollTop=0;}});
  render();
  checkConnection();
})();
