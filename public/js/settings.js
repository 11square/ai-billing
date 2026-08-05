// ===== Bill / Receipt & Printer settings =====
const Settings = {
  KEY: 'ab_bill_settings',

  defaults: {
    businessName: 'AI Bill',
    logoText: '🍞',
    showLogo: true,
    tagline: 'POS & Inventory',
    address: '',
    phone: '98765 43210',
    gstin: '33ABCDE1234F1Z5',
    showGstin: true,
    footer: 'Thank you! Visit again ☕',
    paperWidth: '80',   // '58' | '80'
    fontSize: 12,
    showCustomer: true,
    autoPrint: false
  },

  get() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      return { ...this.defaults, ...saved };
    } catch {
      return { ...this.defaults };
    }
  },

  save(patch) {
    const merged = { ...this.get(), ...patch };
    localStorage.setItem(this.KEY, JSON.stringify(merged));
    return merged;
  },

  reset() {
    localStorage.removeItem(this.KEY);
  },

  // ---------- page ----------
  render(el) {
    const s = this.get();
    el.innerHTML = `
      <div class="settings-layout">
        <div class="card settings-form">
          <h3 class="settings-h">🧾 Bill header</h3>
          <div class="form-grid">
            <div class="field"><label>Business name *</label><input id="st-name" value="${Ui.esc(s.businessName)}"/></div>
            <div class="field"><label>Logo / emoji</label><input id="st-logo" value="${Ui.esc(s.logoText)}" placeholder="🍞"/></div>
            <div class="field full"><label>Tagline</label><input id="st-tagline" value="${Ui.esc(s.tagline)}" placeholder="POS & Inventory"/></div>
            <div class="field full"><label>Address</label><textarea id="st-address" rows="2" placeholder="Shop no, street, city">${Ui.esc(s.address)}</textarea></div>
            <div class="field"><label>Phone</label><input id="st-phone" value="${Ui.esc(s.phone)}"/></div>
            <div class="field"><label>GSTIN</label><input id="st-gstin" value="${Ui.esc(s.gstin)}"/></div>
            <div class="field full"><label>Footer message</label><input id="st-footer" value="${Ui.esc(s.footer)}" placeholder="Thank you! Visit again"/></div>
          </div>

          <h3 class="settings-h">🖨️ Printer</h3>
          <div class="form-grid">
            <div class="field"><label>Paper width</label>
              <select id="st-paper">
                <option value="58" ${s.paperWidth === '58' ? 'selected' : ''}>58 mm (small thermal)</option>
                <option value="80" ${s.paperWidth === '80' ? 'selected' : ''}>80 mm (standard thermal)</option>
              </select>
            </div>
            <div class="field"><label>Font size (px)</label>
              <select id="st-font">
                ${[10, 11, 12, 13, 14].map(f => `<option value="${f}" ${Number(s.fontSize) === f ? 'selected' : ''}>${f}px</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="settings-toggles">
            <label class="st-check"><input type="checkbox" id="st-showlogo" ${s.showLogo ? 'checked' : ''}/> Show logo / emoji</label>
            <label class="st-check"><input type="checkbox" id="st-showgstin" ${s.showGstin ? 'checked' : ''}/> Show GSTIN on bill</label>
            <label class="st-check"><input type="checkbox" id="st-showcust" ${s.showCustomer ? 'checked' : ''}/> Show customer name</label>
            <label class="st-check"><input type="checkbox" id="st-autoprint" ${s.autoPrint ? 'checked' : ''}/> Auto-print after each sale</label>
          </div>

          <div class="settings-actions">
            <button class="btn btn-ghost" id="st-reset">Reset to defaults</button>
            <button class="btn btn-ghost" id="st-test"><span data-icon="print"></span> Print test bill</button>
            <button class="btn btn-primary" id="st-save">Save settings</button>
          </div>
        </div>

        <div class="settings-preview">
          <div class="settings-h">Live preview</div>
          <div class="receipt-modal-wrap" id="st-preview"></div>
        </div>
      </div>`;

    Ui.hydrateIcons(el);
    const $ = sel => el.querySelector(sel);

    const collect = () => ({
      businessName: $('#st-name').value.trim() || 'Business',
      logoText: $('#st-logo').value.trim(),
      tagline: $('#st-tagline').value.trim(),
      address: $('#st-address').value.trim(),
      phone: $('#st-phone').value.trim(),
      gstin: $('#st-gstin').value.trim(),
      footer: $('#st-footer').value.trim(),
      paperWidth: $('#st-paper').value,
      fontSize: parseInt($('#st-font').value, 10) || 12,
      showLogo: $('#st-showlogo').checked,
      showGstin: $('#st-showgstin').checked,
      showCustomer: $('#st-showcust').checked,
      autoPrint: $('#st-autoprint').checked
    });

    const preview = () => {
      $('#st-preview').innerHTML = Ui.receiptHtml(this.sampleInvoice(), collect());
    };
    preview();
    el.querySelectorAll('input, select, textarea').forEach(input => {
      input.addEventListener('input', preview);
      input.addEventListener('change', preview);
    });

    $('#st-save').addEventListener('click', () => {
      this.save(collect());
      Ui.toast('Bill settings saved');
    });

    $('#st-test').addEventListener('click', () => {
      Ui.printReceipt(this.sampleInvoice(), collect());
    });

    $('#st-reset').addEventListener('click', async () => {
      if (!await Ui.confirm('Reset settings', 'Restore all bill and printer settings to their defaults?', 'Reset')) return;
      this.reset();
      this.render(el);
      Ui.toast('Settings reset to defaults');
    });
  },

  sampleInvoice() {
    return {
      invoiceNumber: 'AB-PREVIEW-001',
      created_at: Date.now(),
      customerName: 'Walk-in',
      subTotal: 260,
      discount: 10,
      grandTotal: 250,
      paidAmount: 250,
      paymentStatus: 'paid',
      items: [
        { productName: 'Cappuccino', quantity: 2, unit: 'cup', unitPrice: 90, totalPrice: 180 },
        { productName: 'Egg Puff', quantity: 4, unit: 'piece', unitPrice: 20, totalPrice: 80 }
      ],
      payments: [{ method: 'cash', amount: 250 }]
    };
  }
};
