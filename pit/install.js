(() => {
  'use strict';
  let deferred = null, pending = false, installedHere = false;
  const standalone = matchMedia('(display-mode: standalone)');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  const banner = document.getElementById('install-banner');
  const inApp = () => standalone.matches || navigator.standalone === true || installedHere;
  function update() {if (banner) banner.hidden = inApp();}
  // The app starts in this STO, not whichever tenant happens to be first.
  const slug = location.pathname.split('/')[2];
  if (/^[a-z0-9-]+$/.test(slug || '') && location.pathname.startsWith('/app/')) {
    const manifest = document.querySelector('link[rel="manifest"]');
    if (manifest) manifest.href = '/api/t/' + encodeURIComponent(slug) + '/manifest.webmanifest';
  }
  window.addEventListener('beforeinstallprompt', event => {event.preventDefault();deferred=event;update();});
  window.addEventListener('appinstalled', () => {installedHere=true;deferred=null;update();document.getElementById('install-dialog')?.close();});
  standalone.addEventListener('change', update);
  function guide() {
    document.getElementById('install-dialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='install-dialog';dialog.className='install-dialog';
    dialog.setAttribute('aria-labelledby','install-title');
    const title=isIOS?'Добавить ПИТ на iPhone / iPad':'Добавить ПИТ на экран';
    const steps=isIOS ? (isIOSSafari ? ['Нажмите «Поделиться» в Safari — значок квадрата со стрелкой вверх.','Прокрутите меню и выберите «На экран “Домой”».','Подтвердите название и нажмите «Добавить».'] : ['Откройте эту страницу в Safari. При необходимости скопируйте ссылку ниже.','Нажмите «Поделиться» → «На экран “Домой”».','Нажмите «Добавить».']) : ['Откройте меню браузера — кнопка с тремя точками справа сверху.','Выберите «Установить приложение» или «Добавить на главный экран».','Подтвердите действие. Если такого пункта нет, откройте сайт в Chrome или Edge, а не во встроенном браузере мессенджера.'];
    dialog.innerHTML='<h2 id="install-title">'+title+'</h2><p>Открывайте свой автосервис прямо с рабочего экрана.</p><ol>'+steps.map(s=>'<li>'+s+'</li>').join('')+'</ol><small>Если приложение уже добавлено, открывайте его через иконку ПИТ. Название пунктов может отличаться в разных версиях браузера.</small><div class="button-row"><button class="secondary" type="button" id="copy-install-link">Скопировать ссылку</button><button class="primary" type="button" id="close-install">Понятно</button></div><p id="install-status" class="install-status" role="status"></p>';
    document.body.append(dialog);
    dialog.querySelector('#close-install').addEventListener('click',()=>dialog.close());
    dialog.querySelector('#copy-install-link').addEventListener('click',async()=>{
      const status=dialog.querySelector('#install-status');
      try {await navigator.clipboard.writeText(location.origin+location.pathname);status.textContent='Ссылка скопирована. Откройте её в нужном браузере.';}
      catch {status.textContent='Скопируйте адрес из адресной строки браузера.';}
    });
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    dialog.showModal();
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-install]');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(pending)return;
    if(inApp())return update();
    if(!deferred)return guide();
    const prompt=deferred;deferred=null;pending=true;button.disabled=true;document.documentElement.setAttribute('data-install-prompt','');
    try {
      await prompt.prompt();
      const result=await prompt.userChoice;
      if(result.outcome==='accepted') {const label=button.querySelector('small');if(label)label.textContent='Установка запущена — подтвердите действие браузера';}
    } catch {guide();}
    finally {pending=false;button.disabled=false;document.documentElement.removeAttribute('data-install-prompt');dispatchEvent(new Event('pit-install-finished'));update();}
  },true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/assets/sw.js',{scope:'/'}).catch(()=>{});
  update();
})();
