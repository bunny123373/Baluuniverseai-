/* script.js - handles both public index and admin pages
   Usage:
   - place <script src="script.js"></script> at end of body in both index.html and admin.html
   - set API_BASE and optionally ADMIN_TOKEN at top, or the script will prompt for them on first use
*/

const CONFIG = {
  API_BASE: (window.__API_BASE__ || null), // override by setting window.__API_BASE__ before loading script
  ADMIN_TOKEN: (window.__ADMIN_TOKEN__ || null)
};

// helper: ensure API_BASE
async function getApiBase(){
  if(CONFIG.API_BASE) return CONFIG.API_BASE;
  const val = prompt('Enter backend API base URL (e.g. https://baluplix.example.com):', window.location.origin);
  CONFIG.API_BASE = val;
  return CONFIG.API_BASE;
}

// helper: admin token
async function getAdminToken(){
  if(CONFIG.ADMIN_TOKEN) return CONFIG.ADMIN_TOKEN;
  const val = prompt('Enter Admin Token (x-admin-token):','');
  CONFIG.ADMIN_TOKEN = val;
  return CONFIG.ADMIN_TOKEN;
}

/* ------------------ PUBLIC / INDEX ------------------ */
async function renderPublicGrid(){
  const base = await getApiBase();
  const grid = document.getElementById('grid') || document.getElementById('videoList');
  if(!grid) return;

  // loading state
  grid.innerHTML = '<div style="opacity:0.6">Loading…</div>';

  try{
    const res = await fetch(base + '/api/videos');
    if(!res.ok) throw new Error('Failed to fetch videos');
    const list = await res.json();
    if(!Array.isArray(list) || list.length===0){
      grid.innerHTML = '<div style="opacity:0.6">No published videos yet.</div>';
      return;
    }
    grid.innerHTML = '';
    list.forEach(v=>{
      const c = document.createElement('div');
      c.className = 'card';
      // use a small <video> as thumbnail (muted). Use poster if available as v.poster
      const thumb = document.createElement('video');
      thumb.className = 'thumb';
      thumb.setAttribute('muted','muted');
      thumb.setAttribute('playsinline','');
      thumb.preload = 'metadata';
      // set source
      const src = v.url;
      const s = document.createElement('source');
      s.src = src;
      // do not set type to force browser detect
      thumb.appendChild(s);

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = v.title || 'Untitled';

      const meta = document.createElement('div');
      meta.className = 'meta';
      if (v.createdAt) meta.textContent = new Date(v.createdAt).toLocaleString();
      c.appendChild(thumb);
      c.appendChild(title);
      c.appendChild(meta);

      // click opens player
      thumb.addEventListener('click', ()=> openPlayer(v));
      c.addEventListener('click', ()=> openPlayer(v));
      grid.appendChild(c);

      // prevent automatic heavy streaming
      thumb.addEventListener('play', ()=> { try{ thumb.pause(); }catch(e){} });
    });
  }catch(err){
    grid.innerHTML = '<div style="opacity:0.6">Error loading videos.</div>';
    console.error(err);
  }
}

// Open overlay player
function openPlayer(videoMeta){
  const wrap = ensurePlayerWrap();
  const player = document.getElementById('playVideo');
  player.src = videoMeta.url;
  // set type if known
  player.setAttribute('controls','');
  player.play().catch(()=>{});
  wrap.classList.add('active');
}

function ensurePlayerWrap(){
  let wrap = document.getElementById('playerWrap');
  if(wrap) return wrap;
  wrap = document.createElement('div');
  wrap.id = 'playerWrap';
  wrap.className = 'player-wrap';
  wrap.innerHTML = `
    <button id="closeBtn" class="close-btn">Close</button>
    <video id="playVideo" class="player" controls playsinline webkit-playsinline></video>
  `;
  document.body.appendChild(wrap);
  document.getElementById('closeBtn').addEventListener('click', ()=> {
    const p = document.getElementById('playVideo');
    p.pause(); p.src=''; wrap.classList.remove('active');
  });
  return wrap;
}

/* ------------------ ADMIN ------------------ */

async function initAdmin(){
  // require elements
  const uploadBtn = document.getElementById('uploadBtn');
  const allVideosContainer = document.getElementById('allVideos') || document.getElementById('adminVideosList');

  if(!uploadBtn || !allVideosContainer){
    console.warn('Admin elements not found.');
    return;
  }

  const api = await getApiBase();
  const token = await getAdminToken();

  // upload flow: 1) get presigned url -> 2) PUT file to that URL -> 3) create metadata entry
  uploadBtn.addEventListener('click', async ()=>{
    const inputFile = document.getElementById('videoFile') || document.querySelector('input[type=file]');
    const titleEl = document.getElementById('title') || document.querySelector('input[name=title]');
    const descEl = document.getElementById('desc') || document.querySelector('textarea[name=desc]');

    if(!inputFile || !inputFile.files.length) return alert('Select a video file first');
    const file = inputFile.files[0];
    const filename = file.name;
    const contentType = file.type || 'video/mp4';
    const title = (titleEl && titleEl.value) ? titleEl.value : filename;
    const description = descEl ? descEl.value : '';

    try{
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Preparing upload…';
      // 1) request presigned URL
      const r1 = await fetch(api + '/api/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'x-admin-token': token
        },
        body: JSON.stringify({ filename, contentType })
      });
      if(!r1.ok) {
        const j = await r1.json().catch(()=>({error:'err'}));
        throw new Error('Upload-url failed: ' + (j.error || r1.status));
      }
      const j1 = await r1.json();
      const { uploadUrl, key } = j1;
      if(!uploadUrl || !key) throw new Error('Invalid upload-url response');

      uploadBtn.textContent = 'Uploading…';
      // 2) PUT file directly to S3 (or chosen provider)
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType
        },
        body: file
      });
      if(!(putRes.ok || putRes.status===200 || putRes.status===204)) {
        throw new Error('Upload failed: ' + putRes.status);
      }

      uploadBtn.textContent = 'Saving metadata…';
      // 3) inform backend to create metadata
      const r2 = await fetch(api + '/api/videos', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'x-admin-token': token
        },
        body: JSON.stringify({
          title, description, key, size: file.size, mimetype: contentType
        })
      });
      const j2 = await r2.json();
      if(!r2.ok) throw new Error(JSON.stringify(j2));
      alert('Upload complete. Video created as draft. Publish it from the list.');

      // refresh list
      loadAdminVideos(api, token, allVideosContainer);

    }catch(err){
      console.error(err);
      alert('Error: ' + (err.message || err));
    }finally{
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload';
    }
  });

  // load initial list
  loadAdminVideos(api, token, allVideosContainer);

  // handle publish/delete clicks (event delegation)
  allVideosContainer.addEventListener('click', async (ev)=>{
    const t = ev.target;
    if(t.matches('[data-action="publish"]')){
      const id = t.dataset.id;
      const publish = t.dataset.published === 'false' ? true : false;
      try{
        const res = await fetch(api + `/api/video/${id}/publish`, {
          method: 'POST',
          headers: {'Content-Type':'application/json','x-admin-token': token},
          body: JSON.stringify({ publish })
        });
        await res.json();
        loadAdminVideos(api, token, allVideosContainer);
      }catch(e){ console.error(e); alert('Publish fail'); }
    }
    if(t.matches('[data-action="delete"]')){
      if(!confirm('Delete this video permanently?')) return;
      const id = t.dataset.id;
      try{
        const res = await fetch(api + `/api/admin/video/${id}`, {
          method: 'DELETE',
          headers: {'x-admin-token': token}
        });
        await res.json();
        loadAdminVideos(api, token, allVideosContainer);
      }catch(e){ console.error(e); alert('Delete fail'); }
    }
  });
}

// fetch & render admin video list
async function loadAdminVideos(api, token, container){
  if(!api || !token) return;
  container.innerHTML = '<div style="opacity:0.6">Loading…</div>';
  try{
    const r = await fetch(api + '/api/admin/videos', { headers: { 'x-admin-token': token } });
    const list = await r.json();
    if(!Array.isArray(list) || list.length===0){
      container.innerHTML = '<div style="opacity:0.6">No videos yet.</div>';
      return;
    }
    container.innerHTML = '';
    list.forEach(v=>{
      const item = document.createElement('div');
      item.className = 'admin-item';
      const left = document.createElement('div');
      left.innerHTML = `<strong>${escapeHtml(v.title)}</strong><div style="font-size:12px;color:var(--muted)">${v.published ? 'Published' : 'Draft'} · ${new Date(v.createdAt || v._id?.getTimestamp?.()).toLocaleString()}</div>`;
      const right = document.createElement('div');
      right.innerHTML = `
        <button class="btn small ghost" data-action="publish" data-id="${v._id}" data-published="${v.published}">${v.published ? 'Unpublish' : 'Publish'}</button>
        <button class="btn small" style="background:#b23" data-action="delete" data-id="${v._id}">Delete</button>
      `;
      item.appendChild(left);
      item.appendChild(right);
      container.appendChild(item);
    });
  }catch(err){
    console.error(err);
    container.innerHTML = '<div style="opacity:0.6">Failed to load.</div>';
  }
}

/* ------------------ AUTO INIT ------------------ */
document.addEventListener('DOMContentLoaded', ()=>{
  // decide role by presence of known elements
  if(document.getElementById('uploadBtn')){
    // admin page
    initAdmin().catch(e=>console.error(e));
  }
  // public page (grid presence)
  if(document.getElementById('grid') || document.getElementById('videoList')){
    renderPublicGrid().catch(e=>console.error(e));
  }
});
// get token
const token = localStorage.getItem('balu_token');
// use headers: { 'Authorization': 'Bearer ' + token }

/* ------------------ small helpers ------------------ */
function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }