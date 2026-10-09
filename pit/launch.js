(() => {
  'use strict';
  const retry=document.getElementById('boot-retry');
  const screen=document.querySelector('.boot-screen');
  const note=document.getElementById('boot-note');
  retry?.addEventListener('click',()=>location.reload());
  const slow=setTimeout(()=>{if(note)note.textContent='Сервис отвечает дольше обычного. Можно подождать или повторить.';if(retry)retry.hidden=false;},10000);
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  (async()=>{try{
    const response=await fetch('/api/entry',{credentials:'same-origin',signal:controller.signal});
    if(!response.ok)throw Error('unavailable');
    const data=await response.json();
    if(!/^\/app\/[a-z0-9-]+$/.test(data.path||''))throw Error('invalid entry');
    const go=()=>location.replace(data.path);
    const dialog=document.getElementById('install-dialog');
    if(document.documentElement.hasAttribute('data-install-prompt'))addEventListener('pit-install-finished',go,{once:true});
    else if(dialog?.open)dialog.addEventListener('close',go,{once:true});
    else go();
  }catch{
    screen?.classList.add('boot-error');screen?.setAttribute('aria-busy','false');
    const title=screen?.querySelector('.boot-status strong');if(title)title.textContent='Пока не удалось подключиться';
    if(note)note.textContent=navigator.onLine?'Проверьте соединение и повторите попытку. Если ошибка остаётся, свяжитесь с вашим СТО.':'Нет интернета. Подключитесь к сети и повторите попытку.';
    if(retry)retry.hidden=false;
  }finally{clearTimeout(slow);clearTimeout(timeout);}})();
})();
