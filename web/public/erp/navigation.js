/* Destaque da área ativa e fechamento automático dos menus da navegação. */
(function(){
 'use strict';
 const path=window.location.pathname.replace(/\/$/,'/index.html');
 const active=document.querySelectorAll('.sidebar a.nav-link');
 active.forEach(function(link){
  const target=new URL(link.getAttribute('href'),window.location.origin);
  if(target.pathname===path){
   link.classList.add('active');
   link.setAttribute('aria-current','page');
  }
 });
 const menu=document.getElementById('sidebarNavigation');
 const workspaceMenu=document.getElementById('workspaceMenu');
 if(menu){
  const groups=[...menu.querySelectorAll('details.nav-group')];
  function closeGroups(except){groups.forEach(function(group){if(group!==except)group.open=false;});}
  groups.forEach(function(group){
   group.addEventListener('toggle',function(){if(group.open){closeGroups(group);if(workspaceMenu)workspaceMenu.open=false;}});
  });
  menu.addEventListener('click',function(event){if(event.target.closest('.nav-link'))closeGroups();});
  document.addEventListener('click',function(event){if(!menu.contains(event.target))closeGroups();});
  document.addEventListener('keydown',function(event){
   if(event.key!=='Escape')return;
   const opened=groups.find(function(group){return group.open;});
   closeGroups();
   if(opened)opened.querySelector('summary')?.focus();
  });
  menu.addEventListener('keydown',function(event){
   if(event.key!=='Home'&&event.key!=='End')return;
   const links=[...menu.querySelectorAll('a.nav-link,button.nav-link,summary')].filter(el=>el.getClientRects().length);
   if(!links.length)return;
   event.preventDefault();
   links[event.key==='Home'?0:links.length-1].focus();
  });
 }
 if(workspaceMenu){
  workspaceMenu.addEventListener('toggle',function(){if(workspaceMenu.open&&menu)closeGroups();});
  workspaceMenu.addEventListener('click',function(event){if(event.target.closest('a,button'))workspaceMenu.open=false;});
  document.addEventListener('click',function(event){if(!workspaceMenu.contains(event.target))workspaceMenu.open=false;});
  document.addEventListener('keydown',function(event){
   if(event.key!=='Escape'||!workspaceMenu.open)return;
   workspaceMenu.open=false;
   workspaceMenu.querySelector('summary')?.focus();
  });
 }
})();