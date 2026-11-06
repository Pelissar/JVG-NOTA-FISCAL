(function () {
  'use strict';
  var KEY = 'jvg-erp-piloto-stage1-v1';
  var labels = {dashboard:'Visão geral',products:'Produtos',clients:'Clientes',services:'Serviços',fiscal:'Notas fiscais',inventory:'Estoque',finance:'Financeiro',transport:'Transporte',reports:'Relatórios',settings:'Configurações'};
  var initial = {
    products:[
      {id:'p01',sku:'PROD-001',name:'Parafuso sextavado aço 1/4',category:'Ferragens',unit:'UN',ncm:'73181500',cest:'',gtin:'SEM GTIN',origin:'0',cost:0.85,price:1.90,stock:120,active:true},
      {id:'p02',sku:'PROD-002',name:'Cabo elétrico flexível 2,5 mm',category:'Elétrica',unit:'M',ncm:'85444900',cest:'',gtin:'SEM GTIN',origin:'0',cost:2.15,price:4.50,stock:85,active:true},
      {id:'p03',sku:'PROD-003',name:'Fita isolante 18 mm',category:'Elétrica',unit:'UN',ncm:'39191020',cest:'',gtin:'SEM GTIN',origin:'0',cost:3.90,price:7.90,stock:14,active:true},
      {id:'p04',sku:'PROD-004',name:'Luva de proteção nitrílica',category:'EPIs',unit:'PAR',ncm:'40151900',cest:'',gtin:'SEM GTIN',origin:'0',cost:4.40,price:9.90,stock:6,active:true}
    ],
    clients:[
      {id:'c01',name:'Cliente demonstração — Comércio',document:'',type:'PJ',email:'comercial@exemplo.com',phone:'',city:'São Paulo',state:'SP',active:true},
      {id:'c02',name:'Cliente demonstração — Serviços',document:'',type:'PJ',email:'atendimento@exemplo.com',phone:'',city:'Campinas',state:'SP',active:true}
    ],
    services:[
      {id:'s01',code:'SERV-001',name:'Instalação técnica',description:'Serviço de instalação e configuração.',lc116:'',nbs:'',price:180,active:true}
    ],
    movements:[],demo:true,companyName:'Sua empresa piloto'
  };
  var state = readState();
  var view = 'dashboard', query = '', filter = 'all';
  var cloud = {status:'checking',displayName:'',company:null};
  var content = document.getElementById('content');
  var modalRoot = document.getElementById('modalRoot');
  var toastRoot = document.getElementById('toastRoot');
  function readState(){try{var s=JSON.parse(localStorage.getItem(KEY));if(s && Array.isArray(s.products)&&Array.isArray(s.clients)&&Array.isArray(s.services)){s.movements=s.movements||[];return s;}}catch(e){}return JSON.parse(JSON.stringify(initial));}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){toast('Não foi possível salvar no navegador. Verifique o armazenamento.','error');}}
  function h(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function ico(name){return '<svg aria-hidden="true"><use href="#i-'+name+'"></use></svg>';}
  function money(n){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);}
  function num(n){return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(n)||0);}
  function dateStr(d){return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(d));}
  function id(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():'jvg-'+Date.now()+'-'+Math.floor(Math.random()*100000);}
  function badge(active){return '<span class="badge '+(active?'green':'gray')+'">'+(active?'Ativo':'Inativo')+'</span>';}
  function btn(text,action,primary){return '<button class="btn '+(primary?'primary':'')+'" data-action="'+h(action)+'">'+(primary?ico('plus'):'')+h(text)+'</button>';}
  function heading(title,subtitle,action,actionText){return '<div class="page-heading"><div><div class="eyebrow">JVG NOTA FISCAL / ETAPA 3</div><h1>'+h(title)+'</h1><p>'+h(subtitle)+'</p></div>'+(action?'<div class="heading-actions">'+btn(actionText,action,true)+'</div>':'')+'</div>';}
  function banner(){
    var ready=cloud.status==='ready',needs=cloud.status==='needs_company',pending=cloud.status==='waiting_secret',login=cloud.status==='login_required';
    var title=ready?'Supabase conectado · '+h(state.companyName):needs?'Cadastro da empresa piloto pendente':pending?'Integração segura preparada · chave privada pendente':login?'Login necessário no site publicado':cloud.status==='error'?'Servidor temporariamente indisponível':'Verificando integração do Supabase';
    var detail=ready?'Os cadastros desta empresa são salvos no servidor. A emissão de notas continua bloqueada até a homologação fiscal.':needs?'Sua conta já está identificada. Cadastre o nome da empresa para criar o ambiente isolado no banco.':pending?'A estrutura do banco existe. Falta configurar JVG_SUPABASE_SECRET_KEY somente nos segredos do servidor. Até lá, estes registros continuam sendo uma demonstração local.':login?'O painel de pré-visualização não fornece a identidade autenticada. Abra o site privado publicado com sua conta para utilizar a integração.':cloud.status==='error'?'A conexão não pôde ser validada. Seus dados locais não foram enviados ao servidor.':'Aguarde a verificação. Os dados fictícios continuam disponíveis no navegador.';
    var action=needs?'<div class="heading-actions" style="margin-top:10px"><button class="btn primary" data-action="configure-company">'+ico('plus')+' Cadastrar empresa</button></div>':pending?'<div class="heading-actions" style="margin-top:10px"><button class="btn" data-view="settings">Ver configuração</button></div>':'';
    return '<div class="banner" style="border-color:'+(ready?'#76bb9c':'#d5deea')+'"><span class="banner-icon">'+ico('shield')+'</span><div class="banner-text"><strong>'+title+'</strong><p>'+detail+'</p>'+action+'</div></div>';
  }
  function stat(label,value,icon,color,foot){return '<article class="stat-card"><div class="stat-top"><span>'+h(label)+'</span><div class="stat-icon '+(color||'')+'">'+ico(icon)+'</div></div><div class="stat-value">'+h(value)+'</div><div class="stat-foot">'+h(foot)+'</div></article>';}
  function tableShell(searchPlaceholder,body,count,type){return '<section class="table-panel"><div class="table-toolbar"><label class="toolbar-search">'+ico('search')+'<input data-search-input placeholder="'+h(searchPlaceholder)+'" value="'+h(query)+'" aria-label="Filtrar registros"></label><div class="toolbar-controls"><select class="filter-select" data-filter aria-label="Filtrar situação"><option value="all" '+(filter==='all'?'selected':'')+'>Todos os status</option><option value="active" '+(filter==='active'?'selected':'')+'>Ativos</option><option value="inactive" '+(filter==='inactive'?'selected':'')+'>Inativos</option></select><button class="btn ghost" data-action="export-'+type+'">'+ico('download')+' Exportar CSV</button></div></div>'+body+'<div class="table-summary"><span>'+count+' registro(s) exibido(s)</span><span>'+(cloud.status==='ready'?'Supabase · Empresa isolada':'Demonstração local · Não sincronizado')+'</span></div></section>';}
  function empty(icon,title,detail,action,actionText){return '<div class="empty-state"><div class="empty-icon">'+ico(icon)+'</div><h3>'+h(title)+'</h3><p>'+h(detail)+'</p>'+(action?btn(actionText,action,true):'')+'</div>';}
  function rowActions(kind,recordId){return '<div class="table-actions"><button class="icon-btn" title="Editar" data-action="edit-'+kind+'" data-id="'+h(recordId)+'">'+ico('edit')+'</button><button class="icon-btn" title="Excluir" data-action="remove-'+kind+'" data-id="'+h(recordId)+'">'+ico('trash')+'</button></div>';}
  function matches(row,keys){var hay=keys.map(function(k){return String(row[k]||'');}).join(' ').toLowerCase();return hay.indexOf(query.toLowerCase())!==-1 &&(filter==='all'||(filter==='active'?row.active:!row.active));}
  function dashboard(){
    var totalStock=state.products.reduce(function(s,p){return s+Number(p.stock||0);},0);
    var low=state.products.filter(function(p){return p.active&&Number(p.stock)<=10;}).length;
    var valuation=state.products.reduce(function(s,p){return s+Number(p.stock||0)*Number(p.cost||0);},0);
    var recent=[].concat(state.movements.map(function(m){return {title:'Estoque '+(m.delta>0?'adicionado: ':'reduzido: ')+(state.products.find(function(p){return p.id===m.productId;})||{}).name,at:m.at,icon:'warehouse'};})).sort(function(a,b){return new Date(b.at)-new Date(a.at);}).slice(0,4);
    var quick=[['Cadastrar produto','SKU, preço e dados fiscais','box','new-product'],['Novo cliente','Dados de contato','users','new-client'],['Novo serviço','Catálogo de prestação','layers','new-service'],['Ver estoque','Saldo por produto','warehouse','goto-inventory'],['Notas fiscais','Etapa de integração','receipt','goto-fiscal'],['Relatórios','Resumo do cadastro','chart','goto-reports']];
    var modules=[['Produtos','Cadastro e fiscal','box','products'],['Clientes','Relacionamento','users','clients'],['Estoque','Saldos e ajustes','warehouse','inventory'],['Notas fiscais','5 modelos previstos','receipt','fiscal'],['Serviços','NFS-e futuro','layers','services']];
    return heading('Bom dia! Vamos construir seu ERP.','Acompanhe a estrutura inicial da sua empresa em um único lugar.')+banner()+
      '<div class="stats-grid">'+stat('Produtos cadastrados',state.products.length,'box','','Itens no catálogo')+stat('Clientes cadastrados',state.clients.length,'users','blue','Pessoas e empresas')+stat('Unidades em estoque',num(totalStock),'warehouse','purple',low+' produto(s) com estoque baixo')+stat('Valor de custo em estoque',money(valuation),'cash','amber','Estimativa dos itens cadastrados')+'</div>'+
      '<div class="panel-grid"><section class="panel"><div class="panel-head"><div><h2>Acesso rápido</h2><p>Comece pelos cadastros essenciais do sistema</p></div></div><div class="panel-body"><div class="quick-grid">'+quick.map(function(x){return '<button class="quick-card" data-action="'+x[3]+'"><span class="quick-icon">'+ico(x[2])+'</span><strong>'+x[0]+'</strong><small>'+x[1]+'</small></button>';}).join('')+'</div></div></section>'+
      '<section class="panel"><div class="panel-head"><div><h2>Atividades recentes</h2><p>Movimentações desta demonstração</p></div><button data-view="inventory">Ver estoque</button></div><div class="panel-body"><div class="timeline">'+(recent.length?recent.map(function(x){return '<div class="timeline-row"><span class="timeline-dot">'+ico(x.icon)+'</span><div class="timeline-info"><strong>'+h(x.title)+'</strong><small>'+dateStr(x.at)+'</small></div></div>';}).join(''):'<div class="empty-mini">Nenhuma movimentação registrada ainda. Cadastre ou ajuste itens para começar.</div>')+'</div></div></section></div>'+
      '<div class="section-row"><h2 class="section-title">Módulos do sistema</h2><span class="small-note">Etapa 3 · Login e banco multiempresa</span></div><div class="module-grid">'+modules.map(function(x){return '<button class="module-card" data-view="'+x[3]+'">'+ico(x[2])+'<strong>'+x[0]+'</strong><small>'+x[1]+'</small></button>';}).join('')+'</div>';
  }
  function products(){
    var rows=state.products.filter(function(p){return matches(p,['sku','name','category','ncm','gtin']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Produto / Descrição</th><th>SKU</th><th>Categoria</th><th>NCM</th><th>Estoque</th><th>Preço venda</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td><strong>'+h(p.name)+'</strong><div class="subcell">'+h(p.unit)+' · '+h(p.gtin||'SEM GTIN')+'</div></td><td class="mono">'+h(p.sku)+'</td><td>'+h(p.category||'—')+'</td><td class="mono">'+h(p.ncm||'—')+'</td><td><strong>'+num(p.stock)+'</strong> '+(Number(p.stock)<=10?'<span class="badge amber">Baixo</span>':'')+'</td><td class="inline-price">'+money(p.price)+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('product',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('box','Nenhum produto encontrado','Cadastre um produto ou tente outra busca.','new-product','Novo produto');
    return heading('Cadastro de produtos','Organize SKU, descrição, preços, estoque e informações fiscais.','new-product','Novo produto')+banner()+tableShell('Buscar por nome, SKU ou NCM...',body,rows.length,'products');
  }
  function clients(){
    var rows=state.clients.filter(function(p){return matches(p,['name','document','email','city']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Tipo</th><th>CPF/CNPJ</th><th>Cidade / UF</th><th>E-mail</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td><strong>'+h(p.name)+'</strong></td><td><span class="badge blue">'+h(p.type)+'</span></td><td class="mono">'+h(p.document||'Não informado')+'</td><td>'+h(p.city||'—')+' / '+h(p.state||'—')+'</td><td>'+h(p.email||'—')+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('client',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('users','Nenhum cliente encontrado','Registre pessoas e empresas para usar nos próximos módulos.','new-client','Novo cliente');
    return heading('Clientes','Cadastro central de destinatários e tomadores de serviços.','new-client','Novo cliente')+banner()+tableShell('Buscar por nome, documento ou cidade...',body,rows.length,'clients');
  }
  function services(){
    var rows=state.services.filter(function(p){return matches(p,['code','name','description','lc116','nbs']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Código</th><th>LC 116</th><th>NBS</th><th>Valor</th><th>Status</th><th class="text-right">Ações</th></tr></thead><tbody>'+rows.map(function(p){return '<tr><td><strong>'+h(p.name)+'</strong><div class="subcell">'+h((p.description||'').slice(0,65))+'</div></td><td class="mono">'+h(p.code)+'</td><td class="mono">'+h(p.lc116||'A configurar')+'</td><td class="mono">'+h(p.nbs||'—')+'</td><td class="inline-price">'+money(p.price)+'</td><td>'+badge(p.active)+'</td><td>'+rowActions('service',p.id)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('layers','Nenhum serviço encontrado','Crie seus serviços para preparar a futura NFS-e.','new-service','Novo serviço');
    return heading('Cadastro de serviços','Organize sua prestação e prepare os códigos fiscais da NFS-e.','new-service','Novo serviço')+banner()+tableShell('Buscar serviço, código ou NBS...',body,rows.length,'services');
  }
  function inventory(){
    var rows=state.products.filter(function(p){return matches(p,['sku','name','category']);});
    var body=rows.length?'<div class="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th>Saldo</th><th>Custo un.</th><th>Valor de custo</th><th>Situação</th><th class="text-right">Ação</th></tr></thead><tbody>'+rows.map(function(p){var low=Number(p.stock)<=10;return '<tr><td><strong>'+h(p.name)+'</strong></td><td class="mono">'+h(p.sku)+'</td><td><strong>'+num(p.stock)+'</strong> '+h(p.unit)+'</td><td>'+money(p.cost)+'</td><td class="inline-price">'+money(Number(p.stock)*Number(p.cost))+'</td><td><span class="badge '+(low?'amber':'green')+'">'+(low?'Estoque baixo':'Disponível')+'</span></td><td><div class="table-actions"><button class="btn sm" data-action="adjust-stock" data-id="'+h(p.id)+'">Ajustar saldo</button></div></td></tr>';}).join('')+'</tbody></table></div>':empty('warehouse','Sem produtos em estoque','Cadastre produtos para fazer ajustes locais.','new-product','Cadastrar produto');
    return heading('Controle de estoque','Visualize saldos e registre ajustes demonstrativos.','new-product','Cadastrar produto')+banner()+tableShell('Buscar SKU ou descrição...',body,rows.length,'products');
  }
  function fiscal(){
    var models=[['NF-e','Modelo 55','Venda de mercadorias e operações fiscais','receipt'],['NFC-e','Modelo 65','Venda ao consumidor e frente de caixa','cash'],['NFS-e','Padrão Nacional','Prestação de serviços / DPS','layers'],['CT-e','Modelo 57','Conhecimento de transporte eletrônico','truck'],['MDF-e','Modelo 58','Manifesto eletrônico de documentos','warehouse']];
    return heading('Central de notas fiscais','Os cinco modelos já estão previstos na navegação do JVG.')+banner()+
      '<div class="fiscal-grid">'+models.map(function(x){return '<article class="fiscal-card"><div class="fiscal-card-top"><div class="fiscal-icon">'+ico(x[3])+'</div><span class="badge amber">Em preparação</span></div><h3>'+x[0]+' <span class="muted" style="font-weight:400;font-size:10px">'+x[1]+'</span></h3><p>'+x[2]+'. A transmissão real será habilitada após integração e homologação com a Focus NFe.</p><div class="fiscal-bottom"><span>Focus NFe: aguardando certificado A1</span><span>'+ico('clock')+'</span></div></article>';}).join('')+'</div>'+
      '<div class="section-row"><h2 class="section-title">Próximas configurações fiscais</h2></div><div class="setup-steps"><article class="setup-step"><span class="step-count">01 / DADOS</span><strong>Empresa e regime</strong><p>CNPJ real, inscrições, endereço, regime tributário e responsável fiscal.</p></article><article class="setup-step"><span class="step-count">02 / CERTIFICADO</span><strong>Certificado A1 e Focus</strong><p>Cadastro seguro do emitente, credenciais por ambiente e CSC quando aplicável.</p></article><article class="setup-step"><span class="step-count">03 / HOMOLOGAÇÃO</span><strong>Regras e testes</strong><p>Conferência com contador e autorização de casos reais em ambiente de homologação.</p></article></div>';
  }
  function simpleSoon(title,subtitle,icon,features){
    return heading(title,subtitle)+banner()+'<section class="panel wide-info"><div class="panel-body">'+empty(icon,'Módulo preparado para as próximas etapas','A navegação e a arquitetura deste módulo estão previstas. Ainda não há operação real nesta primeira versão.')+'<div class="info-list">'+features.map(function(x){return '<div class="info-row"><span>'+h(x[0])+'</span><strong>'+h(x[1])+'</strong></div>';}).join('')+'</div></div></section>';
  }
  function reports(){
    var stockValue=state.products.reduce(function(sum,p){return sum+Number(p.stock)*Number(p.cost);},0);
    var saleValue=state.products.reduce(function(sum,p){return sum+Number(p.stock)*Number(p.price);},0);
    return heading('Relatórios','Indicadores básicos dos seus cadastros locais.')+banner()+
      '<div class="stats-grid">'+stat('Itens de produto',state.products.length,'box','','Total cadastrado')+stat('Serviços cadastrados',state.services.length,'layers','blue','No catálogo')+stat('Custo do estoque',money(stockValue),'cash','amber','Valor estimado')+stat('Preço de estoque',money(saleValue),'chart','purple','Potencial de venda teórico')+'</div>'+
      '<section class="panel"><div class="panel-head"><div><h2>Exportar sua demonstração</h2><p>Planilhas CSV sem informação fiscal oficial</p></div></div><div class="panel-body"><div class="heading-actions"><button class="btn" data-action="export-products">'+ico('download')+' Produtos</button><button class="btn" data-action="export-clients">'+ico('download')+' Clientes</button><button class="btn" data-action="export-services">'+ico('download')+' Serviços</button></div><p class="small-note" style="margin-top:18px">Relatórios financeiros, fiscais e contábeis ficam para as etapas integradas ao servidor.</p></div></section>';
  }
  function settings(){
    var ready=cloud.status==='ready';
    var missing=ready&&cloud.company&&Array.isArray(cloud.company.fiscal_missing)?cloud.company.fiscal_missing:[];
    var items=[['Usuário identificado',cloud.displayName||'Aguardando verificação'],['Empresa',state.companyName||'Empresa piloto'],['Banco de dados',ready?'Supabase conectado':cloud.status==='needs_company'?'Aguardando cadastro da empresa':'Aguardando chave do servidor'],['Dados dos cadastros',ready?'Persistidos no Supabase':'Somente neste navegador'],['Regime da empresa piloto','Simples Nacional'],['Cadastro fiscal',ready?(missing.length?missing.length+' informação(ões) pendente(s)':'Dados preenchidos · revisão fiscal necessária'):'Aguardando empresa'],['Focus NFe','Homologação em preparação'],['Certificado A1','Validar no painel da Focus'],['Emissão oficial','Bloqueada até habilitação fiscal']];
    var action=ready?'<button class="btn primary" data-action="configure-company">'+ico('edit')+' Editar empresa</button>':cloud.status==='needs_company'?'<button class="btn primary" data-action="configure-company">'+ico('plus')+' Cadastrar empresa piloto</button>':'<button class="btn" data-action="check-connection">'+ico('check')+' Verificar conexão</button>';
    return heading('Configurações','Sua conta, empresa piloto e integração segura com a Focus.')+banner()+
      '<section class="panel wide-info"><div class="panel-head"><div><h2>Etapa 6 · Cadastro fiscal do emitente</h2><p>Dados da empresa para preparar a NF-e em homologação</p></div></div><div class="panel-body"><div class="info-list">'+items.map(function(x){return '<div class="info-row"><span>'+h(x[0])+'</span><strong>'+h(x[1])+'</strong></div>';}).join('')+'</div>'+
      (ready&&missing.length?'<p class="small-note" style="margin-top:16px">Preencha: '+missing.map(h).join(', ')+'.</p>':ready?'<p class="small-note" style="margin-top:16px">Dados preenchidos. Ainda é obrigatória a conferência com o contador e com a Focus antes de qualquer emissão.</p>':'')+
      '<div class="heading-actions" style="margin-top:24px">'+action+(ready?'<button class="btn" data-action="logout">Sair da conta</button>':'<button class="btn danger" data-action="reset-demo">Restaurar demonstração</button>')+'</div>'+
      '<p class="small-note" style="margin-top:16px">Tokens Focus e certificado A1 não são solicitados nesta página. A chave JVG_SUPABASE_SECRET_KEY precisa existir apenas nos segredos privados do servidor de hospedagem; nunca cole essa chave em um campo do site.</p></div></section>';
  }
  function render(){
    document.getElementById('breadcrumb').textContent=labels[view]||labels.dashboard;
    document.querySelectorAll('.nav-link').forEach(function(b){b.classList.toggle('active',b.dataset.view===view);});
    var views={dashboard:dashboard,products:products,clients:clients,services:services,fiscal:fiscal,inventory:inventory,reports:reports,settings:settings};
    if(view==='finance')content.innerHTML=simpleSoon('Financeiro','Contas, parcelas, caixa e conciliação futura.','cash',[['Contas a receber','Planejadas'],['Contas a pagar','Planejadas'],['Conciliação bancária','Planejada']]);
    else if(view==='transport')content.innerHTML=simpleSoon('Transporte','Cadastros e operações de CT-e e MDF-e em etapas futuras.','truck',[['Transportadoras e motoristas','Planejados'],['CT-e','Planejado'],['MDF-e','Planejado']]);
    else content.innerHTML=(views[view]||dashboard)();
    var search=document.getElementById('globalSearch');search.value=query;
  }
  function setView(next){if(!labels[next])return;view=next;query='';filter='all';document.getElementById('sidebar').classList.remove('open');document.getElementById('mobileBackdrop').classList.remove('active');render();window.scrollTo({top:0,behavior:'smooth'});}
  function field(name,label,value,extra,full,help){return '<div class="field '+(full?'full':'')+'"><label for="f-'+h(name)+'">'+h(label)+'</label><input id="f-'+h(name)+'" name="'+h(name)+'" value="'+h(value==null?'':value)+'" '+(extra||'')+'>'+(help?'<small>'+h(help)+'</small>':'')+'</div>';}
  function select(name,label,options,value){return '<div class="field"><label for="f-'+h(name)+'">'+h(label)+'</label><select id="f-'+h(name)+'" name="'+h(name)+'">'+options.map(function(o){return '<option value="'+h(o[0])+'" '+(String(value)===String(o[0])?'selected':'')+'>'+h(o[1])+'</option>';}).join('')+'</select></div>';}
  function productForm(p){return field('sku','Código interno (SKU) *',p.sku,'required maxlength="40"',false)+field('name','Descrição do produto *',p.name,'required maxlength="160"',false)+field('category','Categoria',p.category,'maxlength="80"',false)+select('unit','Unidade',[['UN','Unidade (UN)'],['KG','Quilograma (KG)'],['M','Metro (M)'],['L','Litro (L)'],['CX','Caixa (CX)'],['PAR','Par (PAR)'],['PCT','Pacote (PCT)']],p.unit||'UN')+field('ncm','NCM',p.ncm,'inputmode="numeric" maxlength="8" pattern="[0-9]{8}"',false,'8 dígitos; confira com seu contador.')+field('cest','CEST (quando aplicável)',p.cest,'maxlength="12"',false)+field('gtin','EAN / GTIN',p.gtin||'SEM GTIN','maxlength="14"',false,'Informe SEM GTIN quando não houver código.')+select('origin','Origem da mercadoria',[['0','0 · Nacional'],['1','1 · Estrangeira direta'],['2','2 · Estrangeira mercado interno'],['3','3 · Nacional > 40% importação'],['4','4 · Nacional processos básicos'],['5','5 · Nacional ≤ 40% importação'],['6','6 · Estrangeira sem similar'],['7','7 · Estrangeira mercado interno sem similar'],['8','8 · Nacional > 70% importação']],p.origin||'0')+field('cost','Preço de custo (R$)',p.cost,'type="number" min="0" step="0.01"',false)+field('price','Preço de venda (R$) *',p.price,'required type="number" min="0" step="0.01"',false)+field('stock','Saldo inicial/demonstrativo',p.stock,'type="number" min="0" step="0.001"',false)+select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false');}
  function clientForm(p){return field('name','Nome / razão social *',p.name,'required maxlength="160"',true)+select('type','Tipo',[['PJ','Pessoa jurídica'],['PF','Pessoa física'],['EXT','Estrangeiro']],p.type||'PJ')+field('document','CPF / CNPJ',p.document,'inputmode="numeric" maxlength="18"',false,'Dados usados apenas nesta demonstração local.')+field('email','E-mail',p.email,'type="email" maxlength="160"',false)+field('phone','Telefone / WhatsApp',p.phone,'maxlength="25"',false)+field('city','Cidade',p.city,'maxlength="90"',false)+field('state','UF',p.state,'maxlength="2"',false)+select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false');}
  function serviceForm(p){return field('code','Código do serviço *',p.code,'required maxlength="40"',false)+field('name','Descrição do serviço *',p.name,'required maxlength="160"',false)+field('description','Detalhamento',p.description,'maxlength="255"',true)+field('lc116','Subitem da LC 116',p.lc116,'maxlength="12"',false)+field('nbs','Código NBS',p.nbs,'maxlength="12"',false)+field('price','Valor (R$) *',p.price,'required type="number" min="0" step="0.01"',false)+select('active','Situação',[['true','Ativo'],['false','Inativo']],p.active!==false?'true':'false');}
  async function callApi(endpoint,options){
    var response=await fetch(endpoint,Object.assign({credentials:'same-origin',cache:'no-store'},options||{}));
    var result=await response.json().catch(function(){return {error:'Resposta inválida do servidor.'};});
    if(!response.ok)throw new Error(result.error||'A operação não pôde ser concluída.');
    return result;
  }
  async function refreshCloud(){
    var data=await callApi('/api/records');
    state={products:data.products||[],clients:data.clients||[],services:data.services||[],movements:data.movements||[],demo:false,companyName:data.companyName||'Empresa piloto'};
    render();
  }
  async function checkConnection(){
    try{
      var response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'}),status=await response.json();
      if(response.status===401&&status.status==='sign_in_required'){window.location.replace('/login');return;}
      if(!response.ok)throw new Error(status.error||'Erro de conexão.');
      if(status.status==='admin_ready'){window.location.replace('/admin');return;}
      cloud={status:status.status,displayName:status.displayName||'',company:status.company||null};
      if(cloud.status==='ready')await refreshCloud();
      else render();
    }catch(error){cloud.status='error';render();toast('Não foi possível verificar a conexão: '+error.message,'error');}
  }
  function companyFiscalFields(company){
    var a=company.address||{};
    return '<div class="field full"><strong>Identificação e contato fiscal</strong></div>'+
      field('tradeName','Nome fantasia',company.trade_name||'','maxlength="160"',false)+
      field('cnpj','CNPJ (numérico ou alfanumérico)',company.cnpj||'','maxlength="18" placeholder="00.000.000/0000-00"',false)+
      field('stateRegistration','Inscrição Estadual (IE)',company.state_registration||'','maxlength="40"',false)+
      field('municipalRegistration','Inscrição Municipal',company.municipal_registration||'','maxlength="40"',false)+
      field('cnae','CNAE principal (7 dígitos)',company.cnae||'','inputmode="numeric" maxlength="10"',false)+
      field('fiscalEmail','E-mail fiscal',company.fiscal_email||'','type="email" maxlength="254"',false)+
      field('fiscalPhone','Telefone com DDD',company.fiscal_phone||'','inputmode="tel" maxlength="24"',false)+
      '<div class="field full"><strong>Endereço fiscal da empresa</strong></div>'+
      field('street','Logradouro',a.street||'','maxlength="160"',true)+
      field('number','Número',a.number||'','maxlength="20"',false)+
      field('complement','Complemento',a.complement||'','maxlength="100"',false)+
      field('district','Bairro',a.district||'','maxlength="100"',false)+
      field('city','Município',a.city||'','maxlength="100"',false)+
      field('state','UF',a.state||'','maxlength="2" placeholder="SP"',false)+
      field('postalCode','CEP (8 dígitos)',a.postalCode||'','inputmode="numeric" maxlength="9"',false)+
      field('cityCode','Código IBGE do município (7 dígitos)',a.cityCode||'','inputmode="numeric" maxlength="7"',false)+
      '<div class="field full"><strong>Numeração planejada para NF-e de homologação</strong></div>'+
      field('nfeSeries','Série',company.nfe_series_homologacao==null?1:company.nfe_series_homologacao,'type="number" min="1" max="999"',false)+
      field('nfeNextNumber','Próximo número',company.nfe_next_number_homologacao==null?1:company.nfe_next_number_homologacao,'type="number" min="1" max="999999999"',false);
  }
  function openCompanyEditor(){
    if(!['needs_company','ready'].includes(cloud.status)){toast('Aguarde a configuração segura do servidor.','error');return;}
    var company=cloud.company||{},existing=cloud.status==='ready';
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">'+(existing?'Editar empresa piloto':'Cadastrar minha empresa piloto')+'</h2><p>Seus dados serão vinculados somente à sua conta.</p></div><button class="icon-btn" type="button" data-action="close-modal">'+ico('x')+'</button></div><form id="companyForm"><div class="modal-body"><div class="form-grid">'+
      field('legalName','Razão social ou nome da empresa *',company.legal_name||'','required maxlength="160"',true)+
      (existing?companyFiscalFields(company):'')+
      '</div><p class="small-note" style="margin-top:16px">Regime piloto: Simples Nacional. Salvar este cadastro não transmite NF-e. Confira os dados com seu contador e a numeração com a Focus.</p></div><div class="modal-footer"><small>* Obrigatório</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar empresa</button></div></div></form></div></div>';
    // O formulario permanece aberto ao clicar no fundo: somente os botoes
    // Fechar/Cancelar ou a conclusao do cadastro podem dispensa-lo.
    modalRoot.querySelector('[name]').focus();
  }
  async function saveCompany(form){
    var values=Object.fromEntries(new FormData(form).entries()),existing=cloud.status==='ready';
    var button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{
      var result=await callApi('/api/company',{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
      cloud.status='ready';cloud.company=result.company;closeModal();await checkConnection();toast('Empresa piloto salva no Supabase.');
    }catch(error){toast(error.message,'error');if(button)button.disabled=false;}
  }
  function openEditor(kind,recordId){
    if(cloud.status==='checking'){toast('Aguarde a verificação da conexão.','error');return;}
    if(cloud.status==='needs_company'){openCompanyEditor();return;}
    var list=state[kind+'s'];if(!list)return;
    var current=recordId?list.find(function(x){return x.id===recordId;}):null;
    var p=current||{},titles={product:'produto',client:'cliente',service:'serviço'},body=kind==='product'?productForm(p):kind==='client'?clientForm(p):serviceForm(p);
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">'+(current?'Editar ':'Cadastrar novo ')+titles[kind]+'</h2><p>'+(cloud.status==='ready'?'Cadastro salvo na sua empresa no Supabase.':'Dados de teste armazenados somente neste navegador.')+'</p></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="Fechar">'+ico('x')+'</button></div><form id="recordForm" data-kind="'+kind+'" data-id="'+h(recordId||'')+'"><div class="modal-body"><div class="form-grid">'+body+'</div></div><div class="modal-footer"><small>* Campos obrigatórios</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">'+ico('check')+' Salvar cadastro</button></div></div></form></div></div>';
    if(kind==='product'&&current&&cloud.status==='ready'){
      var stockField=modalRoot.querySelector('[name="stock"]');
      if(stockField){stockField.readOnly=true;stockField.title='Use Ajustar saldo no módulo Estoque';}
    }
    // Evita fechamento acidental ao arrastar o mouse para selecionar texto
    // ou escolher opcoes dos campos de cadastro.
    var first=modalRoot.querySelector('[name]');if(first)first.focus();
  }
  function closeModal(){modalRoot.innerHTML='';}
  function toast(msg,kind){var el=document.createElement('div');el.className='toast '+(kind||'');el.innerHTML=ico(kind==='error'?'x':'check')+'<span>'+h(msg)+'</span>';toastRoot.appendChild(el);setTimeout(function(){el.remove();},3800);}
  async function saveRecord(form){
    var kind=form.dataset.kind,recordId=form.dataset.id,values=Object.fromEntries(new FormData(form).entries()),list=state[kind+'s'];
    if(!list)return;
    var code=kind==='product'?values.sku:kind==='service'?values.code:null;
    if(code&&list.some(function(x){return x.id!==recordId&&(kind==='product'?x.sku:x.code).trim().toUpperCase()===code.trim().toUpperCase();})){toast('Já existe um cadastro com este código.','error');return;}
    var record={id:recordId||id()};
    if(kind==='product'){
      if(values.ncm&&!/^\d{8}$/.test(values.ncm)){toast('NCM deve conter 8 dígitos.','error');return;}
      if(values.gtin && values.gtin!=='SEM GTIN' && !/^\d{8}$|^\d{12,14}$/.test(values.gtin)){toast('GTIN deve conter 8, 12, 13 ou 14 dígitos ou SEM GTIN.','error');return;}
      record=Object.assign(record,{sku:values.sku.trim(),name:values.name.trim(),category:values.category.trim(),unit:values.unit,ncm:values.ncm,cest:values.cest,gtin:values.gtin||'SEM GTIN',origin:values.origin,cost:Number(values.cost||0),price:Number(values.price||0),stock:Number(values.stock||0),active:values.active==='true'});
      if(record.price<0||record.cost<0||record.stock<0){toast('Valores não podem ser negativos.','error');return;}
    }else if(kind==='client'){
      var doc=values.document.replace(/\D/g,'');
      if(doc&&![11,14].includes(doc.length)){toast('CPF/CNPJ deve ter 11 ou 14 dígitos.','error');return;}
      record=Object.assign(record,{name:values.name.trim(),type:values.type,document:doc,email:values.email.trim(),phone:values.phone.trim(),city:values.city.trim(),state:values.state.trim().toUpperCase(),active:values.active==='true'});
    }else{
      record=Object.assign(record,{code:values.code.trim(),name:values.name.trim(),description:values.description.trim(),lc116:values.lc116.trim(),nbs:values.nbs.trim(),price:Number(values.price||0),active:values.active==='true'});
      if(record.price<0){toast('Valor inválido.','error');return;}
    }
    if(cloud.status==='ready'){
      var submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
      try{
        var saved=await callApi('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind,id:recordId||null,record:record})});
        if(kind==='product'&&!recordId&&record.stock>0){
          try{await callApi('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:saved.id,delta:record.stock,reason:'Saldo inicial do cadastro'})});}
          catch(stockError){toast('Produto salvo, mas ajuste inicial pendente: '+stockError.message,'error');}
        }
        closeModal();await refreshCloud();toast('Cadastro salvo no Supabase.');
      }catch(error){toast(error.message,'error');if(submit)submit.disabled=false;}
      return;
    }
    var oldIndex=list.findIndex(function(x){return x.id===recordId;});
    if(oldIndex>=0)list[oldIndex]=record;else list.unshift(record);
    persist();closeModal();render();toast((oldIndex>=0?'Cadastro atualizado':'Cadastro adicionado')+' com sucesso.');
  }
  async function removeRecord(kind,recordId){
    var list=state[kind+'s'],p=list&&list.find(function(x){return x.id===recordId;});if(!p)return;
    var name=p.name||p.sku||p.code;
    if(cloud.status==='ready'){
      if(!confirm('Inativar "'+name+'" no Supabase? O registro será preservado para auditoria.'))return;
      try{await callApi('/api/records',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:kind,id:recordId})});await refreshCloud();toast('Cadastro inativado no banco.');}
      catch(error){toast(error.message,'error');}
      return;
    }
    if(!confirm('Excluir "'+name+'" dos dados de teste deste navegador?\nEssa ação não poderá ser desfeita.'))return;
    state[kind+'s']=list.filter(function(x){return x.id!==recordId;});
    persist();render();toast('Cadastro removido da demonstração.');
  }
  function adjustStock(recordId){
    var p=state.products.find(function(x){return x.id===recordId;});if(!p)return;
    modalRoot.innerHTML='<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><h2 id="modalTitle">Ajustar estoque</h2><p>'+h(p.name)+' · Saldo atual: '+num(p.stock)+' '+h(p.unit)+'</p></div><button class="icon-btn" type="button" data-action="close-modal">'+ico('x')+'</button></div><form id="stockForm" data-id="'+h(recordId)+'"><div class="modal-body"><div class="form-grid"><div class="field"><label for="stockDelta">Quantidade de ajuste *</label><input id="stockDelta" name="delta" type="number" step="0.001" required placeholder="Ex.: 10 ou -2"><small>Positivo = entrada. Negativo = saída.</small></div><div class="field"><label for="stockReason">Motivo *</label><input id="stockReason" name="reason" maxlength="120" required placeholder="Ex.: Inventário de teste"></div></div><p class="small-note">Controle demonstrativo, sem depósito ou livro contábil oficial nesta etapa.</p></div><div class="modal-footer"><small>O saldo não poderá ficar negativo.</small><div class="modal-footer-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Confirmar ajuste</button></div></div></form></div></div>';
    // A janela de ajuste nao fecha ao tocar fora dela.
    document.getElementById('stockDelta').focus();
  }
  async function saveStock(form){
    var p=state.products.find(function(x){return x.id===form.dataset.id;});if(!p)return;
    var data=Object.fromEntries(new FormData(form).entries()),delta=Number(data.delta);
    if(!Number.isFinite(delta)||delta===0){toast('Informe uma quantidade diferente de zero.','error');return;}
    if(Number(p.stock)+delta<0){toast('O saldo não pode ficar negativo.','error');return;}
    if(cloud.status==='ready'){
      try{await callApi('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:p.id,delta:delta,reason:data.reason})});closeModal();await refreshCloud();toast('Estoque atualizado no Supabase.');}
      catch(error){toast(error.message,'error');}
      return;
    }
    p.stock=Math.round((Number(p.stock)+delta)*1000)/1000;state.movements.unshift({id:id(),productId:p.id,delta:delta,reason:data.reason,at:new Date().toISOString()});
    persist();closeModal();render();toast('Estoque demonstrativo ajustado.');
  }
  function exportCsv(kind){
    var data=state[kind],fields=kind==='products'?['sku','name','category','unit','ncm','cest','gtin','origin','cost','price','stock','active']:kind==='clients'?['name','type','document','email','phone','city','state','active']:['code','name','description','lc116','nbs','price','active'];
    if(!Array.isArray(data)||!data.length){toast('Não há dados para exportar.','error');return;}
    var lines=[fields.join(';')].concat(data.map(function(r){return fields.map(function(f){return '"'+String(r[f]??'').replace(/"/g,'""')+'"';}).join(';');}));
    var blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='JVG_'+kind+'_demonstracao.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},300);toast('CSV de demonstração exportado.');
  }
  document.addEventListener('click',function(e){
    var v=e.target.closest('[data-view]');if(v){setView(v.dataset.view);return;}
    var b=e.target.closest('[data-action]');if(!b)return;var a=b.dataset.action,recordId=b.dataset.id;
    if(a==='close-modal'){closeModal();return;}
    if(a==='configure-company'){openCompanyEditor();return;}
    if(a==='check-connection'){checkConnection();return;}
    if(a==='logout'){window.location.assign('/logout');return;}
    if(a.indexOf('new-')===0){openEditor(a.substring(4));return;}
    if(a.indexOf('edit-')===0){openEditor(a.substring(5),recordId);return;}
    if(a.indexOf('remove-')===0){removeRecord(a.substring(7),recordId);return;}
    if(a.indexOf('export-')===0){exportCsv(a.substring(7));return;}
    if(a==='adjust-stock'){adjustStock(recordId);return;}
    if(a.indexOf('goto-')===0){setView(a.substring(5));return;}
    if(a==='reset-demo' && cloud.status!=='ready'){
      if(confirm('Restaurar os dados fictícios originais? Todos os seus cadastros locais desta demonstração serão substituídos.')){state=JSON.parse(JSON.stringify(initial));persist();render();toast('Demonstração restaurada.');}
    }
  });
  document.addEventListener('submit',function(e){if(e.target.id==='recordForm'){e.preventDefault();saveRecord(e.target);}if(e.target.id==='stockForm'){e.preventDefault();saveStock(e.target);}if(e.target.id==='companyForm'){e.preventDefault();saveCompany(e.target);}});
  document.addEventListener('input',function(e){
    if(e.target.id==='globalSearch'){query=e.target.value;if(view==='dashboard')setView('products');else render();return;}
    if(e.target.hasAttribute('data-search-input')){query=e.target.value;var pos=e.target.selectionStart;render();var next=document.querySelector('[data-search-input]');if(next){next.focus();next.setSelectionRange(pos,pos);}}
  });
  document.addEventListener('change',function(e){if(e.target.hasAttribute('data-filter')){filter=e.target.value;render();}});
  document.getElementById('menuBtn').addEventListener('click',function(){document.getElementById('sidebar').classList.add('open');document.getElementById('mobileBackdrop').classList.add('active');});
  document.getElementById('mobileBackdrop').addEventListener('click',function(){document.getElementById('sidebar').classList.remove('open');document.getElementById('mobileBackdrop').classList.remove('active');});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();document.getElementById('globalSearch').focus();}});
  render();
  checkConnection();
})();
