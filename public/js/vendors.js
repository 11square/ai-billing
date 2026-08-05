// ===== Vendors, payables and purchase ledger =====
const Vendors = {
  list: [],
  summary: {},
  search: '',
  status: 'active',

  async render(el) {
    el.innerHTML = `
      <div id="vendor-stats" class="stat-grid"><div class="loader"></div></div>
      <div class="toolbar">
        <div class="search-box"><span data-icon="search"></span><input id="vendor-search" placeholder="Search vendor, contact, phone or GSTIN" value="${Ui.esc(this.search)}"/></div>
        <select class="select" id="vendor-status">
          <option value="active" ${this.status === 'active' ? 'selected' : ''}>Active vendors</option>
          <option value="all" ${this.status === 'all' ? 'selected' : ''}>All vendors</option>
        </select>
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="vendor-new-po">New Purchase</button>
        <button class="btn btn-primary" id="vendor-add"><span data-icon="plus"></span> Add Vendor</button>
      </div>
      <div class="card" style="padding:8px 6px"><div id="vendor-table"><div class="loader"></div></div></div>`;
    Ui.hydrateIcons(el);

    let timer;
    el.querySelector('#vendor-search').addEventListener('input', event => {
      this.search = event.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => this.load(), 250);
    });
    el.querySelector('#vendor-status').addEventListener('change', event => {
      this.status = event.target.value;
      this.load();
    });
    el.querySelector('#vendor-add').addEventListener('click', () => this.openForm());
    el.querySelector('#vendor-new-po').addEventListener('click', () => {
      Stock.tab = 'po';
      location.hash = '#stock';
      setTimeout(() => Stock.openPoForm(), 50);
    });
    await this.load();
  },

  async load() {
    const table = document.getElementById('vendor-table');
    if (!table) return;
    table.innerHTML = '<div class="loader"></div>';
    try {
      const query = new URLSearchParams();
      if (this.search.trim()) query.set('search', this.search.trim());
      if (this.status === 'all') query.set('status', 'all');
      const [result, summary] = await Promise.all([
        Api.get(`/vendors${query.toString() ? `?${query}` : ''}`),
        Api.get('/vendors/summary')
      ]);
      this.list = result.vendors || [];
      this.summary = summary || {};
    } catch (error) {
      table.innerHTML = `<div class="empty-state">${Ui.esc(error.message)}</div>`;
      return;
    }
    this.renderStats();
    this.renderTable();
  },

  renderStats() {
    const stats = this.summary;
    const el = document.getElementById('vendor-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="stat-card"><div class="stat-ic tone-blue">V</div><div class="stat-val">${Number(stats.vendorCount) || 0}</div><div class="stat-lbl">Active Vendors</div></div>
      <div class="stat-card"><div class="stat-ic tone-amber">P</div><div class="stat-val">${Ui.fmt(stats.totalPurchases)}</div><div class="stat-lbl">Total Purchases</div></div>
      <div class="stat-card"><div class="stat-ic tone-green">R</div><div class="stat-val">${Ui.fmt(stats.totalPaid)}</div><div class="stat-lbl">Payments Made</div></div>
      <div class="stat-card"><div class="stat-ic tone-red">D</div><div class="stat-val">${Ui.fmt(stats.balance)}</div><div class="stat-lbl">Total Payable</div></div>`;
  },

  renderTable() {
    const table = document.getElementById('vendor-table');
    if (!table) return;
    if (!this.list.length) {
      table.innerHTML = '<div class="empty-state"><div class="big">V</div><h3>No vendors found</h3><p>Add suppliers to track purchases, payments and outstanding balances.</p></div>';
      return;
    }
    table.innerHTML = `
      <table class="tbl vendor-table">
        <thead><tr><th>Vendor</th><th>Contact</th><th>Terms</th><th>Purchases</th><th>Paid</th><th>Balance</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${this.list.map(vendor => {
          const summary = vendor.summary || {};
          const balance = Number(summary.balance) || 0;
          return `<tr class="${vendor.isActive ? '' : 'vendor-inactive'}">
            <td><button class="vendor-name-link" data-view="${vendor.id}">${Ui.esc(vendor.name)}</button>${vendor.contactPerson ? `<div class="muted">${Ui.esc(vendor.contactPerson)}</div>` : ''}${vendor.isActive ? '' : '<div><span class="badge cancelled">Archived</span></div>'}</td>
            <td>${Ui.esc(vendor.phone || '-')}${vendor.email ? `<div class="muted">${Ui.esc(vendor.email)}</div>` : ''}</td>
            <td>${vendor.paymentTermsDays ? `${vendor.paymentTermsDays} days` : 'Due immediately'}${vendor.gstin ? `<div class="muted">${Ui.esc(vendor.gstin)}</div>` : ''}</td>
            <td>${Ui.fmt(summary.totalPurchases)}</td>
            <td>${Ui.fmt(summary.totalPaid)}</td>
            <td>${balance > 0.009 ? `<span class="vendor-balance due">${Ui.fmt(balance)} due</span>` : balance < -0.009 ? `<span class="vendor-balance advance">${Ui.fmt(Math.abs(balance))} advance</span>` : '<span class="badge paid">Clear</span>'}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm" data-view="${vendor.id}">Ledger</button>
              ${vendor.isActive ? `<button class="btn btn-green btn-sm" data-pay="${vendor.id}">Pay</button><button class="btn btn-ghost btn-sm" data-edit="${vendor.id}">Edit</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    table.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => this.view(Number(button.dataset.view))));
    table.querySelectorAll('[data-pay]').forEach(button => button.addEventListener('click', () => this.recordPayment(Number(button.dataset.pay))));
    table.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => this.openForm(this.list.find(v => v.id === Number(button.dataset.edit)))));
  },

  openForm(vendor = null) {
    const editing = Boolean(vendor);
    const modal = Ui.modal({
      title: editing ? `Edit vendor - ${Ui.esc(vendor.name)}` : 'Add Vendor',
      wide: true,
      body: `
        <div class="vendor-form-section">Business details</div>
        <div class="form-grid">
          <div class="field"><label>Vendor / company name *</label><input id="vf-name" value="${Ui.esc(vendor?.name || '')}"/></div>
          <div class="field"><label>Contact person</label><input id="vf-contact" value="${Ui.esc(vendor?.contactPerson || '')}"/></div>
          <div class="field"><label>Phone</label><input id="vf-phone" value="${Ui.esc(vendor?.phone || '')}"/></div>
          <div class="field"><label>Alternate phone</label><input id="vf-alt-phone" value="${Ui.esc(vendor?.alternatePhone || '')}"/></div>
          <div class="field"><label>Email</label><input id="vf-email" type="email" value="${Ui.esc(vendor?.email || '')}"/></div>
          <div class="field"><label>GSTIN / tax number</label><input id="vf-gstin" value="${Ui.esc(vendor?.gstin || '')}"/></div>
          <div class="field"><label>Payment terms (days)</label><input id="vf-terms" type="number" min="0" value="${vendor?.paymentTermsDays || 0}"/></div>
          ${editing ? `<div class="field"><label>Status</label><select id="vf-active"><option value="true" ${vendor.isActive ? 'selected' : ''}>Active</option><option value="false" ${vendor.isActive ? '' : 'selected'}>Archived</option></select></div>` : `<div class="field"><label>Opening payable balance</label><input id="vf-opening" type="number" min="0" step="0.01" value="0"/></div>`}
          <div class="field full"><label>Billing address</label><textarea id="vf-address" rows="2">${Ui.esc(vendor?.address || '')}</textarea></div>
        </div>
        <div class="vendor-form-section">Payment details</div>
        <div class="form-grid">
          <div class="field"><label>Bank name</label><input id="vf-bank" value="${Ui.esc(vendor?.bankName || '')}"/></div>
          <div class="field"><label>Account number</label><input id="vf-account" value="${Ui.esc(vendor?.accountNumber || '')}"/></div>
          <div class="field"><label>IFSC</label><input id="vf-ifsc" value="${Ui.esc(vendor?.ifsc || '')}"/></div>
          <div class="field"><label>UPI ID</label><input id="vf-upi" value="${Ui.esc(vendor?.upiId || '')}"/></div>
          <div class="field full"><label>Notes</label><textarea id="vf-notes" rows="2">${Ui.esc(vendor?.notes || '')}</textarea></div>
        </div>`,
      foot: `<button class="btn btn-ghost" id="vf-cancel">Cancel</button><button class="btn btn-primary" id="vf-save">${editing ? 'Save Changes' : 'Add Vendor'}</button>`
    });
    const field = id => modal.el.querySelector(id);
    field('#vf-cancel').addEventListener('click', modal.close);
    field('#vf-save').addEventListener('click', async () => {
      const body = {
        name: field('#vf-name').value.trim(),
        contactPerson: field('#vf-contact').value.trim(),
        phone: field('#vf-phone').value.trim(),
        alternatePhone: field('#vf-alt-phone').value.trim(),
        email: field('#vf-email').value.trim(),
        gstin: field('#vf-gstin').value.trim(),
        paymentTermsDays: Number(field('#vf-terms').value) || 0,
        address: field('#vf-address').value.trim(),
        bankName: field('#vf-bank').value.trim(),
        accountNumber: field('#vf-account').value.trim(),
        ifsc: field('#vf-ifsc').value.trim(),
        upiId: field('#vf-upi').value.trim(),
        notes: field('#vf-notes').value.trim()
      };
      if (editing) body.isActive = field('#vf-active').value === 'true';
      else body.openingBalance = Number(field('#vf-opening').value) || 0;
      if (!body.name) return Ui.toast('Vendor name is required', 'error');
      try {
        if (editing) await Api.put(`/vendors/${vendor.id}`, body);
        else await Api.post('/vendors', body);
        Ui.toast(editing ? 'Vendor updated' : 'Vendor added');
        modal.close();
        await this.load();
      } catch (error) { Ui.toast(error.message, 'error'); }
    });
  },

  async view(id) {
    let detail;
    try { detail = await Api.get(`/vendors/${id}`); }
    catch (error) { return Ui.toast(error.message, 'error'); }
    const vendor = detail.vendor;
    const summary = detail.summary || {};
    const purchases = detail.purchases || [];
    const ascending = [...(detail.ledger || [])].sort((a, b) => String(a.entryDate).localeCompare(String(b.entryDate)) || a.id - b.id);
    let running = 0;
    const balances = new Map();
    ascending.forEach(entry => {
      running += (entry.direction === 'credit' ? 1 : -1) * Number(entry.amount);
      balances.set(entry.id, running);
    });
    const ledger = [...ascending].reverse();
    const modal = Ui.modal({
      title: Ui.esc(vendor.name),
      wide: true,
      body: `
        <div class="vendor-detail-head">
          <div><div class="vendor-detail-name">${Ui.esc(vendor.name)}</div><div class="muted">${Ui.esc([vendor.contactPerson, vendor.phone, vendor.email].filter(Boolean).join(' | ') || 'No contact details')}</div></div>
          <div class="vendor-detail-balance"><span>Amount payable</span><strong>${Ui.fmt(summary.balance)}</strong></div>
        </div>
        <div class="vendor-mini-stats">
          <div><span>Purchases</span><b>${Ui.fmt(summary.totalPurchases)}</b></div>
          <div><span>Payments</span><b>${Ui.fmt(summary.totalPaid)}</b></div>
          <div><span>Returns / debit notes</span><b>${Ui.fmt(summary.totalReturns)}</b></div>
          <div><span>Terms</span><b>${vendor.paymentTermsDays ? `${vendor.paymentTermsDays} days` : 'Immediate'}</b></div>
        </div>
        <div class="vendor-detail-actions">
          <button class="btn btn-green btn-sm" id="vd-pay">Record Payment</button>
          <button class="btn btn-ghost btn-sm" id="vd-adjust">Add Debit / Credit Note</button>
          <button class="btn btn-ghost btn-sm" id="vd-print">Print Ledger</button>
        </div>
        <div class="rep-tabs vendor-detail-tabs"><button class="rep-tab active" data-tab="ledger">Ledger</button><button class="rep-tab" data-tab="purchases">Purchases (${purchases.length})</button><button class="rep-tab" data-tab="details">Vendor Details</button></div>
        <div id="vd-content">${this.ledgerHtml(ledger, balances)}</div>`,
      foot: `<button class="btn btn-danger" id="vd-archive">Archive Vendor</button><button class="btn btn-ghost" id="vd-edit">Edit Details</button><button class="btn btn-primary" id="vd-close">Close</button>`
    });
    const content = modal.el.querySelector('#vd-content');
    modal.el.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
      modal.el.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button));
      if (button.dataset.tab === 'ledger') content.innerHTML = this.ledgerHtml(ledger, balances);
      else if (button.dataset.tab === 'purchases') content.innerHTML = this.purchasesHtml(purchases);
      else content.innerHTML = this.detailsHtml(vendor);
    }));
    modal.el.querySelector('#vd-pay').addEventListener('click', () => { modal.close(); this.recordPayment(id, detail); });
    modal.el.querySelector('#vd-adjust').addEventListener('click', () => { modal.close(); this.recordAdjustment(id); });
    modal.el.querySelector('#vd-print').addEventListener('click', () => this.printLedger(vendor, summary, ledger, balances));
    modal.el.querySelector('#vd-edit').addEventListener('click', () => { modal.close(); this.openForm(vendor); });
    modal.el.querySelector('#vd-close').addEventListener('click', modal.close);
    modal.el.querySelector('#vd-archive').addEventListener('click', async () => {
      const confirmed = await Ui.confirm('Archive vendor?', 'The vendor will be hidden from new purchases. Existing purchases and ledger entries remain available.', 'Archive');
      if (!confirmed) return;
      try { await Api.del(`/vendors/${id}`); modal.close(); Ui.toast('Vendor archived'); this.load(); }
      catch (error) { Ui.toast(error.message, 'error'); }
    });
  },

  ledgerHtml(entries, balances) {
    if (!entries.length) return '<div class="empty-state" style="padding:32px">No ledger entries yet</div>';
    return `<div class="vendor-ledger-wrap"><table class="tbl vendor-ledger"><thead><tr><th>Date</th><th>Particulars</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${entries.map(entry => `
      <tr><td>${Ui.fmtDate(entry.entryDate)}</td><td><b>${this.entryLabel(entry.entryType)}</b>${entry.notes ? `<div class="muted">${Ui.esc(entry.notes)}</div>` : ''}</td><td>${Ui.esc(entry.referenceNo || '-')}</td><td>${entry.direction === 'debit' ? Ui.fmt(entry.amount) : '-'}</td><td>${entry.direction === 'credit' ? Ui.fmt(entry.amount) : '-'}</td><td><b>${Ui.fmt(balances.get(entry.id))}</b></td></tr>`).join('')}</tbody></table></div>`;
  },

  purchasesHtml(purchases) {
    if (!purchases.length) return '<div class="empty-state" style="padding:32px">No purchases yet</div>';
    return `<table class="tbl"><thead><tr><th>PO</th><th>Bill date</th><th>Vendor bill</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead><tbody>${purchases.map(po => `<tr><td><b>PO-${String(po.id).padStart(4, '0')}</b></td><td>${Ui.fmtDate(po.billDate)}</td><td>${Ui.esc(po.vendorBillNo || '-')}</td><td>${Ui.fmt(po.grandTotal)}</td><td>${Ui.fmt(po.paidAmount)}</td><td><span class="badge ${po.status === 'paid' ? 'paid' : po.status === 'partial' ? 'partial' : 'unpaid'}">${Ui.esc(po.status)}</span></td></tr>`).join('')}</tbody></table>`;
  },

  detailsHtml(vendor) {
    const rows = [
      ['Contact person', vendor.contactPerson], ['Phone', vendor.phone], ['Alternate phone', vendor.alternatePhone],
      ['Email', vendor.email], ['GSTIN / tax number', vendor.gstin], ['Address', vendor.address],
      ['Bank', vendor.bankName], ['Account number', vendor.accountNumber], ['IFSC', vendor.ifsc],
      ['UPI ID', vendor.upiId], ['Notes', vendor.notes]
    ];
    return `<div class="vendor-details-grid">${rows.map(([label, value]) => `<div><span>${label}</span><b>${Ui.esc(value || '-')}</b></div>`).join('')}</div>`;
  },

  async recordPayment(id, loadedDetail = null) {
    let detail = loadedDetail;
    try { if (!detail) detail = await Api.get(`/vendors/${id}`); }
    catch (error) { return Ui.toast(error.message, 'error'); }
    const outstanding = (detail.purchases || []).filter(po => Number(po.grandTotal) - Number(po.paidAmount || 0) > 0.009);
    const currentBalance = Number(detail.summary.balance) || 0;
    const date = new Date().toISOString().slice(0, 10);
    const modal = Ui.modal({
      title: `Record payment - ${Ui.esc(detail.vendor.name)}`,
      body: `
        <div class="pay-summary"><div class="tot-row grand"><span>Current payable</span><span>${Ui.fmt(currentBalance)}</span></div></div>
        <div class="field"><label>Allocate to purchase</label><select id="vp-purchase"><option value="">General payment / advance</option>${outstanding.map(po => `<option value="${po.id}" data-due="${Number(po.grandTotal) - Number(po.paidAmount || 0)}">PO-${String(po.id).padStart(4, '0')} - due ${Ui.fmt(Number(po.grandTotal) - Number(po.paidAmount || 0))}</option>`).join('')}</select></div>
        <div class="form-grid"><div class="field"><label>Amount *</label><input id="vp-amount" type="number" min="0.01" step="0.01" value="${currentBalance > 0 ? currentBalance.toFixed(2) : ''}"/></div><div class="field"><label>Payment date *</label><input id="vp-date" type="date" value="${date}"/></div></div>
        <div class="form-grid"><div class="field"><label>Payment mode</label><select id="vp-mode"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="other">Other</option></select></div><div class="field"><label>Reference no.</label><input id="vp-ref"/></div></div>
        <div class="field"><label>Notes</label><textarea id="vp-notes" rows="2"></textarea></div>`,
      foot: `<button class="btn btn-ghost" id="vp-cancel">Cancel</button><button class="btn btn-green" id="vp-save">Record Payment</button>`
    });
    const get = selector => modal.el.querySelector(selector);
    get('#vp-purchase').addEventListener('change', event => {
      const option = event.target.selectedOptions[0];
      if (option.dataset.due) get('#vp-amount').value = Number(option.dataset.due).toFixed(2);
    });
    get('#vp-cancel').addEventListener('click', modal.close);
    get('#vp-save').addEventListener('click', async () => {
      const body = {
        purchaseId: Number(get('#vp-purchase').value) || null,
        amount: Number(get('#vp-amount').value),
        entryDate: get('#vp-date').value,
        paymentMode: get('#vp-mode').value,
        referenceNo: get('#vp-ref').value.trim(),
        notes: get('#vp-notes').value.trim()
      };
      if (!(body.amount > 0)) return Ui.toast('Enter a valid payment amount', 'error');
      try { await Api.post(`/vendors/${id}/payments`, body); modal.close(); Ui.toast('Vendor payment recorded'); await this.load(); this.view(id); }
      catch (error) { Ui.toast(error.message, 'error'); }
    });
  },

  recordAdjustment(id) {
    const date = new Date().toISOString().slice(0, 10);
    const modal = Ui.modal({
      title: 'Add debit / credit note',
      body: `
        <div class="field"><label>Entry type *</label><select id="va-type"><option value="purchase_return">Purchase return / debit note (reduces payable)</option><option value="debit_adjustment">Debit adjustment (reduces payable)</option><option value="credit_adjustment">Credit adjustment (increases payable)</option></select></div>
        <div class="form-grid"><div class="field"><label>Amount *</label><input id="va-amount" type="number" min="0.01" step="0.01"/></div><div class="field"><label>Date *</label><input id="va-date" type="date" value="${date}"/></div></div>
        <div class="field"><label>Reference no.</label><input id="va-ref"/></div>
        <div class="field"><label>Reason / notes *</label><textarea id="va-notes" rows="3"></textarea></div>
        <p class="form-help">A purchase return here adjusts the vendor payable. Adjust physical stock separately if goods were returned.</p>`,
      foot: `<button class="btn btn-ghost" id="va-cancel">Cancel</button><button class="btn btn-primary" id="va-save">Add Entry</button>`
    });
    const get = selector => modal.el.querySelector(selector);
    get('#va-cancel').addEventListener('click', modal.close);
    get('#va-save').addEventListener('click', async () => {
      const body = { entryType: get('#va-type').value, amount: Number(get('#va-amount').value), entryDate: get('#va-date').value, referenceNo: get('#va-ref').value.trim(), notes: get('#va-notes').value.trim() };
      if (!(body.amount > 0) || !body.notes) return Ui.toast('Amount and reason are required', 'error');
      try { await Api.post(`/vendors/${id}/adjustments`, body); modal.close(); Ui.toast('Ledger entry added'); await this.load(); this.view(id); }
      catch (error) { Ui.toast(error.message, 'error'); }
    });
  },

  entryLabel(type) {
    return ({ opening_balance: 'Opening balance', purchase: 'Purchase', payment: 'Payment', purchase_return: 'Purchase return', credit_adjustment: 'Credit adjustment', debit_adjustment: 'Debit adjustment' })[type] || type;
  },

  printLedger(vendor, summary, entries, balances) {
    Ui.printHtml(`<h2>${Ui.esc(vendor.name)} - Purchase Ledger</h2><p>${Ui.esc([vendor.phone, vendor.gstin].filter(Boolean).join(' | '))}</p><p><b>Balance payable: ${Ui.fmt(summary.balance)}</b></p>${this.ledgerHtml(entries, balances)}`);
  }
};
