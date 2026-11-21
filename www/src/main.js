import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import './style.css';

const days = [
  ['Saturday','شنبه'],['Sunday','یکشنبه'],['Monday','دوشنبه'],
  ['Tuesday','سه‌شنبه'],['Wednesday','چهارشنبه'],['Thursday','پنجشنبه'],['Friday','جمعه']
];
const $ = (id) => document.getElementById(id);
let items = [], filter = 'همه', layout = 'grid', editing = null;
let db = null;
const native = Capacitor.isNativePlatform();

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('show'), 3500);
}
function dayLabel(value) { return days.find(d => d[0] === value)?.[1] || value; }

async function initDatabase() {
  if (native) {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    db = await sqlite.createConnection('animecollector', false, 'no-encryption', 1, false);
    await db.open();
    await db.execute(`CREATE TABLE IF NOT EXISTS animes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, week_day TEXT NOT NULL,
      url TEXT NOT NULL, last_episode INTEGER NOT NULL DEFAULT 1,
      provider TEXT NOT NULL, image TEXT, created_at TEXT, updated_at TEXT
    )`);
    await loadItems();
  } else {
    items = JSON.parse(localStorage.getItem('animecollector_items') || '[]');
  }
}
async function loadItems() {
  if (db) {
    const result = await db.query('SELECT * FROM animes ORDER BY id DESC');
    items = result.values || [];
  }
  render();
}
async function saveItem(item) {
  const now = new Date().toISOString();
  if (db) {
    if (item.id) {
      await db.run('UPDATE animes SET name=?, week_day=?, url=?, last_episode=?, provider=?, updated_at=? WHERE id=?',
        [item.name,item.week_day,item.url,item.last_episode,item.provider,now,item.id]);
    } else {
      await db.run('INSERT INTO animes (name,week_day,url,last_episode,provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        [item.name,item.week_day,item.url,item.last_episode,item.provider,now,now]);
    }
    await loadItems();
  } else {
    if (item.id) items = items.map(x => x.id === item.id ? {...x,...item,updated_at:now} : x);
    else items.unshift({...item,id:Date.now(),created_at:now,updated_at:now});
    localStorage.setItem('animecollector_items',JSON.stringify(items));
    render();
  }
}
async function deleteItem(id) {
  if (!confirm('این انیمه از کلکسیون حذف شود؟')) return;
  if (db) { await db.run('DELETE FROM animes WHERE id=?',[id]); await loadItems(); }
  else { items=items.filter(x=>x.id!==id); localStorage.setItem('animecollector_items',JSON.stringify(items)); render(); }
}
async function updateEpisode(id, episode) {
  const item=items.find(x=>x.id===id); if(!item)return;
  item.last_episode=episode;
  await saveItem(item);
}
function render() {
  $('count').textContent = new Intl.NumberFormat('fa-IR').format(items.length);
  $('dayFilters').innerHTML = ['همه',...days.map(d=>d[1])].map(d=>
    `<button class="day-chip ${filter===d?'chosen':''}" data-filter="${d}">${d}</button>`).join('');
  const shown=items.filter(x=>filter==='همه'||dayLabel(x.week_day)===filter);
  $('empty').style.display=shown.length?'none':'block';
  $('animeList').className=`anime-list ${layout==='list'?'list-view':''}`;
  $('animeList').innerHTML=shown.map(x=>`
    <article class="anime-card">
      <div class="card-top"><span class="provider">${x.provider==='nine anime'?'NineAnime':'Animex'}</span><span class="day">${dayLabel(x.week_day)}</span></div>
      <h3 dir="auto">${escapeHtml(x.name)}</h3>
      <div class="episode">آخرین قسمت ثبت‌شده <b>${Number(x.last_episode||1).toLocaleString('fa-IR')}</b></div>
      <div class="card-actions">
        <button data-extract="${x.id}" class="extract">استخراج لینک آخرین قسمت</button>
        <button data-edit="${x.id}" class="small-btn">ویرایش</button>
        <button data-delete="${x.id}" class="small-btn danger">حذف</button>
      </div>
    </article>`).join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function openForm(item=null) {
  editing=item?.id ?? null;
  $('formTitle').textContent=item?'ویرایش انیمه':'افزودن انیمه';
  $('name').value=item?.name||'';
  $('weekDay').innerHTML='<option value="">انتخاب روز</option>'+days.map(d=>`<option value="${d[0]}">${d[1]}</option>`).join('');
  $('weekDay').value=item?.week_day||'';
  $('provider').value=item?.provider||'animex';
  $('url').value=item?.url||'';
  $('lastEpisode').value=item?.last_episode||1;
  $('animeDialog').showModal();
}
async function getCookie() {
  if(native) {
    try { return (await SecureStoragePlugin.get({key:'nineanime_cookie'})).value || ''; }
    catch { return ''; }
  }
  return sessionStorage.getItem('nineanime_cookie') || '';
}
async function setCookie(value) {
  if(native) {
    if(value) await SecureStoragePlugin.set({key:'nineanime_cookie',value});
    else await SecureStoragePlugin.remove({key:'nineanime_cookie'});
  } else {
    if(value) sessionStorage.setItem('nineanime_cookie',value);
    else sessionStorage.removeItem('nineanime_cookie');
    toast('در پیش‌نمایش مرورگر، کوکی فقط تا پایان نشست نگهداری می‌شود؛ در APK ذخیره امن اندروید استفاده می‌شود.');
  }
}
async function requestHtml(url, headers={}) {
  // On Android, use Capacitor's native HTTP bridge so requests are not
  // dependent on WebView CORS behavior. Browser preview keeps ordinary fetch.
  if (native) {
    const response = await CapacitorHttp.request({
      method: 'GET',
      url,
      headers,
      responseType: 'text',
      connectTimeout: 30000,
      readTimeout: 30000
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`پاسخ سایت ناموفق بود (${response.status})`);
    }
    if (typeof response.data !== 'string') {
      throw new Error('محتوای دریافتی سایت قابل خواندن نیست.');
    }
    return response.data;
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`پاسخ سایت ناموفق بود (${response.status})`);
  return await response.text();
}
function resolveUrl(base, href) { return new URL(href,base).href; }
function episodeNumber(filename) {
  let m=filename.match(/\b(?:episode|ep|cap|op|ed)[\s._-]*0*(\d{1,4})\b/i);
  if(m)return Number(m[1]);
  m=filename.match(/\bs\d{1,2}e0*(\d{1,4})\b/i); if(m)return Number(m[1]);
  const nums=(filename.split(/[^\p{L}\p{N}]+/u).map(t=>/^\d{1,3}$/.test(t)?Number(t):null).filter(n=>n!==null));
  return nums.reverse().find(n=>![144,240,360,480,576,720].includes(n)) ?? null;
}
function parseDirectory(html,base) {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const found=[];
  for(const a of doc.querySelectorAll('a[href]')) {
    const href=a.getAttribute('href')?.trim(); if(!href||href.startsWith('#'))continue;
    const url=resolveUrl(base,href);
    const filename=decodeURIComponent(new URL(url).pathname.split('/').pop()||'');
    if(!/\.(mkv|mp4|avi|webm|m4v)$/i.test(filename))continue;
    const ep=episodeNumber(filename);
    if(ep!==null)found.push({episode:ep,filename,url});
  }
  found.sort((a,b)=>b.episode-a.episode);
  if(!found.length)throw new Error('لینک ویدیویی دارای شماره قسمت در صفحه پیدا نشد.');
  return found[0];
}
async function extract(item) {
  const u=new URL(item.url);
  if(item.provider==='animex') {
    if(u.hostname!=='rdl1.hollowofthealley.space') throw new Error('دامنه لینک Animex معتبر نیست.');
    return parseDirectory(await requestHtml(item.url,{'User-Agent':'Mozilla/5.0'}),item.url);
  }
  if(u.hostname!=='nineanime.ir')throw new Error('دامنه لینک NineAnime معتبر نیست.');
  const cookie=await getCookie(); if(!cookie)throw new Error('ابتدا Cookie سایت NineAnime را در تنظیمات وارد کن.');
  const encoded=u.searchParams.get('file'); if(!encoded)throw new Error('پارامتر file در لینک پیدا نشد.');
  let directory;
  try { directory=atob(encoded); } catch { throw new Error('آدرس پوشه دانلود نامعتبر است.'); }
  const dir=new URL(directory);
  if(dir.hostname!=='dl2.nineanime.ir')throw new Error('دامنه پوشه دانلود مجاز نیست.');
  const html=await requestHtml(directory,{'User-Agent':'Mozilla/5.0','Cookie':cookie,'Referer':'https://nineanime.ir/'});
  return parseDirectory(html,directory);
}
async function extractAndCopy(item) {
  toast('در حال بررسی سایت و استخراج لینک…');
  try {
    const result=await extract(item);
    await updateEpisode(item.id,result.episode);
    await navigator.clipboard.writeText(result.url);
    toast(`قسمت ${result.episode} پیدا و لینک آن کپی شد.`);
  } catch(e) { toast(e.message || 'استخراج لینک انجام نشد.'); }
}
function openSettings() { $('settingsDialog').showModal(); getCookie().then(v=>$('cookie').value=v); }

$('addBtn').onclick=()=>openForm(); $('navAdd').onclick=()=>openForm();
$('settingsBtn').onclick=openSettings; $('navSettings').onclick=openSettings;
$('gridBtn').onclick=()=>{layout='grid';$('gridBtn').classList.add('active');$('listBtn').classList.remove('active');render();};
$('listBtn').onclick=()=>{layout='list';$('listBtn').classList.add('active');$('gridBtn').classList.remove('active');render();};
$('dayFilters').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){filter=b.dataset.filter;render();}};
$('animeList').onclick=e=>{
  const ex=e.target.closest('[data-extract]'), ed=e.target.closest('[data-edit]'), del=e.target.closest('[data-delete]');
  if(ex)extractAndCopy(items.find(x=>x.id===Number(ex.dataset.extract)));
  if(ed)openForm(items.find(x=>x.id===Number(ed.dataset.edit)));
  if(del)deleteItem(Number(del.dataset.delete));
};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('animeForm').onsubmit=async e=>{
  e.preventDefault();
  const item={id:editing,name:$('name').value.trim(),week_day:$('weekDay').value,url:$('url').value.trim(),last_episode:Number($('lastEpisode').value),provider:$('provider').value};
  if(!item.week_day||!item.name||!item.url)return;
  try { const u=new URL(item.url); if(!['http:','https:'].includes(u.protocol))throw new Error(); }
  catch { toast('لینک معتبر وارد کن.');return; }
  await saveItem(item); $('animeDialog').close(); toast('انیمه ذخیره شد.');
};
$('settingsForm').onsubmit=async e=>{e.preventDefault();try{await setCookie($('cookie').value.trim());$('settingsDialog').close();toast('تنظیمات ذخیره شد.');}catch{toast('ذخیره امن Cookie ناموفق بود.');}};
$('removeCookie').onclick=async()=>{await setCookie('');$('cookie').value='';toast('Cookie پاک شد.');};

(async()=>{
  try { await initDatabase(); }
  catch(e) { console.error(e); toast('راه‌اندازی پایگاه داده ناموفق بود. برنامه را دوباره اجرا کن.'); }
})();
