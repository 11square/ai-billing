// ===== Dashboard page =====
const Dashboard = {
  chartData: {},
  icons: {
    sales: '<svg viewBox="0 0 24 24"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>',
    orders: '<svg viewBox="0 0 24 24"><path d="M7 3h10l2 4v14H5V7l2-4Z"/><path d="M5 8h14M9 12h6"/></svg>',
    profit: '<svg viewBox="0 0 24 24"><path d="m4 16 5-5 4 4 7-8"/><path d="M14 7h6v6"/></svg>',
    expenses: '<svg viewBox="0 0 24 24"><path d="M12 3v18M16 7.5c0-1.4-1.8-2.5-4-2.5S8 6.1 8 7.5 9.8 10 12 10s4 1.1 4 2.5S14.2 15 12 15s-4-1.1-4-2.5"/></svg>',
    purchase: '<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.4 10.5A2 2 0 0 0 9.3 16h8.9a2 2 0 0 0 1.9-1.5L22 8H6"/></svg>',
    stock: '<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7v10l8 4 8-4V7M12 11v10"/></svg>',
    pending: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    top: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>'
  },

  chart(rows, labelKey = 'label') {
    const max = Math.max(...rows.map(row => Number(row.amount)), 1);
    return rows.map(row => `
      <div class="bar-wrap">
        <div class="bar" style="height:${Math.max((Number(row.amount) / max) * 100, 2)}%" data-val="${Ui.fmt(row.amount)}"></div>
        <div class="bar-lbl">${Ui.esc(row[labelKey])}</div>
      </div>`).join('');
  },

  showChart(type) {
    document.querySelectorAll('.chart-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.chart === type));
    const titles = { daily: 'Today by hour', weekly: 'Last 7 days', monthly: 'Last 6 months' };
    const title = document.getElementById('sales-chart-title');
    const chart = document.getElementById('sales-chart');
    if (title) title.textContent = titles[type];
    if (chart) chart.innerHTML = this.chart(this.chartData[type], type === 'weekly' ? 'day' : 'label');
  },

  async render(el) {
    el.innerHTML = '<div class="loader"></div>';
    let d, daily;
    try {
      [d, daily] = await Promise.all([
        Api.get('/reports/dashboard?shopType=grocery'),
        Api.get('/reports/daily?shopType=grocery')
      ]);
    } catch (e) {
      el.innerHTML = `<div class="empty-state"><div class="big">!</div><h3>Could not load dashboard</h3><p>${Ui.esc(e.message)}</p></div>`;
      return;
    }

    this.chartData = { daily: d.dailyChart || [], weekly: d.weeklyChart || [], monthly: d.monthlyChart || [] };
    const topItem = daily.topProducts[0];
    const cards = [
      ['Sales', Ui.fmt(d.todaySales), 'sales', 'green', 'Revenue today'],
      ['Orders', d.todayInvoiceCount, 'orders', 'blue', 'Bills created today'],
      ['Profit', Ui.fmt(d.todayProfit), 'profit', 'green', 'After product cost'],
      ['Expenses', Ui.fmt(d.todayExpenses), 'expenses', 'red', 'Cost of goods sold']
    ];
    const quickFacts = [
      ['Purchase', Ui.fmt(d.todayPurchase), 'purchase', 'Supplier bills today'],
      ['Stock value', Ui.fmt(d.stockValue), 'stock', `${d.lowStockCount} low stock item${d.lowStockCount === 1 ? '' : 's'}`],
      ['Pending orders', d.pendingOrderCount, 'pending', `${Ui.fmt(d.totalPendingDues)} due`],
      ['Top item', topItem ? Ui.esc(topItem.name) : 'No sales yet', 'top', topItem ? `${topItem.quantity} sold today` : 'Waiting for first order']
    ];

    const recent = d.recentInvoices.length ? d.recentInvoices.map(inv => `
      <tr><td><b>${Ui.esc(inv.invoiceNumber)}</b><div class="muted">${Ui.fmtDate(inv.createdAt)} &middot; ${Ui.fmtTime(inv.createdAt)}</div></td>
      <td>${Ui.esc(inv.customerName)}</td><td><b>${Ui.fmt(inv.grandTotal)}</b></td>
      <td><span class="badge ${inv.paymentStatus}">${inv.paymentStatus}</span></td></tr>`).join('')
      : '<tr><td colspan="4" class="dashboard-empty">No orders yet. Create the first bill from POS.</td></tr>';

    const top = daily.topProducts.length ? daily.topProducts.slice(0, 5).map((p, i) => `
      <div class="list-row"><span><span class="rank">${i + 1}</span>${Ui.esc(p.name)}</span>
      <span><b>${p.quantity}</b> sold &middot; ${Ui.fmt(p.total)}</span></div>`).join('')
      : '<div class="dashboard-empty">Nothing sold today yet.</div>';

    el.innerHTML = `
      <div class="dashboard-section-head"><div><span class="eyebrow">TODAY</span><h2>Overview</h2></div><span class="live-pill"><i></i> Live</span></div>
      <div class="dashboard-stat-grid">${cards.map(([label, value, icon, tone, note]) => `
        <article class="dashboard-stat tone-border-${tone}"><div class="stat-top"><div class="stat-ic tone-${tone}">${this.icons[icon]}</div><span class="stat-note">${note}</span></div><div class="stat-lbl">${label}</div><div class="stat-val">${value}</div></article>`).join('')}</div>
      <div class="dashboard-quick-strip">${quickFacts.map(([label, value, icon, note]) => `
        <div class="quick-fact"><span class="quick-icon">${this.icons[icon]}</span><div class="quick-copy"><span>${label}</span><strong title="${value}">${value}</strong><small>${note}</small></div></div>`).join('')}</div>
      <div class="grid-2 dashboard-grid">
        <div class="card sales-card"><div class="dashboard-card-head"><div><span class="card-kicker">SALES TREND</span><h3 id="sales-chart-title">Last 7 days</h3></div><div class="chart-tabs">
          <button class="chart-tab" data-chart="daily">Daily</button><button class="chart-tab active" data-chart="weekly">Weekly</button><button class="chart-tab" data-chart="monthly">Monthly</button>
        </div></div><div class="chart chart-grid" id="sales-chart">${this.chart(this.chartData.weekly, 'day')}</div></div>
        <div class="card top-products-card"><div class="dashboard-card-head"><div><span class="card-kicker">TODAY</span><h3>Top selling items</h3></div><a href="#reports">View report &rarr;</a></div>${top}</div>
      </div>
      <div class="card recent-card"><div class="dashboard-card-head"><div><span class="card-kicker">LATEST ACTIVITY</span><h3>Recent orders</h3></div><a href="#invoices">View all &rarr;</a></div>
        <table class="tbl"><thead><tr><th>Invoice</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody>${recent}</tbody></table></div>`;

    el.querySelectorAll('.chart-tab').forEach(tab => tab.addEventListener('click', () => this.showChart(tab.dataset.chart)));
  }
};
