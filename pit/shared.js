'use strict';
const E=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const STO=location.pathname.split('/')[2];
async function api(route,method='GET',data){const r=await fetch('/api/t/'+STO+'/'+route,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});const b=await r.json();if(!r.ok){const err=new Error(b.error||'Ошибка сервера');err.status=r.status;throw err;}return b;}
const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n);
const time=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const minutes=s=>Number(s.split(':')[0])*60+Number(s.split(':')[1]);
const dateStr=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'short'});
const statusLabel={booked:'Записан',working:'В работе',completed:'Готово',cancelled:'Отменён',waitlist:'Лист ожидания'};
const formValues=f=>Object.fromEntries(new FormData(f));
function toast(message,error=false){const el=document.getElementById('toast');el.textContent=message;el.className='toast show'+(error?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='toast',6500);}
function saveFile(filename,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function calendar(b,c){const stamp=(date,min)=>date.replaceAll('-','')+'T'+time(min).replace(':','')+'00';const safe=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');saveFile('pit-visit.ics',['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PIT//Visits//RU','BEGIN:VEVENT','UID:'+b.id+'@pit','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z','DTSTART:'+stamp(b.date,b.start),'DTEND:'+stamp(b.date,b.start+b.duration),'SUMMARY:'+safe(c.name+': '+b.data.items.map(i=>i.n).join(', ')),'LOCATION:'+safe(c.addr),'END:VEVENT','END:VCALENDAR',''].join('\r\n'),'text/calendar');}
async function shareText(text,url){if(navigator.share){try{await navigator.share({text,url});return;}catch(e){if(e.name==='AbortError')return;}}try{await navigator.clipboard.writeText(text+' '+url);toast('Ссылка скопирована');}catch{window.prompt('Скопируйте ссылку',text+' '+url);}}
const routeMap=c=>'https://yandex.ru/maps/?text='+encodeURIComponent(c.addr);
const field=(label,name,value='',type='text',extra='')=>`<label class="field"><span>${E(label)}</span><input name="${E(name)}" type="${E(type)}" value="${E(value)}" ${extra}></label>`;
const picture=(v,cls='')=>v.image?`<img class="${cls}" src="/assets/${E(v.image)}" alt="${E(v.brand+' '+v.model)}">`:`<div class="car-text ${cls}"><span>${E(v.brand)}</span><strong>${E(v.model)}</strong></div>`;
const empty=(title,body='')=>`<div class="empty"><h3>${E(title)}</h3><p>${E(body)}</p></div>`;
function loginHTML(admin=false,register=false){return `<div class="login card"><div class="eyebrow">ПИТ / ${E(STO)}</div><h1>${register?'Создать аккаунт':admin?'Вход владельца':'Добро пожаловать'}</h1><p class="muted">${admin?'Управление сервисом с компьютера':'Запись, автомобиль и связь с мастером'}</p><form id="auth-form" data-register="${register}">${register?field('Имя','name','','text','required maxlength="80"'):''}${field('Email','email','','email','required autocomplete="username"')}${field('Пароль','password','','password','required minlength="10" maxlength="128" autocomplete="'+(register?'new-password':'current-password')+'"')}${register?field('Телефон','phone','','tel'):''}<button class="primary" type="submit">${register?'Зарегистрироваться':'Войти'}</button><p id="form-error" class="error-text" role="alert"></p></form>${!admin?`<button class="link" data-action="${register?'login':'register'}">${register?'Уже есть аккаунт':'Создать аккаунт клиента'}</button>`:''}<small>Телефон — контактный, без фиктивного статуса «подтверждён».</small></div>`;}
async function photoData(file){if(!file)return null;if(file.size>3*1024*1024)throw Error('Фото не больше 3 МБ');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Выберите JPEG, PNG или WebP');return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}

async function downloadOrderPDF(id){const r=await fetch('/api/t/'+encodeURIComponent(STO)+'/documents/'+encodeURIComponent(id),{credentials:'same-origin'});if(!r.ok){let message='Не удалось сформировать PDF';try{message=(await r.json()).error||message;}catch{}throw Error(message);}const blob=await r.blob();if(!r.headers.get('content-type')?.includes('application/pdf'))throw Error('Сервер не вернул PDF');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='pit-order-'+String(id).replace(/[^a-zA-Z0-9-]/g,'')+'.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('PDF заказ-наряда готов');}

// Small vector UI icons, with real labels on their buttons.
const UI_GLYPHS={
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
 home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
 visits:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-11 5h6"/>',
 garage:'<path d="m3 10 9-7 9 7v11H3zM6 21v-9h12v9M6 16h12"/>',
 shop:'<path d="M4 10V5h16v5M3 10h18v11H3zM8 5V3h8v2M9 15h6m-3-3v6"/>',
 to:'<path d="M8 4h8l1 4 3 3v10H4V11l3-3zM8 4V2m2 0h4M9 13h6m-3-3v6"/>',
 diag:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m6 12 3-4 3 7 3-5 3 2M8 21h8m-4-3v3"/>',
 brakes:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v2m8 6h-2m-6 8v-2m-8-6h2"/>',
 susp:'<path d="M9 2h6M12 2v4m-4 0 8 3-8 3 8 3-8 3h8M12 18v4m-3 0h6"/>',
 tire:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 8-3 6h6z"/>',
 align:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M4 10h6m4 0h6m-8 4v6"/>',
 ac:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9 4l3 3 3-3m-6 16 3-3 3 3"/>',
 elec:'<path d="m13 2-8 12h6l-1 8 9-12h-6z"/>'
};
const uiIcon=id=>`<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${UI_GLYPHS[id]||UI_GLYPHS.shop}</svg>`;

function bootErrorHTML(message){return `<section class="boot-screen boot-error" aria-busy="false"><div class="boot-brand"><span class="boot-symbol">П</span><b>ПИТ</b></div><div class="boot-visual" aria-hidden="true"><span class="boot-core">П</span></div><div class="boot-copy"><h1>Пока не удалось подключиться</h1><p>${E(message)}</p></div><div class="boot-status" role="status"><span class="boot-spinner" aria-hidden="true"></span><div><strong>Ваш сервис временно недоступен</strong><small>Можно повторить подключение. Без связи записи и изменения недоступны.</small></div></div><button class="primary wide" type="button" data-boot-retry>Повторить подключение</button></section>`;}
const bootWaitTimer=setTimeout(()=>{const note=document.getElementById('boot-note');if(note)note.textContent='Подключение занимает больше времени. Можно подождать или повторить.';const retry=document.getElementById('boot-retry');if(retry)retry.hidden=false;},10000);
document.addEventListener('pit-ready',()=>clearTimeout(bootWaitTimer),{once:true});
document.addEventListener('click',event=>{if(event.target.closest?.('[data-boot-retry],#boot-retry')){event.preventDefault();event.stopImmediatePropagation();location.reload();}},true);

const serviceDisplayName=n=>E(n==='Развал-схождение'?'Развал / схождение':n);
const servicePriceLine=(price,min,from=false)=>`<span class="keep-together">${from?'от ':''}${money(price)}</span> <span class="keep-together">· ${min} мин</span>`;
