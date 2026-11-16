(function(){'use strict';
var tabs=Array.from(document.querySelectorAll('[data-fiscal-tab]'));
var sections=Array.from(document.querySelectorAll('[data-fiscal-section]'));
var ids=tabs.map(function(b){return b.dataset.fiscalTab;});
var controls=document.createElement('div');controls.className='fiscal-step-actions';
controls.innerHTML='<button type="button" class="fiscal-step-prev">← Anterior (F4)</button><span class="fiscal-step-progress" aria-live="polite"></span><button type="button" class="fiscal-step-next">Próximo (F5) →</button>';
var footer=document.querySelector('#draftForm .form-footer');if(footer)footer.parentNode.insertBefore(controls,footer);
var prev=controls.querySelector('.fiscal-step-prev'),next=controls.querySelector('.fiscal-step-next'),progress=controls.querySelector('.fiscal-step-progress');
function activeIndex(){return tabs.findIndex(function(b){return b.getAttribute('aria-selected')==='true';});}
function activate(id,focus){var i=ids.indexOf(id);if(i<0)return;
tabs.forEach(function(b,j){var selected=i===j;b.classList.toggle('selected',selected);b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
sections.forEach(function(s){s.hidden=s.dataset.fiscalSection!==id;});
prev.disabled=i===0;next.disabled=i===ids.length-1;progress.textContent='Etapa '+(i+1)+' de '+ids.length;
if(focus)tabs[i].focus();}
function move(delta){
 if(delta>0&&typeof window.jvgNfeWizardAdvance==='function'){window.jvgNfeWizardAdvance();return;}
 if(delta<0&&typeof window.jvgNfeWizardBack==='function'){window.jvgNfeWizardBack();return;}
 var i=activeIndex();activate(ids[Math.max(0,Math.min(ids.length-1,i+delta))],true);
}
function refreshNav(){
 if(typeof window.jvgNfeWizardCanAdvance!=='function')return;
 var last=window.jvgNfeWizardIsLast();
 var ready=window.jvgNfeWizardCanAdvance();
 next.disabled=last||!ready;
 next.title=last?'Última etapa':ready?'Avançar para a próxima etapa':'Preencha os campos obrigatórios desta etapa para continuar.';
 prev.disabled=activeIndex()<=0;
}
window.jvgNfeRefreshStepNav=refreshNav;
tabs.forEach(function(b,index){b.addEventListener('click',function(){
 if(typeof window.jvgNfeWizardGoTo==='function'){window.jvgNfeWizardGoTo(index);return;}
 activate(b.dataset.fiscalTab,false);
});b.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();move(e.key==='ArrowRight'?1:-1);}if(e.key==='Home'||e.key==='End'){e.preventDefault();if(typeof window.jvgNfeWizardGoTo==='function')window.jvgNfeWizardGoTo(e.key==='Home'?0:ids.length-1);else activate(ids[e.key==='Home'?0:ids.length-1],true);}});});
prev.addEventListener('click',function(){move(-1);});next.addEventListener('click',function(){if(next.disabled)return;move(1);});
document.addEventListener('keydown',function(e){if(window.jvgNfeWizardAdvance)return;if(e.altKey||e.ctrlKey||e.metaKey||e.repeat)return;if(e.key==='F4'||e.key==='F5'){e.preventDefault();move(e.key==='F4'?-1:1);}});
document.getElementById('draftForm')?.addEventListener('input',refreshNav);
document.getElementById('draftForm')?.addEventListener('change',refreshNav);
document.getElementById('draftForm')?.addEventListener('invalid',function(e){var section=e.target.closest('[data-fiscal-section]');if(section&&typeof window.jvgNfeWizardGoTo!=='function')activate(section.dataset.fiscalSection,false);},true);
if(typeof window.jvgNfeWizardGoTo==='function')refreshNav();else activate('general',false);
})();
