const DB_NAME = 'ImageParameterMatcherDB';
const DB_VERSION = 4;
const STORE = 'records';
const DEFINITION_STORE = 'datasetDefinitions';
const META_STORE = 'libraryMeta';
const LIBRARY_PAGE_SIZE = 25;
let libraryNeedsRefresh = true;
const DEFAULT_OBJECTS = ['Staff', 'Dino', 'Scale'];
const DEFAULT_DIRECTIONS = ['Up', 'Down', 'Left', 'Right'];
const DEFAULT_GRID_SIZES = [{width:8,height:10},{width:9,height:9},{width:10,height:12}];
let db;
let selectedFiles = [];
let editingRecordId = null;
let objects = JSON.parse(localStorage.getItem('matcherObjects') || 'null') || DEFAULT_OBJECTS;
let directions = JSON.parse(localStorage.getItem('matcherDirections') || 'null') || DEFAULT_DIRECTIONS;
let gridSizes = normalizeGridSizes(JSON.parse(localStorage.getItem('matcherGridSizes') || 'null') || DEFAULT_GRID_SIZES);
let theme = localStorage.getItem('matcherTheme') || 'light';


function normalizeGridSizes(values) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(values) ? values : []).forEach(value => {
    let width, height;
    if (typeof value === 'string') {
      const match = value.match(/^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i);
      if (match) { width = Number(match[1]); height = Number(match[2]); }
    } else if (value && typeof value === 'object') {
      width = Number(value.width); height = Number(value.height);
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 999 || height > 999) return;
    const key = `${width}x${height}`;
    if (!seen.has(key)) { seen.add(key); normalized.push({width,height}); }
  });
  return normalized.length ? normalized : DEFAULT_GRID_SIZES.map(item => ({...item}));
}
function gridValue(width, height) { return `${Number(width)}x${Number(height)}`; }
function parseGridValue(value) {
  const match = String(value || '').match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error('Choose a valid grid size.');
  return {width:Number(match[1]), height:Number(match[2])};
}
function refreshGridDropdowns(preferred={}) {
  ['searchGridSize','addGridSize'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const oldValue = preferred[id] || select.value;
    select.innerHTML = '';
    gridSizes.forEach(size => select.add(new Option(`${size.width}×${size.height}`, gridValue(size.width,size.height))));
    if ([...select.options].some(option => option.value === oldValue)) select.value = oldValue;
    else if (select.options.length) select.selectedIndex = 0;
  });
}
function addGridSizeOption(width, height) {
  width=Number(width); height=Number(height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width>999 || height>999) throw new Error('Grid width and height must be whole numbers from 1 to 999.');
  const key=gridValue(width,height);
  if (gridSizes.some(size => gridValue(size.width,size.height)===key)) throw new Error(`${width}×${height} already exists.`);
  gridSizes.push({width,height});
  persistSettings(); renderSettings(); refreshGridDropdowns({addGridSize:key,searchGridSize:key});
}


function applyTheme(nextTheme, persist=true) {
  theme = nextTheme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem('matcherTheme', theme);
  const toggle = document.getElementById('darkModeToggle');
  const label = document.getElementById('themeModeLabel');
  const meta = document.getElementById('themeColorMeta');
  if (toggle) toggle.checked = theme === 'dark';
  if (label) label.textContent = theme === 'dark' ? 'Dark mode' : 'Light mode';
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#020617' : '#111827');
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      let store;
      if (!d.objectStoreNames.contains(STORE)) {
        store = d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      } else {
        store = req.transaction.objectStore(STORE);
      }
      if (!store.indexNames.contains('matchKey')) store.createIndex('matchKey', 'matchKey', { unique: false });
      if (!store.indexNames.contains('libraryEntryId')) store.createIndex('libraryEntryId', 'libraryEntryId', { unique: false });
      if (!store.indexNames.contains('gridSize')) store.createIndex('gridSize', ['width','height'], { unique: false });
      if (!store.indexNames.contains('albumKey')) store.createIndex('albumKey', 'albumKey', { unique: false });
      if (!store.indexNames.contains('subAlbumKey')) store.createIndex('subAlbumKey', 'subAlbumKey', { unique: false });
      let metaStore;
      if (!d.objectStoreNames.contains(META_STORE)) metaStore = d.createObjectStore(META_STORE, { keyPath: 'id' });
      else metaStore = req.transaction.objectStore(META_STORE);
      if (!metaStore.indexNames.contains('libraryEntryId')) metaStore.createIndex('libraryEntryId', 'libraryEntryId', { unique: false });
      if (!metaStore.indexNames.contains('gridSize')) metaStore.createIndex('gridSize', ['width','height'], { unique: false });
      if (!metaStore.indexNames.contains('albumKey')) metaStore.createIndex('albumKey', 'albumKey', { unique: false });
      if (!metaStore.indexNames.contains('subAlbumKey')) metaStore.createIndex('subAlbumKey', 'subAlbumKey', { unique: false });
      if (!d.objectStoreNames.contains(DEFINITION_STORE)) {
        d.createObjectStore(DEFINITION_STORE, { keyPath: 'objectKey' });
      }
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        metaStore.put(toLibraryMeta(cursor.value));
        cursor.continue();
      };
    };
    req.onsuccess = () => {
      db = req.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains(STORE) || !db.objectStoreNames.contains(DEFINITION_STORE) || !db.objectStoreNames.contains(META_STORE)) {
        db.close();
        reject(new Error('Database migration did not complete. Close other open Image Matcher windows and reopen the app.'));
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade is blocked by another open Image Matcher window. Close all other app windows, then reopen this one.'));
  });
}

function tx(mode='readonly') { return db.transaction(STORE, mode).objectStore(STORE); }
function definitionTx(mode='readonly') { return db.transaction(DEFINITION_STORE, mode).objectStore(DEFINITION_STORE); }
function metaTx(mode='readonly') { return db.transaction(META_STORE, mode).objectStore(META_STORE); }
function requestToPromise(req) { return new Promise((res, rej) => { req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
function normalize(v) { return String(v || '').trim().toLowerCase(); }
function canonicalParams(params) {
  return params.map(p => ({ object: normalize(p.object), direction: normalize(p.direction), row: null, col: null }))
    .sort((a,b) => `${a.object}|${a.direction}`.localeCompare(`${b.object}|${b.direction}`));
}
function makeKey(width, height, params) { return `${Number(width)}x${Number(height)}|` + canonicalParams(params).map(p => `${p.object}:${p.direction}:${p.row??''}:${p.col??''}`).join('|'); }
function makeAlbumKey(width, height) { return `${Number(width)}x${Number(height)}`; }
function makeSubAlbumKey(params) { return canonicalParams(params).map(p => p.object).sort().join('|'); }
function objectOrderIndex(name) {
  const key = normalize(name);
  const index = objects.findIndex(item => normalize(item) === key);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}
function makeSubAlbumLabel(params) {
  const counts = new Map();
  canonicalParams(params).forEach(p => counts.set(p.object, (counts.get(p.object) || 0) + 1));
  return [...counts.entries()]
    .sort((a,b) => objectOrderIndex(a[0]) - objectOrderIndex(b[0]) || a[0].localeCompare(b[0]))
    .map(([name,count]) => `${titleCase(name)}${count > 1 ? ` ×${count}` : ''}`)
    .join(' • ') || 'No Parameters';
}
function titleCase(s) { return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }
function setStatus(el, text, type='') { el.textContent=text; el.className=`status ${type}`; }

function toLibraryMeta(record) {
  const params = Array.isArray(record.params) ? record.params : [];
  return {
    id: record.id,
    libraryEntryId: Number(record.libraryEntryId) || null,
    width: Number(record.width),
    height: Number(record.height),
    params,
    albumKey: record.albumKey || makeAlbumKey(record.width, record.height),
    subAlbumKey: record.subAlbumKey || makeSubAlbumKey(params),
    subAlbumLabel: record.subAlbumLabel || makeSubAlbumLabel(params),
    notes: record.notes || '',
    imageName: record.imageName || ''
  };
}
async function putRecord(record) {
  const savedId = await requestToPromise(tx('readwrite').put(record));
  const saved = record.id ? record : {...record, id:savedId};
  await requestToPromise(metaTx('readwrite').put(toLibraryMeta(saved)));
  libraryNeedsRefresh = true;
  return savedId;
}
async function addRecord(record) {
  const savedId = await requestToPromise(tx('readwrite').add(record));
  const saved = {...record, id:savedId};
  await requestToPromise(metaTx('readwrite').put(toLibraryMeta(saved)));
  libraryNeedsRefresh = true;
  return savedId;
}

async function addRecordsBatch(records, options={}) {
  if (!Array.isArray(records) || !records.length) return options.returnMeta ? [] : 0;
  const rawOnly = options.rawOnly === true;
  const returnMeta = options.returnMeta === true;
  return new Promise((resolve, reject) => {
    const transaction = rawOnly
      ? db.transaction(STORE, 'readwrite')
      : db.transaction([STORE, META_STORE], 'readwrite');
    const recordStore = transaction.objectStore(STORE);
    const metaStore = rawOnly ? null : transaction.objectStore(META_STORE);
    const importedMeta = [];
    let completed = 0;

    transaction.oncomplete = () => {
      libraryNeedsRefresh = true;
      resolve(returnMeta ? importedMeta : completed);
    };
    transaction.onerror = () => reject(transaction.error || new Error('Import batch failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Import batch was aborted.'));

    for (const record of records) {
      const req = recordStore.add(record);
      req.onsuccess = () => {
        const saved = {...record, id:req.result};
        const meta = toLibraryMeta(saved);
        if(metaStore) metaStore.put(meta);
        if(returnMeta) importedMeta.push(meta);
        completed++;
      };
    }
  });
}

async function rebuildLibraryMetaBulk(metadata) {
  const rows = Array.isArray(metadata) ? metadata : [];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    transaction.oncomplete = () => { libraryNeedsRefresh = true; resolve(rows.length); };
    transaction.onerror = () => reject(transaction.error || new Error('Library metadata rebuild failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Library metadata rebuild was aborted.'));
    store.clear();
    for (const row of rows) store.put(row);
  });
}

async function putDefinitionsBatch(definitions) {
  const rows = Array.isArray(definitions) ? definitions.filter(item => item && item.objectKey) : [];
  if(!rows.length) return 0;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DEFINITION_STORE, 'readwrite');
    const store = transaction.objectStore(DEFINITION_STORE);
    transaction.oncomplete = () => resolve(rows.length);
    transaction.onerror = () => reject(transaction.error || new Error('Dataset definition import failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Dataset definition import was aborted.'));
    for(const row of rows) store.put(row);
  });
}
async function deleteRecord(recordId) {
  await requestToPromise(tx('readwrite').delete(recordId));
  await requestToPromise(metaTx('readwrite').delete(recordId));
  libraryNeedsRefresh = true;
}
async function getAllMeta() { return requestToPromise(metaTx().getAll()); }
async function getMetaForGrid(width, height) {
  return requestToPromise(metaTx().index('gridSize').getAll([Number(width), Number(height)]));
}

function patternObjectsFromParams(params) {
  const counts = new Map();
  (Array.isArray(params) ? params : []).forEach(param => {
    const key = normalize(param.object);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  const names = [...counts.keys()].sort((a,b) => objectOrderIndex(a) - objectOrderIndex(b) || a.localeCompare(b));
  const result = [];
  names.forEach(name => {
    const configured = objects.find(item => normalize(item) === name) || titleCase(name);
    for (let i=0; i<counts.get(name); i++) result.push(configured);
  });
  return result;
}

async function refreshAddPatternTemplates() {
  const select = document.getElementById('addPatternTemplate');
  const gridSelect = document.getElementById('addGridSize');
  if (!select || !gridSelect || !db) return;
  const previous = select.value;
  select.innerHTML = '';
  select.add(new Option('Choose a pattern to prefill objects…', ''));
  try {
    const {width,height} = parseGridValue(gridSelect.value);
    const metadata = await getMetaForGrid(width,height);
    const patterns = new Map();
    metadata.forEach(meta => {
      const key = meta.subAlbumKey || makeSubAlbumKey(meta.params || []);
      if (!key || patterns.has(key)) return;
      const objectList = patternObjectsFromParams(meta.params || []);
      if (!objectList.length) return;
      patterns.set(key, {
        key,
        label: meta.subAlbumLabel || makeSubAlbumLabel(meta.params || []),
        objects: objectList
      });
    });
    [...patterns.values()]
      .sort((a,b) => a.label.localeCompare(b.label, undefined, {numeric:true}))
      .forEach(pattern => {
        const option = new Option(pattern.label, pattern.key);
        option.dataset.objects = JSON.stringify(pattern.objects);
        select.add(option);
      });
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    else select.value = '';
    select.disabled = patterns.size === 0;
    if (!patterns.size) select.options[0].textContent = 'No existing patterns for this grid';
  } catch (error) {
    select.disabled = true;
    select.options[0].textContent = 'No existing patterns for this grid';
  }
}

function applyAddPatternTemplate() {
  const select = document.getElementById('addPatternTemplate');
  if (!select || !select.value) return;
  const option = select.selectedOptions[0];
  let patternObjects = [];
  try { patternObjects = JSON.parse(option.dataset.objects || '[]'); } catch (_) {}
  if (!patternObjects.length) return;
  const container = document.getElementById('addParams');
  container.innerHTML = '';
  patternObjects.forEach(objectName => buildParamRow(container, {object:objectName, direction:'Up'}));
}

async function refreshSearchPatternTemplates() {
  const select = document.getElementById('searchPatternTemplate');
  const gridSelect = document.getElementById('searchGridSize');
  if (!select || !gridSelect || !db) return;
  const previous = select.value;
  select.innerHTML = '';
  select.add(new Option('Choose a pattern to prefill objects…', ''));
  try {
    const {width,height} = parseGridValue(gridSelect.value);
    const metadata = await getMetaForGrid(width,height);
    const patterns = new Map();
    metadata.forEach(meta => {
      const key = meta.subAlbumKey || makeSubAlbumKey(meta.params || []);
      if (!key || patterns.has(key)) return;
      const objectList = patternObjectsFromParams(meta.params || []);
      if (!objectList.length) return;
      patterns.set(key, {
        key,
        label: meta.subAlbumLabel || makeSubAlbumLabel(meta.params || []),
        objects: objectList
      });
    });
    [...patterns.values()]
      .sort((a,b) => a.label.localeCompare(b.label, undefined, {numeric:true}))
      .forEach(pattern => {
        const option = new Option(pattern.label, pattern.key);
        option.dataset.objects = JSON.stringify(pattern.objects);
        select.add(option);
      });
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    else select.value = '';
    select.disabled = patterns.size === 0;
    if (!patterns.size) select.options[0].textContent = 'No existing patterns for this grid';
  } catch (error) {
    select.disabled = true;
    select.options[0].textContent = 'No existing patterns for this grid';
  }
}

function applySearchPatternTemplate() {
  const select = document.getElementById('searchPatternTemplate');
  if (!select || !select.value) return;
  const option = select.selectedOptions[0];
  let patternObjects = [];
  try { patternObjects = JSON.parse(option.dataset.objects || '[]'); } catch (_) {}
  if (!patternObjects.length) return;
  const container = document.getElementById('searchParams');
  container.innerHTML = '';
  patternObjects.forEach(objectName => buildParamRow(container, {object:objectName, direction:'Up'}));
}

function confirmDatasetDelete(rec) {
  const id = rec && (rec.libraryEntryId || rec.id) ? (rec.libraryEntryId || rec.id) : 'this dataset';
  return confirm(`Are you sure you want to delete Library ID ${id}?\n\nWARNING: This action is not reversible and the dataset cannot be recovered.`);
}
async function getRecordsForGrid(width, height) {
  return requestToPromise(tx().index('gridSize').getAll([Number(width), Number(height)]));
}
async function getRecordByLibraryId(libraryId) {
  return requestToPromise(tx().index('libraryEntryId').get(Number(libraryId)));
}
async function getUsedLibraryIds(excludeRecordId=null) {
  const used = new Set();
  await new Promise((resolve,reject)=>{
    const req = tx().index('libraryEntryId').openKeyCursor();
    req.onsuccess = event => { const cursor=event.target.result; if(!cursor){resolve();return;} const n=Number(cursor.key); if(Number.isInteger(n)&&n>=1&&n<=99999) used.add(n); cursor.continue(); };
    req.onerror = ()=>reject(req.error);
  });
  if (excludeRecordId != null) {
    const current = await requestToPromise(tx().get(excludeRecordId));
    if (current && Number.isInteger(Number(current.libraryEntryId))) used.delete(Number(current.libraryEntryId));
  }
  return used;
}

async function updateParamRowImage(row) {
  const preview = row.querySelector('.param-object-preview');
  if (!preview || !db) return;
  const objectName = row.querySelector('.object-select').value;
  const direction = row.querySelector('.direction-select').value;
  const requestId = `${normalize(objectName)}|${normalize(direction)}|${Date.now()}|${Math.random()}`;
  row.dataset.previewRequest = requestId;
  preview.classList.add('loading');
  preview.classList.remove('has-image');
  preview.innerHTML = '<span>…</span>';
  preview.title = `${objectName} — ${direction}`;
  try {
    const definition = await getDefinition(objectName);
    if (row.dataset.previewRequest !== requestId) return;
    const variant = definition && definition.variants && definition.variants[normalize(direction)];
    const image = variant || (definition && definition.baseImage) || null;
    preview.classList.remove('loading');
    preview.innerHTML = '';
    if (image && image.dataUrl) {
      const img = document.createElement('img');
      img.src = image.dataUrl;
      img.alt = `${objectName} ${direction}`;
      preview.appendChild(img);
      preview.classList.add('has-image');
      preview.title = variant ? `${objectName} — ${direction}` : `${objectName} — Base / General image`;
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = objectName ? objectName.charAt(0).toUpperCase() : '?';
      preview.appendChild(fallback);
      preview.title = `No ${direction} or base picture saved for ${objectName}`;
    }
  } catch (error) {
    if (row.dataset.previewRequest !== requestId) return;
    preview.classList.remove('loading');
    preview.innerHTML = '<span>!</span>';
    preview.title = error.message || String(error);
  }
}

function refreshAllParamImages() {
  document.querySelectorAll('.param-row').forEach(row => updateParamRowImage(row));
}

function selectValueCaseInsensitive(select, requestedValue, fallback='') {
  const requested = normalize(requestedValue);
  const matchingOption = [...select.options].find(option => normalize(option.value) === requested);
  select.value = matchingOption ? matchingOption.value : fallback;
}

function normalizeStoredParam(values={}) {
  return {
    object: values.object ?? values.name ?? values.type ?? values.item ?? '',
    direction: values.direction ?? values.orientation ?? values.facing ?? ''
  };
}

function buildParamRow(container, values={}) {
  const row = document.getElementById('paramRowTemplate').content.firstElementChild.cloneNode(true);
  const obj = row.querySelector('.object-select');
  const dir = row.querySelector('.direction-select');
  objects.forEach(v => obj.add(new Option(v, v)));
  directions.forEach(v => dir.add(new Option(v, v)));
  const stored = normalizeStoredParam(values);
  selectValueCaseInsensitive(obj, stored.object, objects[0] || '');
  selectValueCaseInsensitive(dir, stored.direction, directions[0] || '');
  obj.addEventListener('change', () => updateParamRowImage(row));
  dir.addEventListener('change', () => updateParamRowImage(row));
  row.querySelector('.remove-param').onclick = () => row.remove();
  container.appendChild(row);
  updateParamRowImage(row);
}

function readParams(container) {
  return [...container.querySelectorAll('.param-row')].map(row => ({
    object: row.querySelector('.object-select').value,
    direction: row.querySelector('.direction-select').value,
    row: null,
    col: null
  }));
}

function refreshParamRows() {
  ['searchParams','addParams'].forEach(id => {
    const c = document.getElementById(id);
    const vals = readParams(c);
    c.innerHTML='';
    (vals.length ? vals : [{}, {}, {}]).forEach(v => buildParamRow(c, v));
  });
}

function moveObject(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= objects.length || fromIndex === toIndex) return;
  const [item] = objects.splice(fromIndex, 1);
  objects.splice(toIndex, 0, item);
  persistSettings();
  renderSettings();
  refreshParamRows();
  if (db) libraryNeedsRefresh = true;
}
function renderSettings() {
  const objectList = document.getElementById('objectTags');
  objectList.innerHTML = '';
  objects.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'order-item';
    row.draggable = true;
    row.dataset.index = index;
    row.innerHTML = `<span class="drag-handle" title="Drag to reorder">☰</span><span class="order-number">${index + 1}</span><strong>${escapeHtml(item)}</strong><span class="order-actions"><button class="secondary move-up" title="Move up" ${index===0?'disabled':''}>↑</button><button class="secondary move-down" title="Move down" ${index===objects.length-1?'disabled':''}>↓</button><button class="danger remove-object" title="Remove">×</button></span>`;
    row.querySelector('.move-up').onclick = () => moveObject(index, index - 1);
    row.querySelector('.move-down').onclick = () => moveObject(index, index + 1);
    row.querySelector('.remove-object').onclick = () => {
      objects.splice(index, 1);
      persistSettings(); renderSettings(); refreshParamRows();
      if (db) libraryNeedsRefresh = true;
    };
    row.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', event => { event.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', event => {
      event.preventDefault(); row.classList.remove('drag-over');
      const from = Number(event.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from)) moveObject(from, index);
    });
    objectList.appendChild(row);
  });

  const directionList = document.getElementById('directionTags'); directionList.innerHTML='';
  directions.forEach(item => {
    const tag=document.createElement('span'); tag.className='tag';
    tag.innerHTML=`<span>${escapeHtml(item)}</span><button title="Remove">×</button>`;
    tag.querySelector('button').onclick=()=>{
      const idx=directions.indexOf(item); if(idx>=0) directions.splice(idx,1);
      persistSettings(); renderSettings(); refreshParamRows();
    };
    directionList.appendChild(tag);
  });
  const gridList = document.getElementById('gridSizeTags');
  if (gridList) {
    gridList.innerHTML='';
    gridSizes.forEach(size => {
      const tag=document.createElement('span'); tag.className='tag';
      tag.innerHTML=`<span>${size.width}×${size.height}</span><button title="Remove">×</button>`;
      tag.querySelector('button').onclick=()=>{
        if (gridSizes.length <= 1) return alert('At least one grid size must remain.');
        gridSizes=gridSizes.filter(item => gridValue(item.width,item.height)!==gridValue(size.width,size.height));
        persistSettings(); renderSettings(); refreshGridDropdowns();
      };
      gridList.appendChild(tag);
    });
  }
  if (db) renderDatasetDefinitions();
}
function persistSettings() { localStorage.setItem('matcherObjects', JSON.stringify(objects)); localStorage.setItem('matcherDirections', JSON.stringify(directions)); localStorage.setItem('matcherGridSizes', JSON.stringify(gridSizes)); }

function fileToDataURL(file) { return new Promise((res, rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsDataURL(file); }); }


function parseLibraryIdFromNotes(notes) {
  const match = String(notes || '').match(/^\s*ID\s+(\d{1,5})\s*(?:\||-|:)\s*/i);
  if (!match) return { id: null, notes: String(notes || '').trim() };
  return { id: Number(match[1]), notes: String(notes || '').replace(match[0], '').trim() };
}

async function getNextLibraryId(excludeRecordId=null) {
  const used = await getUsedLibraryIds(excludeRecordId);
  for (let id=1; id<=99999; id++) if (!used.has(id)) return id;
  throw new Error('No Library IDs are available between 1 and 99999.');
}

async function validateLibraryId(rawValue, excludeRecordId=null) {
  const trimmed = String(rawValue || '').trim();
  const id = trimmed ? Number(trimmed) : await getNextLibraryId(excludeRecordId);
  if (!Number.isInteger(id) || id < 1 || id > 99999) throw new Error('Library ID must be a whole number from 1 to 99999.');
  const existing = await getRecordByLibraryId(id);
  if (existing && existing.id !== excludeRecordId) throw new Error(`Library ID ${id} is already in use.`);
  return id;
}

function resetAddForm() {
  editingRecordId = null;
  selectedFiles = [];
  document.getElementById('imageInput').value = '';
  document.getElementById('previewArea').innerHTML = '';
  document.getElementById('notes').value = '';
  document.getElementById('libraryEntryId').value = '';
  const patternSelect=document.getElementById('addPatternTemplate'); if(patternSelect) patternSelect.value='';
  document.getElementById('saveBtn').textContent = 'Save Image(s)';
  document.getElementById('cancelEditBtn').classList.add('hidden');
  document.getElementById('addHeading').textContent = 'Add Image';
}

async function editRecord(recordId) {
  const rec = await requestToPromise(tx().get(recordId));
  if (!rec) return alert('This library entry could not be found.');
  editingRecordId = rec.id;
  selectedFiles = [];
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'add'));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'add'));
  document.getElementById('addHeading').textContent = `Edit Library Entry ${rec.libraryEntryId || ''}`.trim();
  document.getElementById('libraryEntryId').value = rec.libraryEntryId || '';
  const recordGrid=gridValue(rec.width,rec.height);
  if (!gridSizes.some(size => gridValue(size.width,size.height)===recordGrid)) { gridSizes.push({width:Number(rec.width),height:Number(rec.height)}); persistSettings(); renderSettings(); }
  refreshGridDropdowns({addGridSize:recordGrid});
  document.getElementById('addGridSize').value = recordGrid;
  await refreshAddPatternTemplates();
  document.getElementById('addPatternTemplate').value = '';
  document.getElementById('notes').value = rec.notes || '';
  const paramsContainer = document.getElementById('addParams');
  paramsContainer.innerHTML = '';
  const storedParams = Array.isArray(rec.params) ? rec.params : (Array.isArray(rec.parameters) ? rec.parameters : []);
  (storedParams.length ? storedParams : [{}]).forEach(p => buildParamRow(paramsContainer, p));
  const preview = document.getElementById('previewArea');
  preview.innerHTML = `<div class="existing-image-preview"><img src="${rec.dataUrl}" alt="${escapeHtml(rec.imageName)}"><p>Current image. Choose a new file only to replace it.</p></div>`;
  document.getElementById('saveBtn').textContent = 'Save Changes';
  document.getElementById('cancelEditBtn').classList.remove('hidden');
  setStatus(document.getElementById('saveStatus'), 'Editing an existing library entry.');
  window.scrollTo({top:0, behavior:'smooth'});
}

async function migrateLibraryIds() {
  const metadata = await getAllMeta();
  const used = new Set();
  let changed = 0;
  for (const meta of metadata.sort((a,b)=>a.id-b.id)) {
    const parsed = parseLibraryIdFromNotes(meta.notes);
    let candidate = Number(meta.libraryEntryId || parsed.id);
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > 99999 || used.has(candidate)) {
      candidate = 1;
      while (used.has(candidate) && candidate <= 99999) candidate++;
    }
    used.add(candidate);
    if (meta.libraryEntryId !== candidate || meta.notes !== parsed.notes) {
      const rec = await requestToPromise(tx().get(meta.id));
      if (!rec) continue;
      rec.libraryEntryId = candidate;
      rec.notes = parsed.notes;
      await putRecord(rec);
      changed++;
    }
  }
  return changed;
}

async function saveImages() {
  const status=document.getElementById('saveStatus');
  try {
    const {width,height}=parseGridValue(document.getElementById('addGridSize').value);
    const params=readParams(document.getElementById('addParams'));
    if(!params.length) throw new Error('Choose a grid size and add at least one parameter.');
    const libraryEntryId = await validateLibraryId(document.getElementById('libraryEntryId').value, editingRecordId);
    const notes=document.getElementById('notes').value.trim();
    const matchKey=makeKey(width,height,params);
    const common={ libraryEntryId, width, height, params:canonicalParams(params), matchKey, albumKey:makeAlbumKey(width,height), subAlbumKey:makeSubAlbumKey(params), subAlbumLabel:makeSubAlbumLabel(params), notes, updatedAt:new Date().toISOString() };

    if (editingRecordId !== null) {
      const existing = await requestToPromise(tx().get(editingRecordId));
      if (!existing) throw new Error('The record being edited no longer exists.');
      let imageFields={ imageName:existing.imageName, imageType:existing.imageType, dataUrl:existing.dataUrl };
      if (selectedFiles.length > 1) throw new Error('Select only one replacement image while editing.');
      if (selectedFiles.length === 1) {
        const file=selectedFiles[0];
        imageFields={ imageName:file.name, imageType:file.type, dataUrl:await fileToDataURL(file) };
      }
      await putRecord({...existing, ...common, ...imageFields});
      setStatus(status, `Library entry ${libraryEntryId} updated successfully.`, 'ok');
      resetAddForm();
    } else {
      if(!selectedFiles.length) throw new Error('Select at least one image.');
      if(selectedFiles.length > 1 && document.getElementById('libraryEntryId').value.trim()) throw new Error('Leave Library ID blank when adding multiple images so each image can receive its own ID.');
      let firstId=libraryEntryId;
      for(let index=0; index<selectedFiles.length; index++) {
        const file=selectedFiles[index];
        const entryId=index===0 ? firstId : await getNextLibraryId();
        const dataUrl=await fileToDataURL(file);
        await addRecord({ imageName:file.name, imageType:file.type, dataUrl, ...common, libraryEntryId:entryId, createdAt:new Date().toISOString() });
      }
      setStatus(status, `${selectedFiles.length} image(s) saved successfully.`, 'ok');
      resetAddForm();
    }
    libraryNeedsRefresh = true;
    await refreshAddPatternTemplates();
  await refreshSearchPatternTemplates();
    window.scrollTo({top:0, behavior:'smooth'});
  } catch(e) { setStatus(status, e.message || String(e), 'error'); }
}

function recordContainsSearchParams(recordParams, searchParams) {
  // Treat parameters as a multiset: each searched item must match a distinct
  // stored item, so duplicate searches (for example Shell Up twice) are respected.
  const available = canonicalParams(recordParams || []).map(param => ({ ...param, used:false }));
  const wanted = canonicalParams(searchParams || []);
  return wanted.every(searchParam => {
    const match = available.find(storedParam =>
      !storedParam.used &&
      storedParam.object === searchParam.object &&
      storedParam.direction === searchParam.direction
    );
    if (!match) return false;
    match.used = true;
    return true;
  });
}

async function searchRecords() {
  const status=document.getElementById('searchStatus'), results=document.getElementById('searchResults');
  results.innerHTML='';
  try {
    const idText=String(document.getElementById('searchLibraryId').value || '').trim();
    if (idText) {
      const libraryId=Number(idText);
      if (!Number.isInteger(libraryId) || libraryId < 1 || libraryId > 99999) throw new Error('Library ID must be a whole number from 1 to 99999.');
      const found=await getRecordByLibraryId(libraryId);
      const records=found ? [found] : [];
      setStatus(status, records.length ? `Library ID ${libraryId} found.` : `No entry found for Library ID ${libraryId}.`, records.length?'ok':'');
      renderCards(results, records);
      return;
    }
    const {width,height}=parseGridValue(document.getElementById('searchGridSize').value);
    const params=readParams(document.getElementById('searchParams'));
    if(!params.length) throw new Error('Add at least one search parameter.');
    const gridRecords=await getRecordsForGrid(width,height);
    const records=gridRecords.filter(record => recordContainsSearchParams(record.params, params));
    setStatus(status, `${records.length} partial match${records.length===1?'':'es'} found. Grid size matched exactly.`, records.length?'ok':'');
    renderCards(results, records);
  } catch(e) { setStatus(status, e.message || String(e), 'error'); }
}

async function getAllRecords() { return requestToPromise(tx().getAll()); }
async function renderLibrary(force=false) {
  if (!force && !libraryNeedsRefresh && document.getElementById('libraryGrid').children.length) return;
  const status=document.getElementById('libraryStatus'), grid=document.getElementById('libraryGrid'); grid.innerHTML='';
  try {
    const records=(await getAllMeta()).sort((a,b)=>(Number(a.libraryEntryId)||Number.MAX_SAFE_INTEGER)-(Number(b.libraryEntryId)||Number.MAX_SAFE_INTEGER) || a.id-b.id);
    const albumCount=new Set(records.map(r=>r.albumKey || makeAlbumKey(r.width,r.height))).size;
    setStatus(status, `${records.length} stored image${records.length===1?'':'s'} across ${albumCount} grid album${albumCount===1?'':'s'}. Albums are collapsed for faster loading.`);
    if(!records.length){ grid.innerHTML='<div class="empty-state">No images saved yet. Albums will be created automatically when you add an entry.</div>'; libraryNeedsRefresh=false; return; }
    const albums=new Map();
    records.forEach(rec=>{
      const albumKey=rec.albumKey || makeAlbumKey(rec.width,rec.height);
      const subKey=rec.subAlbumKey || makeSubAlbumKey(rec.params||[]);
      const subLabel=rec.subAlbumLabel || makeSubAlbumLabel(rec.params||[]);
      if(!albums.has(albumKey)) albums.set(albumKey,new Map());
      const subMap=albums.get(albumKey);
      if(!subMap.has(subKey)) subMap.set(subKey,{label:subLabel,records:[]});
      subMap.get(subKey).records.push(rec);
    });
    [...albums.entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).forEach(([albumKey,subMap])=>{
      const album=document.createElement('section'); album.className='album collapsed';
      const total=[...subMap.values()].reduce((n,g)=>n+g.records.length,0);
      const albumHeader=document.createElement('button'); albumHeader.className='album-header';
      albumHeader.innerHTML=`<span><span class="album-icon">▣</span><strong>${albumKey} Grid</strong></span><span class="album-count">${subMap.size} sub-album${subMap.size===1?'':'s'} • ${total} image${total===1?'':'s'} <span class="chevron">▾</span></span>`;
      const albumBody=document.createElement('div'); albumBody.className='album-body';
      let built=false;
      const buildSubalbums=()=>{
        if(built) return; built=true;
        [...subMap.entries()].sort((a,b)=>a[1].label.localeCompare(b[1].label)).forEach(([subKey,group])=>{
          const sub=document.createElement('section'); sub.className='subalbum collapsed';
          const subHeader=document.createElement('button'); subHeader.className='subalbum-header';
          subHeader.innerHTML=`<span><span class="folder-icon">▰</span><strong>${escapeHtml(group.label)}</strong></span><span>${group.records.length} image${group.records.length===1?'':'s'} <span class="chevron">▾</span></span>`;
          const subBody=document.createElement('div'); subBody.className='subalbum-body image-grid';
          const ordered=group.records.sort((a,b)=>(Number(a.libraryEntryId)||Number.MAX_SAFE_INTEGER)-(Number(b.libraryEntryId)||Number.MAX_SAFE_INTEGER) || a.id-b.id);
          let loaded=0;
          const loadNextPage=async()=>{
            const slice=ordered.slice(loaded,loaded+LIBRARY_PAGE_SIZE);
            if(!slice.length) return;
            const full=[];
            for(const meta of slice){ const rec=await requestToPromise(tx().get(meta.id)); if(rec) full.push(rec); }
            renderCards(subBody,full,true);
            loaded += slice.length;
            const old=subBody.querySelector('.load-more-library'); if(old) old.remove();
            if(loaded<ordered.length){
              const more=document.createElement('button'); more.className='secondary load-more-library'; more.textContent=`Load ${Math.min(LIBRARY_PAGE_SIZE,ordered.length-loaded)} more`;
              more.onclick=loadNextPage; subBody.appendChild(more);
            }
          };
          let firstLoad=true;
          subHeader.onclick=async()=>{ sub.classList.toggle('collapsed'); if(!sub.classList.contains('collapsed')&&firstLoad){firstLoad=false; await loadNextPage();} };
          sub.append(subHeader,subBody); albumBody.appendChild(sub);
        });
      };
      albumHeader.onclick=()=>{ album.classList.toggle('collapsed'); if(!album.classList.contains('collapsed')) buildSubalbums(); };
      album.append(albumHeader,albumBody); grid.appendChild(album);
    });
    libraryNeedsRefresh=false;
  } catch(e){ setStatus(status,e.message||String(e),'error'); }
}

function paramText(params) { return params.map(p => `${titleCase(p.object)} → ${titleCase(p.direction)}`).join(', '); }
function renderCards(container, records, allowActions=false) {
  records.forEach(rec => {
    const card=document.createElement('article'); card.className='card';
    card.innerHTML=`<img src="${rec.dataUrl}" alt="${escapeHtml(rec.imageName)}"><div class="card-body"><div class="entry-title"><strong>Library ID ${rec.libraryEntryId || '—'}</strong><span>${escapeHtml(rec.imageName)}</span></div><p><b>Grid:</b> ${rec.width}×${rec.height}</p><p><b>Parameters:</b> ${escapeHtml(paramText(rec.params || []))}</p>${rec.notes?`<p><b>Notes:</b> ${escapeHtml(rec.notes)}</p>`:''}<div class="card-actions"></div></div>`;
    card.querySelector('img').onclick=()=>showModal(rec);
    const actions=card.querySelector('.card-actions');
    const view=document.createElement('button'); view.className='secondary'; view.textContent='View'; view.onclick=()=>showModal(rec); actions.appendChild(view);
    const allowEdit = allowActions || container.id === 'searchResults';
    if(allowEdit){
      const edit=document.createElement('button'); edit.className='secondary'; edit.textContent='Edit'; edit.onclick=()=>editRecord(rec.id); actions.appendChild(edit);
    }
    const allowDownload = allowActions || container.id === 'searchResults';
    if(allowDownload){
      const download=document.createElement('button'); download.className='secondary'; download.textContent='Download'; download.onclick=()=>downloadThumbnail(rec, card.querySelector('img')); actions.appendChild(download);
    }
    const allowDelete = allowActions || container.id === 'searchResults';
    if(allowDelete){
      const del=document.createElement('button'); del.className='danger'; del.textContent='Delete'; del.onclick=async()=>{
        if(!confirmDatasetDelete(rec)) return;
        await deleteRecord(rec.id);
        card.remove();
        await refreshAddPatternTemplates();
        await refreshSearchPatternTemplates();
        if(container.id === 'searchResults') setStatus(document.getElementById('searchStatus'), `Library ID ${rec.libraryEntryId || rec.id} deleted.`);
      }; actions.appendChild(del);
    }
    container.appendChild(card);
  });
}

async function downloadThumbnail(rec, imgEl) {
  try {
    const img = new Image();
    img.src = rec.dataUrl;
    await new Promise((resolve,reject)=>{ img.onload=resolve; img.onerror=reject; });
    const shownW = Math.max(1, imgEl.clientWidth || 320);
    const shownH = Math.max(1, imgEl.clientHeight || 180);
    const targetAspect = shownW / shownH;
    const sourceAspect = img.naturalWidth / img.naturalHeight;
    let sx=0, sy=0, sw=img.naturalWidth, sh=img.naturalHeight;
    if(sourceAspect > targetAspect){
      sw = Math.round(img.naturalHeight * targetAspect);
      sx = Math.round((img.naturalWidth - sw)/2);
    } else if(sourceAspect < targetAspect){
      sh = Math.round(img.naturalWidth / targetAspect);
      sy = Math.round((img.naturalHeight - sh)/2);
    }
    const canvas=document.createElement('canvas'); canvas.width=sw; canvas.height=sh;
    canvas.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
    const png=canvas.toDataURL('image/png');
    const filename=`image-matcher-ID-${rec.libraryEntryId || rec.id}-map.png`;
    if(window.AndroidBridge && typeof AndroidBridge.saveImageBase64 === 'function'){
      const ok=AndroidBridge.saveImageBase64(png,filename);
      if(!ok) throw new Error('Android could not prepare the image for saving.');
    } else {
      const a=document.createElement('a'); a.href=png; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    }
  } catch(e){ alert(`Could not download thumbnail: ${e.message || e}`); }
}

function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function showModal(rec){ document.getElementById('modalImage').src=rec.dataUrl; document.getElementById('modalInfo').innerHTML=`<h3>Library ID ${rec.libraryEntryId || '—'} — ${escapeHtml(rec.imageName)}</h3><p><b>Grid:</b> ${rec.width}×${rec.height}</p><p><b>Parameters:</b> ${escapeHtml(paramText(rec.params))}</p>${rec.notes?`<p><b>Notes:</b> ${escapeHtml(rec.notes)}</p>`:''}`; document.getElementById('modal').classList.remove('hidden'); }

async function exportBackup(){
  const status=document.getElementById('exportStatus');
  try {
    setStatus(status,'Preparing backup…');
    const records=await getAllRecords();
    const definitions=await requestToPromise(definitionTx().getAll());
    const filename=`image-matcher-backup-${new Date().toISOString().slice(0,10)}.json`;
    const metadata={version:6,exportedAt:new Date().toISOString(),objects,directions,gridSizes,theme};

    if(window.AndroidBridge && typeof window.AndroidBridge.beginTextExport==='function'){
      if(!window.AndroidBridge.beginTextExport(filename)) throw new Error('Could not start the Android backup writer.');
      const append = part => {
        const text=String(part);
        const chunkSize=128*1024;
        for(let start=0; start<text.length; ){
          let end=Math.min(start+chunkSize,text.length);
          if(end<text.length){
            const code=text.charCodeAt(end-1);
            if(code>=0xD800 && code<=0xDBFF) end--;
          }
          if(!window.AndroidBridge.appendTextChunk(text.slice(start,end))) throw new Error('The Android backup writer stopped unexpectedly.');
          start=end;
        }
      };
      append('{');
      append(`"version":${JSON.stringify(metadata.version)},`);
      append(`"exportedAt":${JSON.stringify(metadata.exportedAt)},`);
      append(`"objects":${JSON.stringify(metadata.objects)},`);
      append(`"directions":${JSON.stringify(metadata.directions)},`);
      append(`"gridSizes":${JSON.stringify(metadata.gridSizes)},`);
      append(`"theme":${JSON.stringify(metadata.theme)},`);
      append('"definitions":[');
      for(let i=0;i<definitions.length;i++){
        if(i) append(',');
        append(JSON.stringify(definitions[i]));
        if(i % 2 === 0) await new Promise(resolve=>setTimeout(resolve,0));
      }
      append('],"records":[');
      for(let i=0;i<records.length;i++){
        if(i) append(',');
        append(JSON.stringify(records[i]));
        if(i % 3 === 0){
          setStatus(status,`Preparing backup… ${i+1} of ${records.length} records`);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      append(']}');
      if(!window.AndroidBridge.finishTextExport()) throw new Error('Could not finish the Android backup file.');
      setStatus(status,'Backup prepared. Choose where to save it.','ok');
      return;
    }

    const payload={...metadata,definitions,records};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),30000);
    setStatus(status,'Backup download started.','ok');
  } catch(e) {
    if(window.AndroidBridge && typeof window.AndroidBridge.cancelTextExport==='function') window.AndroidBridge.cancelTextExport();
    setStatus(status,e.message || String(e),'error');
  }
}

function readTextFileCompat(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('Choose a backup JSON file.')); return; }
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('The selected backup file could not be read.'));
      reader.onabort = () => reject(new Error('Reading the selected backup file was cancelled.'));
      reader.readAsText(file, 'UTF-8');
    } catch (error) {
      reject(error);
    }
  });
}

// Bounded streaming reader for Android backups.  The important detail is that we
// never join the entire backup into a single JS string.  Large dataUrl images are
// handled one record at a time, keeping WebView below its maximum string length.
class NativeBackupCharStream {
  constructor(status) {
    this.status=status;
    this.chunk='';
    this.pos=0;
    this.eof=false;
    this.totalChars=0;
    this.chunkCount=0;
  }
  async init() {
    if(!window.AndroidBridge ||
       typeof window.AndroidBridge.beginSelectedTextImport !== 'function' ||
       typeof window.AndroidBridge.readSelectedTextChunk !== 'function') {
      throw new Error('Native Android backup reader is unavailable.');
    }
    if(!window.AndroidBridge.beginSelectedTextImport()) {
      throw new Error('Android could not open the selected backup. Please choose the JSON file again.');
    }
  }
  async _fill() {
    if(this.pos < this.chunk.length) return true;
    if(this.eof) return false;
    const next=window.AndroidBridge.readSelectedTextChunk(1024*1024);
    if(next === null || typeof next === 'undefined') {
      this.eof=true;
      this.chunk='';
      this.pos=0;
      return false;
    }
    this.chunk=String(next);
    this.pos=0;
    this.totalChars += this.chunk.length;
    this.chunkCount++;
    if(this.chunkCount % 8 === 0) {
      setStatus(this.status,`Reading backup… ${Math.max(1,Math.round(this.totalChars/1024/1024))} MB`);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return this.chunk.length ? true : this._fill();
  }
  async peek() {
    if(!(await this._fill())) return null;
    return this.chunk[this.pos];
  }
  async next() {
    if(!(await this._fill())) return null;
    return this.chunk[this.pos++];
  }
  close() {
    if(window.AndroidBridge && typeof window.AndroidBridge.finishSelectedTextImport === 'function') {
      window.AndroidBridge.finishSelectedTextImport();
    }
  }
}

async function streamSkipWs(stream) {
  while(true) {
    const c=await stream.peek();
    if(c!==null && /\s/.test(c)) { await stream.next(); continue; }
    return c;
  }
}

async function streamExpect(stream, expected) {
  await streamSkipWs(stream);
  const c=await stream.next();
  if(c!==expected) throw new Error(`Invalid backup structure. Expected "${expected}".`);
}

async function streamReadStringRaw(stream) {
  await streamSkipWs(stream);
  if(!(await stream._fill()) || stream.chunk[stream.pos] !== '"') {
    throw new Error('Invalid backup structure. Expected a JSON string.');
  }

  // Fast path: scan whole native chunks synchronously and append slices instead
  // of awaiting stream.next() for every character.  This is especially
  // important for multi-megabyte Base64 image strings.
  const parts=[];
  let escaped=false;
  let firstChunk=true;
  while(true) {
    if(!(await stream._fill())) throw new Error('Backup ended in the middle of a JSON string.');
    const text=stream.chunk;
    let i=stream.pos;
    const sliceStart=i;
    if(firstChunk) {
      i++; // opening quote
      firstChunk=false;
    }
    for(; i<text.length; i++) {
      const c=text[i];
      if(escaped) { escaped=false; continue; }
      if(c==='\\') { escaped=true; continue; }
      if(c==='"') {
        parts.push(text.slice(sliceStart,i+1));
        stream.pos=i+1;
        return parts.join('');
      }
    }
    parts.push(text.slice(sliceStart));
    stream.pos=text.length;
  }
}

async function streamReadJsonValueRaw(stream) {
  await streamSkipWs(stream);
  if(!(await stream._fill())) throw new Error('Backup ended unexpectedly.');
  const first=stream.chunk[stream.pos];
  if(first==='"') return streamReadStringRaw(stream);

  if(first==='{' || first==='[') {
    const parts=[];
    const stack=[];
    let inString=false, escaped=false;

    while(true) {
      if(!(await stream._fill())) throw new Error('Backup ended in the middle of a JSON value.');
      const text=stream.chunk;
      const sliceStart=stream.pos;
      let i=stream.pos;

      for(; i<text.length; i++) {
        const c=text[i];
        if(inString) {
          if(escaped) { escaped=false; continue; }
          if(c==='\\') { escaped=true; continue; }
          if(c==='"') inString=false;
          continue;
        }
        if(c==='"') { inString=true; continue; }
        if(c==='{' || c==='[') {
          stack.push(c);
          continue;
        }
        if(c==='}' || c===']') {
          const open=stack.pop();
          if((open==='{' && c!=='}') || (open==='[' && c!==']')) {
            throw new Error('Invalid JSON nesting in backup.');
          }
          if(stack.length===0) {
            parts.push(text.slice(sliceStart,i+1));
            stream.pos=i+1;
            return parts.join('');
          }
        }
      }

      parts.push(text.slice(sliceStart));
      stream.pos=text.length;
    }
  }

  // Primitive values are tiny, so the simple character reader is fine here.
  let out='';
  while(true) {
    const c=await stream.peek();
    if(c===null || c===',' || c==='}' || c===']' || /\s/.test(c)) break;
    out += await stream.next();
  }
  if(!out) throw new Error('Invalid JSON value in backup.');
  return out;
}

async function streamReadArray(stream, onItem) {
  await streamExpect(stream,'[');
  await streamSkipWs(stream);
  if(await stream.peek()===']') { await stream.next(); return 0; }
  let count=0;
  while(true) {
    const raw=await streamReadJsonValueRaw(stream);
    let item;
    try { item=JSON.parse(raw); }
    catch(e) { throw new Error('A backup entry is malformed: ' + (e.message||String(e))); }
    await onItem(item,count);
    count++;
    await streamSkipWs(stream);
    const sep=await stream.next();
    if(sep===']') return count;
    if(sep!==',') throw new Error('Invalid backup array structure.');
    if(count % 100 === 0) await new Promise(resolve=>setTimeout(resolve,0));
  }
}

async function importBackupStreaming(status) {
  const stream=new NativeBackupCharStream(status);
  const metadata={};
  let recordCount=0, definitionCount=0;
  const usedIds=new Set();
  const importedRecordGrids=[];
  const IMPORT_BATCH_SIZE=100;
  let storesCleared=false;
  const deferredLibraryMeta=[];
  const deferredDefinitions=[];

  const prepareStores=async()=>{
    if(storesCleared) return;
    await requestToPromise(tx('readwrite').clear());
    await requestToPromise(metaTx('readwrite').clear());
    await requestToPromise(definitionTx('readwrite').clear());
    storesCleared=true;
  };

  try {
    await stream.init();
    await streamExpect(stream,'{');
    await streamSkipWs(stream);
    if(await stream.peek()==='}') throw new Error('Invalid backup file.');

    while(true) {
      const keyRaw=await streamReadStringRaw(stream);
      const key=JSON.parse(keyRaw);
      await streamExpect(stream,':');

      if(key==='records') {
        await prepareStores();
        let recordBatch=[];
        recordCount=await streamReadArray(stream, async (r,i)=>{
          if(!r || typeof r!=='object') throw new Error(`Invalid record at position ${i+1}.`);
          const copy={...r}; delete copy.id;
          const parsed=parseLibraryIdFromNotes(copy.notes);
          copy.notes=parsed.notes;
          let candidate=Number(copy.libraryEntryId || parsed.id);
          if(!Number.isInteger(candidate) || candidate<1 || candidate>99999 || usedIds.has(candidate)) {
            candidate=1; while(usedIds.has(candidate) && candidate<=99999) candidate++;
          }
          copy.libraryEntryId=candidate; usedIds.add(candidate);
          copy.albumKey=copy.albumKey||makeAlbumKey(copy.width,copy.height);
          copy.subAlbumKey=copy.subAlbumKey||makeSubAlbumKey(copy.params||[]);
          copy.subAlbumLabel=copy.subAlbumLabel||makeSubAlbumLabel(copy.params||[]);
          importedRecordGrids.push({width:Number(copy.width),height:Number(copy.height)});
          recordBatch.push(copy);
          if(recordBatch.length>=IMPORT_BATCH_SIZE) {
            const metas=await addRecordsBatch(recordBatch,{rawOnly:true,returnMeta:true});
            deferredLibraryMeta.push(...metas);
            recordBatch=[];
            setStatus(status,`Importing records… ${i+1}`);
          }
        });
        if(recordBatch.length) {
          const metas=await addRecordsBatch(recordBatch,{rawOnly:true,returnMeta:true});
          deferredLibraryMeta.push(...metas);
          recordBatch=[];
          setStatus(status,`Importing records… ${recordCount}`);
        }
      } else if(key==='definitions') {
        await prepareStores();
        definitionCount=await streamReadArray(stream, async definition=>{
          if(definition && definition.objectKey) deferredDefinitions.push(definition);
        });
      } else {
        const raw=await streamReadJsonValueRaw(stream);
        try { metadata[key]=JSON.parse(raw); }
        catch(e) { throw new Error(`Backup field "${key}" is malformed.`); }
      }

      await streamSkipWs(stream);
      const sep=await stream.next();
      if(sep==='}') break;
      if(sep!==',') throw new Error('Invalid backup structure.');
      await streamSkipWs(stream);
    }

    if(!storesCleared) throw new Error('Invalid backup file: records were not found.');

    // Bulk-restore mode: secondary stores are rebuilt once after all heavy record/image writes finish.
    setStatus(status,`Finalizing library index… ${recordCount} records`);
    await rebuildLibraryMetaBulk(deferredLibraryMeta);
    await putDefinitionsBatch(deferredDefinitions);

    if(Array.isArray(metadata.objects)) objects=metadata.objects;
    if(Array.isArray(metadata.directions)) directions=metadata.directions;
    const importedGrids=Array.isArray(metadata.gridSizes)?metadata.gridSizes:[];
    gridSizes=normalizeGridSizes([...DEFAULT_GRID_SIZES,...importedGrids,...importedRecordGrids]);
    if(metadata.theme==='dark' || metadata.theme==='light') applyTheme(metadata.theme);
    persistSettings();

    renderSettings(); refreshGridDropdowns(); refreshParamRows(); renderLibrary(); await renderDatasetDefinitions(); refreshAllParamImages();
    setStatus(status,`Imported ${recordCount} records and ${definitionCount} dataset definition${definitionCount===1?'':'s'}.`,'ok');
  } finally {
    stream.close();
  }
}

async function importBackup(){
  const status=document.getElementById('importStatus'), file=document.getElementById('importInput').files[0];
  try{
    if(!file) throw new Error('Choose a backup JSON file.');
    if(window.AndroidBridge && typeof window.AndroidBridge.beginSelectedTextImport === 'function') {
      await importBackupStreaming(status);
      return;
    }

    // Browser/PWA fallback for smaller backups.
    const raw=await readTextFileCompat(file);
    if(!raw || !raw.trim()) throw new Error('The selected backup could not be read or is empty. Please choose the JSON file again.');
    let data;
    try { data=JSON.parse(raw); }
    catch (parseError) { throw new Error('The selected file is not a complete valid JSON backup. ' + (parseError?.message||'')); }
    if(!Array.isArray(data.records)) throw new Error('Invalid backup file.');
    if(Array.isArray(data.objects)) objects=data.objects;
    if(Array.isArray(data.directions)) directions=data.directions;
    const importedGrids=Array.isArray(data.gridSizes)?data.gridSizes:[];
    const recordGrids=data.records.map(record=>({width:Number(record.width),height:Number(record.height)}));
    gridSizes=normalizeGridSizes([...DEFAULT_GRID_SIZES,...importedGrids,...recordGrids]);
    if(data.theme==='dark' || data.theme==='light') applyTheme(data.theme);
    persistSettings();
    await requestToPromise(tx('readwrite').clear());
    await requestToPromise(metaTx('readwrite').clear());
    const usedIds=new Set();
    for(const r of data.records){
      const copy={...r}; delete copy.id;
      const parsed=parseLibraryIdFromNotes(copy.notes); copy.notes=parsed.notes;
      let candidate=Number(copy.libraryEntryId || parsed.id);
      if(!Number.isInteger(candidate) || candidate<1 || candidate>99999 || usedIds.has(candidate)) { candidate=1; while(usedIds.has(candidate)&&candidate<=99999) candidate++; }
      copy.libraryEntryId=candidate; usedIds.add(candidate);
      copy.albumKey=copy.albumKey||makeAlbumKey(copy.width,copy.height);
      copy.subAlbumKey=copy.subAlbumKey||makeSubAlbumKey(copy.params||[]);
      copy.subAlbumLabel=copy.subAlbumLabel||makeSubAlbumLabel(copy.params||[]);
      await addRecord(copy);
    }
    await requestToPromise(definitionTx('readwrite').clear());
    if(Array.isArray(data.definitions)) for(const definition of data.definitions) if(definition&&definition.objectKey) await requestToPromise(definitionTx('readwrite').put(definition));
    renderSettings(); refreshGridDropdowns(); refreshParamRows(); renderLibrary(); await renderDatasetDefinitions(); refreshAllParamImages();
    setStatus(status,`Imported ${data.records.length} records and ${(data.definitions||[]).length} dataset definition${(data.definitions||[]).length===1?'':'s'}.`,'ok');
  }catch(e){setStatus(status,e.message||String(e),'error');}
}

async function getDefinition(objectName) {
  return requestToPromise(definitionTx().get(normalize(objectName)));
}

async function saveDefinitionImage(objectName, direction, file) {
  const objectKey=normalize(objectName);
  const existing=(await getDefinition(objectName)) || { objectKey, displayName: objectName, baseImage: null, variants: {} };
  existing.displayName=objectName;
  existing.variants=existing.variants || {};
  const image={ name:file.name, type:file.type, updatedAt:new Date().toISOString(), dataUrl:await fileToDataURL(file) };
  if(direction===null) existing.baseImage=image;
  else existing.variants[normalize(direction)]=image;
  await requestToPromise(definitionTx('readwrite').put(existing));
}

async function removeDefinitionImage(objectName, direction) {
  const existing=await getDefinition(objectName);
  if(!existing) return;
  if(direction===null) existing.baseImage=null;
  else if(existing.variants) delete existing.variants[normalize(direction)];
  await requestToPromise(definitionTx('readwrite').put(existing));
}

async function removeDefinitionObject(objectName) {
  await requestToPromise(definitionTx('readwrite').delete(normalize(objectName)));
}

function createDefinitionSlot(objectName, label, direction, image) {
  const slot=document.createElement('div'); slot.className='definition-slot';
  const heading=document.createElement('h4'); heading.textContent=label; slot.appendChild(heading);
  if(image && image.dataUrl){
    const img=document.createElement('img'); img.className='definition-preview'; img.src=image.dataUrl; img.alt=`${objectName} ${label}`; img.onclick=()=>{ document.getElementById('modalImage').src=image.dataUrl; document.getElementById('modalInfo').innerHTML=`<h3>${escapeHtml(objectName)} — ${escapeHtml(label)}</h3>`; document.getElementById('modal').classList.remove('hidden'); }; slot.appendChild(img);
  } else {
    const placeholder=document.createElement('div'); placeholder.className='definition-placeholder'; placeholder.textContent='No picture assigned'; slot.appendChild(placeholder);
  }
  const input=document.createElement('input'); input.type='file'; input.accept='image/*'; input.className='definition-file'; input.capture='environment';
  const actions=document.createElement('div'); actions.className='definition-actions';
  const choose=document.createElement('button'); choose.className='secondary'; choose.textContent=image?'Replace':'Add Photo'; choose.onclick=()=>input.click();
  input.onchange=async()=>{
    const file=input.files && input.files[0]; if(!file) return;
    const status=document.getElementById('definitionStatus');
    try { setStatus(status,`Saving ${objectName} ${label} picture...`); await saveDefinitionImage(objectName,direction,file); await renderDatasetDefinitions(); refreshAllParamImages(); setStatus(status,`${objectName} ${label} picture saved.`,'ok'); }
    catch(e){ setStatus(status,e.message||String(e),'error'); }
  };
  actions.append(choose);
  if(image){
    const remove=document.createElement('button'); remove.className='danger'; remove.textContent='Remove'; remove.onclick=async()=>{ if(confirm(`Remove the ${label} picture for ${objectName}?`)){ await removeDefinitionImage(objectName,direction); await renderDatasetDefinitions(); refreshAllParamImages(); } }; actions.append(remove);
    const note=document.createElement('p'); note.className='definition-note'; note.textContent=image.name || 'Saved image'; slot.append(input,actions,note); return slot;
  }
  slot.append(input,actions); return slot;
}

async function renderDatasetDefinitions(){
  const container=document.getElementById('datasetDefinitions');
  if(!container || !db) return;
  const status=document.getElementById('definitionStatus'); container.innerHTML='';
  try{
    const all=await requestToPromise(definitionTx().getAll());
    const map=new Map(all.map(d=>[d.objectKey,d]));
    if(!objects.length){ container.innerHTML='<div class="empty-state">Add an object above to create its picture definition.</div>'; return; }
    objects.forEach(objectName=>{
      const definition=map.get(normalize(objectName)) || {baseImage:null,variants:{}};
      const card=document.createElement('section'); card.className='definition-card';
      const header=document.createElement('div'); header.className='definition-card-header';
      const title=document.createElement('h3'); title.textContent=objectName;
      const clear=document.createElement('button'); clear.className='danger'; clear.textContent='Clear Pictures'; clear.onclick=async()=>{ if(confirm(`Clear all saved pictures for ${objectName}?`)){ await removeDefinitionObject(objectName); await renderDatasetDefinitions(); refreshAllParamImages(); } };
      header.append(title,clear);
      const body=document.createElement('div'); body.className='definition-body';
      const grid=document.createElement('div'); grid.className='definition-grid';
      grid.appendChild(createDefinitionSlot(objectName,'Base / General',null,definition.baseImage));
      directions.forEach(direction=>grid.appendChild(createDefinitionSlot(objectName,direction,direction,definition.variants && definition.variants[normalize(direction)])));
      body.appendChild(grid); card.append(header,body); container.appendChild(card);
    });
    const savedCount=all.reduce((count,d)=>count+(d.baseImage?1:0)+Object.keys(d.variants||{}).length,0);
    setStatus(status,`${savedCount} dataset picture${savedCount===1?'':'s'} saved across ${all.length} defined object${all.length===1?'':'s'}.`);
  }catch(e){ setStatus(status,e.message||String(e),'error'); }
}


function initUI(){
  refreshGridDropdowns({searchGridSize:'8x10',addGridSize:'8x10'});
  document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{ document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); document.getElementById(btn.dataset.tab).classList.add('active'); if(btn.dataset.tab==='library') renderLibrary(); });
  for(let i=0;i<3;i++){ buildParamRow(document.getElementById('searchParams')); buildParamRow(document.getElementById('addParams')); }
  document.getElementById('addSearchParam').onclick=()=>buildParamRow(document.getElementById('searchParams'));
  document.getElementById('addAddParam').onclick=()=>buildParamRow(document.getElementById('addParams'));
  document.getElementById('addGridSize').addEventListener('change', async()=>{ const template=document.getElementById('addPatternTemplate'); if(template) template.value=''; await refreshAddPatternTemplates(); });
  document.getElementById('addPatternTemplate').addEventListener('change', applyAddPatternTemplate);
  document.getElementById('searchGridSize').addEventListener('change', async()=>{ const template=document.getElementById('searchPatternTemplate'); if(template) template.value=''; await refreshSearchPatternTemplates(); });
  document.getElementById('searchPatternTemplate').addEventListener('change', applySearchPatternTemplate);
  document.getElementById('searchBtn').onclick=searchRecords;
  document.getElementById('saveBtn').onclick=saveImages;
  document.getElementById('cancelEditBtn').onclick=()=>{ resetAddForm(); setStatus(document.getElementById('saveStatus'),''); };
  document.getElementById('refreshLibrary').onclick=()=>renderLibrary(true);
  document.getElementById('exportBtn').onclick=exportBackup;
  document.getElementById('importBtn').onclick=importBackup;
  document.getElementById('refreshDefinitions').onclick=renderDatasetDefinitions;
  const liveStart=document.getElementById('startLiveMatcher');
  const liveStop=document.getElementById('stopLiveMatcher');
  const liveStatus=document.getElementById('liveMatcherStatus');
  if(liveStart) liveStart.onclick=()=>{
    if(window.AndroidBridge && typeof window.AndroidBridge.startLiveMatcher==='function'){
      setStatus(liveStatus,'Starting Live Matcher…');
      const result=window.AndroidBridge.startLiveMatcher();
      if(result==='overlay_permission') setStatus(liveStatus,'Allow “Display over other apps”, return here, then tap Enable Live Matcher again.');
      else if(result==='capture_permission') setStatus(liveStatus,'Approve the Android screen-capture prompt.');
      else setStatus(liveStatus,result||'Live Matcher request sent.');
    }else setStatus(liveStatus,'Live Matcher is available only in the Android app branch.','error');
  };
  if(liveStop) liveStop.onclick=()=>{
    if(window.AndroidBridge && typeof window.AndroidBridge.stopLiveMatcher==='function'){
      window.AndroidBridge.stopLiveMatcher(); setStatus(liveStatus,'Live Matcher stopped.');
    }
  };
  const darkModeToggle=document.getElementById('darkModeToggle');
  if(darkModeToggle) darkModeToggle.onchange=()=>applyTheme(darkModeToggle.checked?'dark':'light');
  applyTheme(theme,false);
  document.getElementById('closeModal').onclick=()=>document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').onclick=e=>{ if(e.target.id==='modal') e.currentTarget.classList.add('hidden'); };
  document.getElementById('imageInput').onchange=e=>{ selectedFiles=[...e.target.files]; const p=document.getElementById('previewArea'); p.innerHTML=''; selectedFiles.forEach(f=>{ const wrapper=document.createElement('div'); wrapper.className='upload-image-preview'; const img=document.createElement('img'); img.src=URL.createObjectURL(f); img.alt=f.name; img.title='Tap to view full size'; img.onclick=()=>{ document.getElementById('modalImage').src=img.src; document.getElementById('modalInfo').innerHTML=`<h3>${escapeHtml(f.name)}</h3>`; document.getElementById('modal').classList.remove('hidden'); }; const caption=document.createElement('p'); caption.textContent=f.name; wrapper.append(img,caption); p.appendChild(wrapper); }); };
  document.getElementById('addObject').onclick=()=>{ const v=document.getElementById('newObject').value.trim(); if(v&&!objects.some(x=>normalize(x)===normalize(v))){objects.push(v); persistSettings(); renderSettings(); refreshParamRows();} document.getElementById('newObject').value=''; };
  document.getElementById('addDirection').onclick=()=>{ const v=document.getElementById('newDirection').value.trim(); if(v&&!directions.some(x=>normalize(x)===normalize(v))){directions.push(v); persistSettings(); renderSettings(); refreshParamRows();} document.getElementById('newDirection').value=''; };
  document.getElementById('addGridSizeButton').onclick=()=>{ try { addGridSizeOption(document.getElementById('newGridWidth').value,document.getElementById('newGridHeight').value); document.getElementById('newGridWidth').value=''; document.getElementById('newGridHeight').value=''; } catch(error) { alert(error.message||String(error)); } };
  renderSettings();
  refreshAddPatternTemplates();
  refreshSearchPatternTemplates();
}

openDB().then(async()=>{ await migrateLibraryIds(); initUI(); }).catch(err=>alert('Could not start local database: '+err));

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'inline-block';
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
});
window.addEventListener('load', () => {
  const installBtn = document.getElementById('installBtn');
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      alert('In Chrome, open the menu and choose “Add to Home screen” or “Install app”.');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.style.display = 'none';
  });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }
});
