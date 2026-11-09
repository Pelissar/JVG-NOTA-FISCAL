/* Destaque da área ativa e atalhos de navegação; sem alterar regras de negócio. */
(function(){
 'use strict';
 const path=window.location.pathname.replace(/\/$/,'/index.html');
 const active=document.querySelectorAll('.sidebar a.nav-link');
 active.forEach(function(link){
  const target=new URL(link.getAttribute('href'),window.location.origin);
  if(target.pathname===path){
   link.classList.add('active');
   link.setAttribute('aria-current','page');
   const group=link.closest('details.nav-group');
   if(group)group.open=true;
  }
 });
 const menu=document.getElementById('sidebarNavigation');
 if(menu){
  menu.addEventListener('keydown',function(event){
   if(event.key!=='Home'&&event.key!=='End')return;
   const links=[...menu.querySelectorAll('a.nav-link,button.nav-link,summary')].filter(el=>el.getClientRects().length);
   if(!links.length)return;
   event.preventDefault();
   links[event.key==='Home'?0:links.length-1].focus();
  });
 }
})();
