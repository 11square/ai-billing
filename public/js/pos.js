// ===== POS / Billing page =====
const Pos = {
  products: [],
  customers: [],
  cart: {},            // productId -> { product, qty }
  discount: 0,
  category: 'All',
  search: '',

  async render(el) {
    el.innerHTML = '<div class="loader"></div>';
    try {
      const [prodRes, custRes] = await Promise.all([
        Api.get('/grocery'),
        Api.get('/customers')
      ]);
      this.products = prodRes.products || [];
      this.customers = custRes || [];
    } catch (e) {
      el.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><h3>Could not load menu</h3><p>${Ui.esc(e.message)}</p></div>`;
      return;
    }

    const cats = ['All', ...new Set(this.products.map(p => p.category))];
    el.innerHTML = `
      <div class="pos">
        <div class="pos-left">
          <div class="toolbar" style="margin-bottom:10px">
            <div class="search-box"><span data-icon="search"></span><input id="pos-search" placeholder="Search menu or scan barcode…" /></div>
            <button class="btn-mic" id="pos-mic" title="Voice billing — say '2 cappuccino and 1 brownie'">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              <span>Voice</span>
            </button>
          </div>
          <div class="cat-chips" id="pos-cats">
            ${cats.map(c => `<button class="cat-chip ${c === this.category ? 'active' : ''}" data-cat="${Ui.esc(c)}">${Ui.catEmoji[c] ? Ui.catEmoji[c] + ' ' : ''}${Ui.esc(c)}</button>`).join('')}
          </div>
          <div class="item-grid" id="pos-grid"></div>
        </div>
        <div class="cart">
          <div class="cart-head">
            <h3>Current Order <button class="cart-clear" id="cart-clear">Clear</button></h3>
            <div class="cart-cust">
              <select id="cart-customer">
                <option value="">🚶 Walk-in customer</option>
                ${this.customers.map(c => `<option value="${c.id}">${Ui.esc(c.name)} · ${Ui.esc(c.phone)}</option>`).join('')}
              </select>
              <button class="btn btn-ghost btn-sm" id="cart-add-cust" title="Add customer"><span data-icon="plus"></span></button>
            </div>
          </div>
          <div class="cart-items" id="cart-items"></div>
          <div class="cart-totals" id="cart-totals"></div>
          <div class="cart-pay">
            <button class="btn btn-primary btn-charge" id="btn-charge">Charge</button>
          </div>
        </div>
      </div>`;
    Ui.hydrateIcons(el);

    el.querySelector('#pos-search').addEventListener('input', e => { this.search = e.target.value.toLowerCase(); this.renderGrid(); });
    el.querySelector('#pos-cats').addEventListener('click', e => {
      const btn = e.target.closest('.cat-chip'); if (!btn) return;
      this.category = btn.dataset.cat;
      el.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('active', c === btn));
      this.renderGrid();
    });
    el.querySelector('#cart-clear').addEventListener('click', () => { this.cart = {}; this.discount = 0; this.renderCart(); this.renderGrid(); });
    el.querySelector('#cart-add-cust').addEventListener('click', () => Customers.openForm(null, async (created) => {
      this.customers.push(created);
      const sel = document.getElementById('cart-customer');
      sel.insertAdjacentHTML('beforeend', `<option value="${created.id}">${Ui.esc(created.name)} · ${Ui.esc(created.phone)}</option>`);
      sel.value = created.id;
    }));
    el.querySelector('#btn-charge').addEventListener('click', () => this.openCheckout());
    el.querySelector('#pos-mic').addEventListener('click', () => Voice.toggle());

    this.renderGrid();
    this.renderCart();
  },

  filtered() {
    return this.products.filter(p => {
      if (this.category !== 'All' && p.category !== this.category) return false;
      if (this.search) {
        const q = this.search;
        return p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q);
      }
      return true;
    });
  },

  renderGrid() {
    const grid = document.getElementById('pos-grid');
    if (!grid) return;
    const items = this.filtered();
    if (!items.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="big">🔍</div><h3>No items found</h3><p>Try another search or category</p></div>';
      return;
    }
    grid.innerHTML = items.map(p => {
      const inCart = this.cart[p.id]?.qty || 0;
      const measured = p.saleMode === 'measured';
      const oos = p.stock <= 0;
      const stockCls = oos ? 'out' : (p.stock <= p.minStock ? 'low' : '');
      return `
        <div class="item-card ${oos ? 'oos' : ''}" data-id="${p.id}">
          ${inCart ? `<div class="item-qty-badge">${inCart}${measured ? 'g' : ''}</div>` : ''}
          ${Ui.imgTag(p.image, p.category, 'item-img')}
          <div class="item-body">
            <div class="item-name">${Ui.esc(p.name)}</div>
            <div class="item-meta">
              <span class="item-price">${Ui.fmt(p.sellingPrice)}${measured ? '<small>/kg</small>' : ''}</span>
              <span class="item-stock ${stockCls}">${oos ? 'Sold out' : measured ? `${p.stock}g left` : `${p.stock} left`}</span>
            </div>
          </div>
        </div>`;
    }).join('');
    grid.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('click', () => this.addToCart(parseInt(card.dataset.id)));
    });
  },

  addToCart(id) {
    const p = this.products.find(x => x.id === id);
    if (!p || p.stock <= 0) return;
    if (p.saleMode === 'measured') {
      this.openWeightEntry(p);
      return;
    }
    const line = this.cart[id] || { product: p, qty: 0 };
    if (line.qty >= p.stock) { Ui.toast(`Only ${p.stock} × ${p.name} in stock`, 'error'); return; }
    line.qty++;
    this.cart[id] = line;
    this.renderCart();
    this.renderGrid();
  },

  openWeightEntry(p) {
    const currentGrams = this.cart[p.id]?.qty || 0;
    const m = Ui.modal({
      title: `Enter weight · ${Ui.esc(p.name)}`,
      body: `
        <div class="weight-product-summary">
          ${Ui.imgTag(p.image, p.category, '')}
          <div><b>${Ui.esc(p.name)}</b><span>${Ui.fmt(p.sellingPrice)} per kg · ${p.stock} g available</span></div>
        </div>
        <div class="field">
          <label>Weight in grams *</label>
          <div class="weight-input-wrap"><input id="weight-grams" type="number" min="1" max="${p.stock}" step="1" value="${currentGrams || ''}" placeholder="e.g. 250" inputmode="numeric"/><span>g</span></div>
        </div>
        <div class="weight-quick">
          ${[100, 250, 500, 1000].filter(grams => grams <= p.stock).map(grams => `<button type="button" class="quick-amt" data-grams="${grams}">${grams === 1000 ? '1 kg' : `${grams} g`}</button>`).join('')}
        </div>
        <div class="pay-summary weight-price-preview">
          <span>Price for this weight</span><strong id="weight-price">${Ui.fmt(0)}</strong>
        </div>`,
      foot: `<button class="btn btn-ghost" id="weight-cancel">Cancel</button>
             ${currentGrams ? '<button class="btn btn-danger" id="weight-remove">Remove Item</button>' : ''}
             <button class="btn btn-primary" id="weight-add">${currentGrams ? 'Update Weight' : 'Add to Order'}</button>`
    });
    const input = m.el.querySelector('#weight-grams');
    const updatePreview = () => {
      const grams = Math.max(0, Number(input.value) || 0);
      m.el.querySelector('#weight-price').textContent = Ui.fmt(grams * Number(p.sellingPrice) / 1000);
    };
    updatePreview();
    input.addEventListener('input', updatePreview);
    m.el.querySelectorAll('[data-grams]').forEach(button => button.addEventListener('click', () => {
      input.value = button.dataset.grams;
      updatePreview();
    }));
    m.el.querySelector('#weight-cancel').addEventListener('click', m.close);
    const removeButton = m.el.querySelector('#weight-remove');
    if (removeButton) removeButton.addEventListener('click', () => {
      delete this.cart[p.id];
      m.close();
      this.renderCart();
      this.renderGrid();
    });
    m.el.querySelector('#weight-add').addEventListener('click', () => {
      const grams = Math.round(Number(input.value));
      if (!grams || grams <= 0) { Ui.toast('Enter the weight in grams', 'error'); return; }
      if (grams > p.stock) { Ui.toast(`Only ${p.stock} g available`, 'error'); return; }
      this.cart[p.id] = { product: p, qty: grams };
      m.close();
      this.renderCart();
      this.renderGrid();
    });
    setTimeout(() => input.focus(), 50);
  },

  changeQty(id, delta) {
    const line = this.cart[id];
    if (!line) return;
    line.qty += delta;
    if (line.qty > line.product.stock) { line.qty = line.product.stock; Ui.toast('Reached available stock', 'error'); }
    if (line.qty <= 0) delete this.cart[id];
    this.renderCart();
    this.renderGrid();
  },

  totals() {
    let sub = 0, count = 0;
    for (const { product, qty } of Object.values(this.cart)) {
      const measured = product.saleMode === 'measured';
      const line = measured ? qty * parseFloat(product.sellingPrice) / 1000 : qty * parseFloat(product.sellingPrice);
      sub += line;
      count += measured ? 1 : qty;
    }
    const disc = Math.min(this.discount || 0, sub);
    return { sub, disc, grand: Math.max(sub - disc, 0), count };
  },

  renderCart() {
    const itemsEl = document.getElementById('cart-items');
    const totEl = document.getElementById('cart-totals');
    if (!itemsEl) return;
    const lines = Object.values(this.cart);

    if (!lines.length) {
      itemsEl.innerHTML = '<div class="cart-empty"><div class="big">🛒</div>Tap items to add them<br/>to the order</div>';
    } else {
      itemsEl.innerHTML = lines.map(({ product: p, qty }) => {
        const measured = p.saleMode === 'measured';
        const lineTotal = measured ? qty * p.sellingPrice / 1000 : qty * p.sellingPrice;
        return `
          <div class="cart-line">
            ${Ui.imgTag(p.image, p.category, '')}
            <div class="cl-info">
              <div class="cl-name">${Ui.esc(p.name)}</div>
              <div class="cl-price">${measured ? `${qty} g · ${Ui.fmt(p.sellingPrice)}/kg` : `${Ui.fmt(p.sellingPrice)}`}</div>
            </div>
            ${measured ? `<button class="btn btn-ghost btn-sm weight-edit-btn" data-weight-id="${p.id}">Edit weight</button>` : `
              <div class="qty-ctrl">
                <button data-id="${p.id}" data-d="-1">−</button>
                <span class="q">${qty}</span>
                <button data-id="${p.id}" data-d="1">+</button>
              </div>`}
            <div class="cl-total">${Ui.fmt(lineTotal)}</div>
          </div>`;
      }).join('');
      itemsEl.querySelectorAll('.qty-ctrl button').forEach(b => {
        b.addEventListener('click', () => this.changeQty(parseInt(b.dataset.id), parseInt(b.dataset.d)));
      });
      itemsEl.querySelectorAll('[data-weight-id]').forEach(button => {
        button.addEventListener('click', () => {
          const product = this.products.find(item => item.id === Number(button.dataset.weightId));
          if (product) this.openWeightEntry(product);
        });
      });
    }

    const t = this.totals();
    totEl.innerHTML = `
      <div class="tot-row"><span>Subtotal (${t.count} items)</span><span>${Ui.fmt(t.sub)}</span></div>
      <div class="tot-row"><span>Discount ₹</span><input class="disc-input" id="disc-input" type="number" min="0" value="${this.discount || ''}" placeholder="0"/></div>
      <div class="tot-row grand"><span>Total</span><span>${Ui.fmt(t.grand)}</span></div>`;
    totEl.querySelector('#disc-input').addEventListener('change', e => {
      this.discount = Math.max(parseFloat(e.target.value) || 0, 0);
      this.renderCart();
    });
    const btn = document.getElementById('btn-charge');
    btn.disabled = !lines.length;
    btn.textContent = lines.length ? `Charge  ${Ui.fmt(t.grand)}` : 'Charge';
  },

  // ---------- checkout ----------
  openCheckout() {
    const t = this.totals();
    if (!t.count) return;
    const custSel = document.getElementById('cart-customer');
    const custId = custSel.value ? parseInt(custSel.value) : null;
    const cust = this.customers.find(c => c.id === custId);
    let orderCustomer = cust || null;
    let method = 'cash';

    const quick = [t.grand, Math.ceil(t.grand / 10) * 10, Math.ceil(t.grand / 50) * 50, Math.ceil(t.grand / 100) * 100]
      .filter((v, i, a) => a.indexOf(v) === i && v > 0).slice(0, 4);

    const m = Ui.modal({
      title: 'Take Payment',
      body: `
        <div class="pay-summary">
          <div class="tot-row"><span>Items</span><span>${t.count}</span></div>
          <div class="tot-row"><span>Customer</span><span>${Ui.esc(cust ? cust.name : 'Walk-in')}</span></div>
          <div class="tot-row grand"><span>Amount due</span><span>${Ui.fmt(t.grand)}</span></div>
        </div>
        <div class="pay-methods" id="pay-methods">
          <button class="pay-m active" data-m="cash"><span class="pm-ic">💵</span>Cash</button>
          <button class="pay-m" data-m="upi"><span class="pm-ic">📱</span>UPI</button>
          <button class="pay-m" data-m="card"><span class="pm-ic">💳</span>Card</button>
          <button class="pay-m" data-m="credit"><span class="pm-ic">📒</span>Credit</button>
        </div>
        <div id="pay-cash-area">
          <div class="field"><label>Cash received</label><input type="number" id="pay-tendered" value="${t.grand.toFixed(2)}" min="0"/></div>
          <div class="pay-amount-row">${quick.map(q => `<button class="quick-amt" data-q="${q}">${Ui.fmt(q)}</button>`).join('')}</div>
          <div class="change-due" id="change-due"></div>
        </div>
        <div id="pay-ref-area" style="display:none">
          <div class="field"><label>Reference / Txn number (optional)</label><input type="text" id="pay-ref" placeholder="UPI ref, card slip no…"/></div>
        </div>
        <div id="pay-credit-area" style="display:none">
          <div class="credit-customer-fields">
            <div class="field">
              <label>Customer name *</label>
              <input type="text" id="credit-customer-name" value="${Ui.esc(cust?.name || '')}" placeholder="Enter customer name" autocomplete="name"/>
            </div>
            <div class="field">
              <label>Mobile number *</label>
              <input type="tel" id="credit-customer-phone" value="${Ui.esc(cust?.phone || '')}" placeholder="10-digit mobile number" inputmode="numeric" maxlength="14" autocomplete="tel"/>
            </div>
            <div class="credit-pay-row">
              <div class="field">
                <label>Amount paid now (optional)</label>
                <input type="number" id="credit-paid-now" value="0" min="0" max="${t.grand.toFixed(2)}" step="0.01" inputmode="decimal"/>
              </div>
              <div class="field">
                <label>Paid by</label>
                <select id="credit-paid-method">
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                </select>
              </div>
            </div>
            <div class="credit-quick">
              <button type="button" class="quick-amt credit-quick-amt" data-credit-q="0">Full credit</button>
              <button type="button" class="quick-amt credit-quick-amt" data-credit-q="${(t.grand * .25).toFixed(2)}">Pay 25%</button>
              <button type="button" class="quick-amt credit-quick-amt" data-credit-q="${(t.grand * .5).toFixed(2)}">Pay 50%</button>
            </div>
            <div class="pay-summary credit-preview" style="margin-bottom:0">
              <div><span>Paid now</span><strong id="credit-paid-preview">${Ui.fmt(0)}</strong></div>
              <div class="credit-due"><span>Added to customer credit</span><strong id="credit-due-preview">${Ui.fmt(t.grand)}</strong></div>
              <small id="credit-help">This balance will appear in the Customers module.</small>
            </div>
          </div>
        </div>`,
      foot: `<button class="btn btn-ghost" id="pay-cancel">Cancel</button>
             <button class="btn btn-green" id="pay-done" style="min-width:180px">Complete Order</button>`
    });

    const tenderedEl = m.el.querySelector('#pay-tendered');
    const changeEl = m.el.querySelector('#change-due');
    const doneBtn = m.el.querySelector('#pay-done');

    const updateChange = () => {
      const tendered = parseFloat(tenderedEl.value) || 0;
      const diff = tendered - t.grand;
      changeEl.className = 'change-due ' + (diff < 0 ? 'neg' : 'pos');
      changeEl.innerHTML = diff < 0
        ? `<span>Remaining (goes to credit)</span><span>${Ui.fmt(-diff)}</span>`
        : `<span>Change to return</span><span>${Ui.fmt(diff)}</span>`;
    };
    updateChange();
    tenderedEl.addEventListener('input', updateChange);
    m.el.querySelectorAll('#pay-cash-area .quick-amt').forEach(b => b.addEventListener('click', () => { tenderedEl.value = b.dataset.q; updateChange(); }));

    const creditPaidEl = m.el.querySelector('#credit-paid-now');
    const creditMethodEl = m.el.querySelector('#credit-paid-method');
    const updateCreditPreview = () => {
      const entered = parseFloat(creditPaidEl.value);
      const paidNow = Number.isFinite(entered) ? Math.max(0, Math.min(entered, t.grand)) : 0;
      const creditDue = Math.max(0, t.grand - paidNow);
      m.el.querySelector('#credit-paid-preview').textContent = Ui.fmt(paidNow);
      m.el.querySelector('#credit-due-preview').textContent = Ui.fmt(creditDue);
      creditMethodEl.disabled = paidNow <= 0;
      m.el.querySelector('#credit-help').textContent = paidNow <= 0
        ? 'The full amount will appear in the Customers module.'
        : `${Ui.fmt(paidNow)} is collected now; only ${Ui.fmt(creditDue)} will be added as credit.`;
    };
    updateCreditPreview();
    creditPaidEl.addEventListener('input', updateCreditPreview);
    m.el.querySelectorAll('.credit-quick-amt').forEach(b => b.addEventListener('click', () => {
      creditPaidEl.value = b.dataset.creditQ;
      updateCreditPreview();
    }));

    m.el.querySelector('#pay-methods').addEventListener('click', e => {
      const btn = e.target.closest('.pay-m'); if (!btn) return;
      method = btn.dataset.m;
      m.el.querySelectorAll('.pay-m').forEach(x => x.classList.toggle('active', x === btn));
      m.el.querySelector('#pay-cash-area').style.display = method === 'cash' ? '' : 'none';
      m.el.querySelector('#pay-ref-area').style.display = (method === 'upi' || method === 'card') ? '' : 'none';
      m.el.querySelector('#pay-credit-area').style.display = method === 'credit' ? '' : 'none';
      doneBtn.disabled = false;
    });

    m.el.querySelector('#pay-cancel').addEventListener('click', m.close);
    doneBtn.addEventListener('click', async () => {
      doneBtn.disabled = true;
      doneBtn.textContent = 'Processing…';
      try {
        const payments = [];
        if (method === 'credit') {
          const name = m.el.querySelector('#credit-customer-name').value.trim();
          let phone = m.el.querySelector('#credit-customer-phone').value.replace(/\D/g, '');
          if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
          if (!name) throw new Error('Customer name is required for credit sales');
          if (!/^\d{10}$/.test(phone)) throw new Error('Enter a valid 10-digit mobile number');

          const paidNow = Number(creditPaidEl.value);
          if (!Number.isFinite(paidNow) || paidNow < 0) throw new Error('Enter a valid amount paid now');
          if (paidNow >= t.grand) throw new Error('For full payment, choose Cash, UPI or Card instead');

          orderCustomer = await Api.post('/customers/resolve', { name, phone });
          if (!this.customers.some(customer => customer.id === orderCustomer.id)) {
            this.customers.push(orderCustomer);
          }
          if (paidNow > 0) {
            payments.push({ amount: Math.round(paidNow * 100) / 100, method: creditMethodEl.value });
          }
        }

        if (method === 'cash') {
          const tendered = parseFloat(tenderedEl.value) || 0;
          const paying = Math.min(tendered, t.grand);
          if (paying > 0) payments.push({ amount: paying, method: 'cash' });
          if (paying < t.grand && !orderCustomer) throw new Error('Partial cash needs a customer selected (for credit balance)');
        } else if (method === 'upi' || method === 'card') {
          payments.push({ amount: t.grand, method, referenceNumber: m.el.querySelector('#pay-ref').value || undefined });
        }

        const body = {
          shopType: 'grocery',
          customerId: orderCustomer?.id,
          customerName: orderCustomer?.name || 'Walk-in',
          customerPhone: orderCustomer?.phone,
          discount: t.disc,
          payments,
          items: Object.values(this.cart).map(({ product: p, qty }) => {
            const measured = p.saleMode === 'measured';
            return {
              productId: p.id,
              productName: p.name,
              quantity: qty,
              unit: measured ? 'g' : p.unit,
              unitPrice: measured ? parseFloat(p.sellingPrice) / 1000 : parseFloat(p.sellingPrice),
              gstRate: 0
            };
          })
        };
        const inv = await Api.post('/invoices', body);
        m.close();
        this.cart = {};
        this.discount = 0;
        Ui.toast(`Order ${inv.invoiceNumber} completed 🎉`);
        this.showReceipt(inv);
        // refresh stock numbers
        const prodRes = await Api.get('/grocery');
        this.products = prodRes.products || [];
        this.renderGrid();
        this.renderCart();
      } catch (e) {
        Ui.toast(e.message, 'error');
        doneBtn.disabled = false;
        doneBtn.textContent = 'Complete Order';
      }
    });
  },

  showReceipt(inv) {
    const m = Ui.modal({
      title: `Receipt · ${Ui.esc(inv.invoiceNumber)}`,
      body: `<div class="receipt-modal-wrap">${Ui.receiptHtml(inv)}</div>`,
      foot: `<button class="btn btn-ghost" id="r-close">New Order</button>
             <button class="btn btn-primary" id="r-print"><span data-icon="print"></span> Print Receipt</button>`
    });
    m.el.querySelector('#r-close').addEventListener('click', m.close);
    m.el.querySelector('#r-print').addEventListener('click', () => Ui.printReceipt(inv));
    if (typeof Settings !== 'undefined' && Settings.get().autoPrint) {
      setTimeout(() => Ui.printReceipt(inv), 300);
    }
  }
};
