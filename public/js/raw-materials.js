// ===== Raw-material inventory =====
const RawMaterials = {
  materials: [],
  vendors: [],
  search: '',
  filter: 'all',

  async render(el) {
    el.innerHTML = `
      <div id="raw-stats" class="stat-grid"><div class="loader"></div></div>
      <div class="toolbar">
        <div class="search-box"><span data-icon="search"></span><input id="raw-search" placeholder="Search raw materials" value="${Ui.esc(this.search)}"/></div>
        <select id="raw-filter" class="select"><option value="all">All stock</option><option value="low" ${this.filter === 'low' ? 'selected' : ''}>Low stock</option><option value="out" ${this.filter === 'out' ? 'selected' : ''}>Out of stock</option></select>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="raw-add"><span data-icon="plus"></span> Add Raw Material</button>
      </div>
      <div class="card" style="padding:8px 6px"><div id="raw-table"><div class="loader"></div></div></div>`;
    Ui.hydrateIcons(el);
    let timer;
    el.querySelector('#raw-search').addEventListener('input', event => {
      this.search = event.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => this.load(), 250);
    });
    el.querySelector('#raw-filter').addEventListener('change', event => { this.filter = event.target.value; this.drawTable(); });
    el.querySelector('#raw-add').addEventListener('click', () => this.openForm());
    await this.load();
  },

  async load() {
    const table = document.getElementById('raw-table');
    if (!table) return;
    table.innerHTML = '<div class="loader"></div>';
    try {
      const query = this.search.trim() ? `?search=${encodeURIComponent(this.search.trim())}` : '';
      const [result, summary, vendors] = await Promise.all([
        Api.get(`/raw-materials${query}`),
        Api.get('/raw-materials/summary'),
        Api.get('/vendors')
      ]);
      this.materials = result.materials || [];
      this.vendors = vendors.vendors || [];
      this.drawStats(summary);
      this.drawTable();
    } catch (error) {
      table.innerHTML = `<div class="empty-state">${Ui.esc(error.message)}</div>`;
    }
  },

  drawStats(summary) {
    const el = document.getElementById('raw-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="stat-card"><div class="stat-ic tone-blue">RM</div><div class="stat-val">${summary.totalMaterials || 0}</div><div class="stat-lbl">Raw Materials</div></div>
      <div class="stat-card"><div class="stat-ic tone-green">SV</div><div class="stat-val">${Ui.fmt(summary.stockValue)}</div><div class="stat-lbl">Raw Stock Value</div></div>
      <div class="stat-card"><div class="stat-ic tone-amber">LS</div><div class="stat-val">${summary.lowStockCount || 0}</div><div class="stat-lbl">Low Stock</div></div>
      <div class="stat-card"><div class="stat-ic tone-red">OS</div><div class="stat-val">${summary.outOfStockCount || 0}</div><div class="stat-lbl">Out of Stock</div></div>`;
  },

  drawTable() {
    const table = document.getElementById('raw-table');
    if (!table) return;
    const items = this.materials.filter(item => {
      if (this.filter === 'out') return Number(item.stock) <= 0;
      if (this.filter === 'low') return Number(item.stock) <= Number(item.minStock);
      return true;
    });
    if (!items.length) {
      table.innerHTML = '<div class="empty-state"><div class="big">RM</div><h3>No raw materials found</h3><p>Add ingredients such as flour, milk, sugar, butter and packaging.</p></div>';
      return;
    }
    table.innerHTML = `<table class="tbl raw-material-table"><thead><tr><th>Material</th><th>Available</th><th>Minimum</th><th>Average Cost</th><th>Stock Value</th><th>Used In</th><th style="text-align:right">Actions</th></tr></thead><tbody>${items.map(item => {
      const stock = Number(item.stock);
      const low = stock <= Number(item.minStock);
      return `<tr>
        <td><b>${Ui.esc(item.name)}</b><div class="muted">${Ui.esc(item.category || 'Uncategorised')}${item.sku ? ` | ${Ui.esc(item.sku)}` : ''}</div></td>
        <td><b>${this.qty(stock)} ${Ui.esc(item.unit)}</b><div>${stock <= 0 ? '<span class="badge unpaid">Out</span>' : low ? '<span class="badge partial">Low</span>' : '<span class="badge paid">Healthy</span>'}</div></td>
        <td>${this.qty(item.minStock)} ${Ui.esc(item.unit)}</td>
        <td>${Ui.fmt(item.costPerUnit)} / ${Ui.esc(item.unit)}</td>
        <td><b>${Ui.fmt(stock * Number(item.costPerUnit))}</b></td>
        <td>${(item.usedIn || []).length ? `<span class="raw-recipe-count">${item.usedIn.length} recipe${item.usedIn.length === 1 ? '' : 's'}</span><div class="muted">${Ui.esc(item.usedIn.slice(0, 2).map(p => p.name).join(', '))}</div>` : '<span class="muted">Not linked</span>'}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn btn-primary btn-sm" data-buy="${item.id}">Buy</button><button class="btn btn-ghost btn-sm" data-adjust="${item.id}">Adjust</button><button class="btn btn-ghost btn-sm" data-history="${item.id}">History</button><button class="btn btn-ghost btn-sm" data-edit="${item.id}">Edit</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;
    table.querySelectorAll('[data-buy]').forEach(button => button.addEventListener('click', () => {
      const item = this.materials.find(material => material.id === Number(button.dataset.buy));
      Stock.openPoForm({ ...item, itemKind: 'raw_material', rawMaterialId: item.id });
    }));
    table.querySelectorAll('[data-adjust]').forEach(button => button.addEventListener('click', () => this.adjust(this.materials.find(item => item.id === Number(button.dataset.adjust)))));
    table.querySelectorAll('[data-history]').forEach(button => button.addEventListener('click', () => this.history(this.materials.find(item => item.id === Number(button.dataset.history)))));
    table.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => this.openForm(this.materials.find(item => item.id === Number(button.dataset.edit)))));
  },

  openForm(material = null) {
    const editing = Boolean(material);
    const modal = Ui.modal({
      title: editing ? `Edit raw material - ${Ui.esc(material.name)}` : 'Add Raw Material',
      wide: true,
      body: `<div class="form-grid">
        <div class="field"><label>Material name *</label><input id="rm-name" value="${Ui.esc(material?.name || '')}" placeholder="e.g. Maida flour"/></div>
        <div class="field"><label>Category</label><input id="rm-category" value="${Ui.esc(material?.category || '')}" placeholder="Flour, Dairy, Packaging"/></div>
        <div class="field"><label>SKU / code</label><input id="rm-sku" value="${Ui.esc(material?.sku || '')}"/></div>
        <div class="field"><label>Stock unit *</label><select id="rm-unit">${['g', 'kg', 'ml', 'L', 'piece', 'pack'].map(unit => `<option value="${unit}" ${unit === (material?.unit || 'kg') ? 'selected' : ''}>${unit}</option>`).join('')}</select></div>
        ${editing ? '' : '<div class="field"><label>Opening stock</label><input id="rm-opening" type="number" min="0" step="0.001" value="0"/></div>'}
        <div class="field"><label>Minimum stock alert</label><input id="rm-min" type="number" min="0" step="0.001" value="${Number(material?.minStock || 0)}"/></div>
        <div class="field"><label>Cost per stock unit</label><input id="rm-cost" type="number" min="0" step="0.0001" value="${Number(material?.costPerUnit || 0)}"/></div>
        <div class="field"><label>Default vendor</label><select id="rm-vendor"><option value="">No default vendor</option>${this.vendors.map(v => `<option value="${v.id}" ${Number(material?.vendorId) === v.id ? 'selected' : ''}>${Ui.esc(v.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Expiry date</label><input id="rm-expiry" type="date" value="${Ui.esc(material?.expiryDate || '')}"/></div>
        <div class="field full"><label>Notes</label><textarea id="rm-notes" rows="2">${Ui.esc(material?.notes || '')}</textarea></div>
      </div>`,
      foot: `${editing ? '<button class="btn btn-danger" id="rm-archive">Archive</button>' : ''}<button class="btn btn-ghost" id="rm-cancel">Cancel</button><button class="btn btn-primary" id="rm-save">${editing ? 'Save Changes' : 'Add Material'}</button>`
    });
    const get = selector => modal.el.querySelector(selector);
    get('#rm-cancel').addEventListener('click', modal.close);
    get('#rm-save').addEventListener('click', async () => {
      const body = {
        name: get('#rm-name').value.trim(), category: get('#rm-category').value.trim(), sku: get('#rm-sku').value.trim(), unit: get('#rm-unit').value,
        minStock: Number(get('#rm-min').value) || 0, costPerUnit: Number(get('#rm-cost').value) || 0, vendorId: Number(get('#rm-vendor').value) || null,
        expiryDate: get('#rm-expiry').value || null, notes: get('#rm-notes').value.trim()
      };
      if (!editing) body.openingStock = Number(get('#rm-opening').value) || 0;
      if (!body.name) return Ui.toast('Material name is required', 'error');
      try { if (editing) await Api.put(`/raw-materials/${material.id}`, body); else await Api.post('/raw-materials', body); modal.close(); Ui.toast(editing ? 'Raw material updated' : 'Raw material added'); this.load(); }
      catch (error) { Ui.toast(error.message, 'error'); }
    });
    if (editing) get('#rm-archive').addEventListener('click', async () => {
      const confirmed = await Ui.confirm('Archive raw material?', 'It will be hidden from inventory and new recipes. Movement history will be retained.', 'Archive');
      if (!confirmed) return;
      try { await Api.del(`/raw-materials/${material.id}`); modal.close(); Ui.toast('Raw material archived'); this.load(); }
      catch (error) { Ui.toast(error.message, 'error'); }
    });
  },

  adjust(material) {
    const modal = Ui.modal({
      title: `Stock movement - ${Ui.esc(material.name)}`,
      body: `<div class="pay-summary"><div class="tot-row grand"><span>Available</span><span>${this.qty(material.stock)} ${Ui.esc(material.unit)}</span></div></div>
        <div class="field"><label>Movement *</label><select id="ra-type"><option value="purchase">Purchase / stock received</option><option value="adjustment_in">Positive adjustment</option><option value="adjustment_out">Negative adjustment</option><option value="wastage">Wastage / spoilage</option><option value="return_to_vendor">Return to vendor</option></select></div>
        <div class="form-grid"><div class="field"><label>Quantity (${Ui.esc(material.unit)}) *</label><input id="ra-qty" type="number" min="0.001" step="0.001"/></div><div class="field"><label>Cost per ${Ui.esc(material.unit)}</label><input id="ra-cost" type="number" min="0" step="0.0001" value="${Number(material.costPerUnit)}"/></div></div>
        <div class="field"><label>Notes</label><textarea id="ra-notes" rows="2" placeholder="Invoice, reason or reference"></textarea></div>`,
      foot: '<button class="btn btn-ghost" id="ra-cancel">Cancel</button><button class="btn btn-primary" id="ra-save">Save Movement</button>'
    });
    const get = selector => modal.el.querySelector(selector);
    get('#ra-cancel').addEventListener('click', modal.close);
    get('#ra-save').addEventListener('click', async () => {
      const body = { movementType: get('#ra-type').value, quantity: Number(get('#ra-qty').value), unitCost: Number(get('#ra-cost').value) || 0, notes: get('#ra-notes').value.trim() };
      if (!(body.quantity > 0)) return Ui.toast('Enter a valid quantity', 'error');
      try { await Api.post(`/raw-materials/${material.id}/adjustments`, body); modal.close(); Ui.toast('Raw-material stock updated'); this.load(); }
      catch (error) { Ui.toast(error.message, 'error'); }
    });
  },

  async history(material) {
    let result;
    try { result = await Api.get(`/raw-materials/${material.id}/movements`); }
    catch (error) { return Ui.toast(error.message, 'error'); }
    const movements = result.movements || [];
    Ui.modal({
      title: `${Ui.esc(material.name)} - Stock History`,
      wide: true,
      body: movements.length ? `<div class="raw-history"><table class="tbl"><thead><tr><th>Date</th><th>Movement</th><th>In</th><th>Out</th><th>Balance</th><th>Notes</th></tr></thead><tbody>${movements.map(move => `<tr><td>${Ui.fmtDate(move.created_at)}</td><td><b>${this.movementLabel(move.movementType)}</b></td><td>${move.direction === 'in' ? `${this.qty(move.quantity)} ${Ui.esc(material.unit)}` : '-'}</td><td>${move.direction === 'out' ? `${this.qty(move.quantity)} ${Ui.esc(material.unit)}` : '-'}</td><td><b>${this.qty(move.balanceAfter)} ${Ui.esc(material.unit)}</b></td><td class="muted">${Ui.esc(move.notes || '-')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state" style="padding:32px">No stock movements yet</div>'
    });
  },

  movementLabel(type) {
    return ({ opening: 'Opening stock', purchase: 'Purchase', adjustment_in: 'Adjustment in', adjustment_out: 'Adjustment out', production_use: 'Production use', wastage: 'Wastage', return_to_vendor: 'Vendor return' })[type] || type;
  },

  qty(value) { return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 }); }
};
