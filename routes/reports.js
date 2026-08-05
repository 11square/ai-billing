const express = require('express');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Invoice, InvoiceItem } = require('../models/Invoice');
const { Purchase } = require('../models/Purchase');
const GroceryProduct = require('../models/GroceryProduct');
const FertilizerProduct = require('../models/FertilizerProduct');
const { RawMaterial } = require('../models/RawMaterial');
const { auth } = require('../middleware/auth');
const { DailyReport } = require('../models/Report');
const reportService = require('../services/reportService');

const router = express.Router();

// ===== Generated daily reports =====

// @route   GET /api/reports/schedule — current auto-generation time
router.get('/schedule', auth, async (req, res) => {
  try {
    res.json({ time: await reportService.getReportTime() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/reports/schedule — set auto-generation time (HH:MM)
router.put('/schedule', auth, async (req, res) => {
  try {
    const time = await reportService.setReportTime(req.body.time);
    res.json({ time });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   POST /api/reports/generate — { date } or { start, end }
router.post('/generate', auth, async (req, res) => {
  try {
    const report = await reportService.generateAndSave(req.body, 'manual');
    res.status(201).json(report);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   GET /api/reports/generated — list saved reports
router.get('/generated', auth, async (req, res) => {
  try {
    const reports = await DailyReport.findAll({
      order: [['created_at', 'DESC']],
      limit: 60
    });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/generated/:id
router.get('/generated/:id', auth, async (req, res) => {
  try {
    const report = await DailyReport.findByPk(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/daily
router.get('/daily', auth, async (req, res) => {
  try {
    const { date, shopType } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    let where = {
      created_at: { [Op.between]: [startOfDay, endOfDay] }
    };

    if (shopType) {
      where.shopType = shopType;
    }

    const invoices = await Invoice.findAll({ where });

    const totalSales = invoices.reduce((sum, inv) => sum + parseFloat(inv.grandTotal), 0);
    const invoiceCount = invoices.length;
    const gstCollected = invoices.reduce((sum, inv) => sum + parseFloat(inv.gstAmount), 0);
    const cashSales = invoices.filter(i => i.paymentStatus === 'paid').reduce((sum, inv) => sum + parseFloat(inv.paidAmount), 0);
    const creditSales = invoices.filter(i => i.paymentStatus !== 'paid').reduce((sum, inv) => sum + (parseFloat(inv.grandTotal) - parseFloat(inv.paidAmount)), 0);

    // Top products
    const items = await InvoiceItem.findAll({
      include: [{
        model: Invoice,
        where,
        attributes: []
      }],
      attributes: [
        'productName',
        [sequelize.fn('SUM', sequelize.col('quantity')), 'quantity'],
        [sequelize.fn('SUM', sequelize.col('total_price')), 'total']
      ],
      group: ['productName'],
      order: [[sequelize.fn('SUM', sequelize.col('quantity')), 'DESC']],
      limit: 10
    });

    res.json({
      date: startOfDay,
      totalSales,
      invoiceCount,
      gstCollected,
      cashSales,
      digitalSales: totalSales - cashSales - creditSales,
      creditSales,
      topProducts: items.map(i => ({
        name: i.productName,
        quantity: i.dataValues.quantity,
        total: i.dataValues.total
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/monthly
router.get('/monthly', auth, async (req, res) => {
  try {
    const { month, year, shopType } = req.query;
    const targetMonth = month ? parseInt(month) - 1 : new Date().getMonth();
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    const startOfMonth = new Date(targetYear, targetMonth, 1);
    const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    let where = {
      created_at: { [Op.between]: [startOfMonth, endOfMonth] }
    };

    if (shopType) {
      where.shopType = shopType;
    }

    const invoices = await Invoice.findAll({ where });

    const totalRevenue = invoices.reduce((sum, inv) => sum + parseFloat(inv.grandTotal), 0);
    const totalInvoices = invoices.length;
    const creditPending = invoices.reduce((sum, inv) => {
      if (inv.paymentStatus !== 'paid') {
        return sum + (parseFloat(inv.grandTotal) - parseFloat(inv.paidAmount));
      }
      return sum;
    }, 0);

    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const avgPerDay = totalRevenue / daysInMonth;

    res.json({
      month: targetMonth + 1,
      year: targetYear,
      totalRevenue,
      totalInvoices,
      avgPerDay,
      creditPending
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/stock
router.get('/stock', auth, async (req, res) => {
  try {
    const { shopType } = req.query;

    let products = [];

    if (!shopType || shopType === 'grocery') {
      const groceryProducts = await GroceryProduct.findAll({
        where: { isActive: true, sourceType: 'outsourced' }
      });
      products = products.concat(groceryProducts.map(p => ({
        ...p.toJSON(),
        type: 'grocery'
      })));
      const rawMaterials = await RawMaterial.findAll({ where: { isActive: true, shopType: 'grocery' } });
      products = products.concat(rawMaterials.map(material => ({
        ...material.toJSON(),
        purchasePrice: material.costPerUnit,
        type: 'raw_material'
      })));
    }

    if (!shopType || shopType === 'fertilizer') {
      const fertilizerProducts = await FertilizerProduct.findAll({
        where: { isActive: true }
      });
      products = products.concat(fertilizerProducts.map(p => ({
        ...p.toJSON(),
        type: 'fertilizer'
      })));
    }

    const totalProducts = products.length;
    const lowStockProducts = products.filter(p => p.stock <= p.minStock && p.stock > 0);
    const outOfStockProducts = products.filter(p => p.stock === 0);

    const stockValue = products.reduce((sum, p) => {
      return sum + (p.stock * parseFloat(p.purchasePrice));
    }, 0);

    res.json({
      totalProducts,
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      stockValue,
      lowStockProducts: lowStockProducts.map(p => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        minStock: p.minStock,
        type: p.type
      })),
      outOfStockProducts: outOfStockProducts.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/gst
router.get('/gst', auth, async (req, res) => {
  try {
    const { month, year, shopType } = req.query;
    const targetMonth = month ? parseInt(month) - 1 : new Date().getMonth();
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    const startOfMonth = new Date(targetYear, targetMonth, 1);
    const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    let where = {
      created_at: { [Op.between]: [startOfMonth, endOfMonth] }
    };

    if (shopType) {
      where.shopType = shopType;
    }

    const items = await InvoiceItem.findAll({
      include: [{
        model: Invoice,
        where,
        attributes: []
      }],
      attributes: [
        'gstRate',
        [sequelize.fn('SUM', sequelize.col('InvoiceItem.gst_amount')), 'totalGst']
      ],
      group: ['gstRate']
    });

    const gstBreakdown = {
      gst0: 0,
      gst5: 0,
      gst12: 0,
      gst18: 0,
      gst28: 0
    };

    let totalGst = 0;

    items.forEach(item => {
      const rate = parseFloat(item.gstRate);
      const gst = parseFloat(item.dataValues.totalGst) || 0;
      totalGst += gst;

      if (rate === 0) gstBreakdown.gst0 = gst;
      else if (rate === 5) gstBreakdown.gst5 = gst;
      else if (rate === 12) gstBreakdown.gst12 = gst;
      else if (rate === 18) gstBreakdown.gst18 = gst;
      else if (rate === 28) gstBreakdown.gst28 = gst;
    });

    res.json({
      month: targetMonth + 1,
      year: targetYear,
      totalGst,
      ...gstBreakdown
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/reports/dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const { shopType } = req.query;
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    // Get 7-day range for weekly data
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const startOfWeek = new Date(weekAgo.getFullYear(), weekAgo.getMonth(), weekAgo.getDate());

    let where = {};
    if (shopType) {
      where.shopType = shopType;
    }

    // Today's invoices
    const todayInvoices = await Invoice.findAll({
      where: { ...where, created_at: { [Op.between]: [startOfToday, endOfToday] } },
      include: [{
        model: InvoiceItem,
        as: 'items'
      }]
    });

    const todaySales = todayInvoices.reduce((sum, inv) => sum + parseFloat(inv.grandTotal), 0);
    const todayInvoiceCount = todayInvoices.length;

    // Calculate Today's Profit
    let todayProfit = 0;
    for (const inv of todayInvoices) {
      for (const item of inv.items) {
        let product;
        if (item.productType === 'grocery') {
          product = await GroceryProduct.findByPk(item.productId);
        } else {
          product = await FertilizerProduct.findByPk(item.productId);
        }

        if (product) {
          const costPrice = parseFloat(product.purchasePrice);
          const sellingPrice = parseFloat(item.unitPrice); // Use unit price from invoice item
          const profit = (sellingPrice - costPrice) * item.quantity;
          todayProfit += profit;
        }
      }
    }

    // This month stats
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthInvoices = await Invoice.findAll({
      where: { ...where, created_at: { [Op.between]: [startOfMonth, endOfToday] } },
      include: [{
        model: InvoiceItem,
        as: 'items'
      }]
    });
    const monthSales = monthInvoices.reduce((sum, inv) => sum + parseFloat(inv.grandTotal), 0);

    // Purchases are treated as the dashboard's recorded operating expense.
    const todayPurchases = await Purchase.findAll({
      where: { ...where, billDate: { [Op.between]: [startOfToday, endOfToday] } }
    });
    const todayPurchase = todayPurchases.reduce((sum, purchase) => sum + parseFloat(purchase.grandTotal || 0), 0);

    // Calculate Month's Profit
    let monthProfit = 0;
    for (const inv of monthInvoices) {
      for (const item of inv.items) {
        let product;
        if (item.productType === 'grocery') {
          product = await GroceryProduct.findByPk(item.productId);
        } else {
          product = await FertilizerProduct.findByPk(item.productId);
        }

        if (product) {
          const costPrice = parseFloat(product.purchasePrice);
          const sellingPrice = parseFloat(item.unitPrice);
          const profit = (sellingPrice - costPrice) * item.quantity;
          monthProfit += profit;
        }
      }
    }

    // Week's invoices for chart
    const weekInvoices = await Invoice.findAll({
      where: { ...where, created_at: { [Op.between]: [startOfWeek, endOfToday] } }
    });

    // Group by day for chart
    const dailySales = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      const key = `${d.getDate()}/${d.getMonth() + 1}`;
      dailySales[key] = 0;
    }

    weekInvoices.forEach(inv => {
      const d = new Date(inv.created_at);
      const key = `${d.getDate()}/${d.getMonth() + 1}`;
      if (dailySales[key] !== undefined) {
        dailySales[key] += parseFloat(inv.grandTotal);
      }
    });

    // Pending dues
    const pendingInvoices = await Invoice.findAll({
      where: { ...where, paymentStatus: { [Op.ne]: 'paid' } }
    });
    const totalPendingDues = pendingInvoices.reduce((sum, inv) =>
      sum + (parseFloat(inv.grandTotal) - parseFloat(inv.paidAmount)), 0);
    const pendingOrderCount = pendingInvoices.length;

    // Low stock count - simplified approach
    let lowStockCount = 0;
    let stockValue = 0;
    try {
      if (!shopType || shopType === 'grocery') {
        const groceryProducts = await GroceryProduct.findAll({
          where: { isActive: true, sourceType: 'outsourced' }
        });
        lowStockCount += groceryProducts.filter(p => p.stock <= p.minStock).length;
        stockValue += groceryProducts.reduce((sum, p) => sum + (Number(p.stock) * Number(p.purchasePrice || 0)), 0);
        const rawMaterials = await RawMaterial.findAll({ where: { isActive: true, shopType: 'grocery' } });
        lowStockCount += rawMaterials.filter(material => Number(material.stock) <= Number(material.minStock)).length;
        stockValue += rawMaterials.reduce((sum, material) => sum + (Number(material.stock) * Number(material.costPerUnit || 0)), 0);
      }
      if (!shopType || shopType === 'fertilizer') {
        const fertilizerProducts = await FertilizerProduct.findAll({
          where: { isActive: true }
        });
        lowStockCount += fertilizerProducts.filter(p => p.stock <= p.minStock).length;
        stockValue += fertilizerProducts.reduce((sum, p) => sum + (Number(p.stock) * Number(p.purchasePrice || 0)), 0);
      }
    } catch (e) {
      // If low stock check fails, continue with 0
      lowStockCount = 0;
      stockValue = 0;
    }

    const hourlyChart = Array.from({ length: 12 }, (_, index) => ({
      label: `${index + 8}:00`,
      amount: 0
    }));
    todayInvoices.forEach(inv => {
      const hour = new Date(inv.created_at).getHours();
      if (hour >= 8 && hour < 20) hourlyChart[hour - 8].amount += parseFloat(inv.grandTotal);
    });

    const monthlyChart = [];
    for (let offset = 5; offset >= 0; offset--) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
      const invoices = await Invoice.findAll({
        where: { ...where, created_at: { [Op.between]: [monthDate, monthEnd] } },
        attributes: ['grandTotal']
      });
      monthlyChart.push({
        label: monthDate.toLocaleString('en', { month: 'short' }),
        amount: invoices.reduce((sum, inv) => sum + parseFloat(inv.grandTotal), 0)
      });
    }

    // Recent invoices
    const recentInvoices = await Invoice.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: 5,
      attributes: ['id', 'invoiceNumber', 'customerName', 'grandTotal', 'paymentStatus', 'created_at']
    });

    res.json({
      todaySales,
      todayProfit,
      todayInvoiceCount,
      todayExpenses: Math.max(todaySales - todayProfit, 0),
      todayPurchase,
      totalPendingDues,
      pendingOrderCount,
      lowStockCount,
      stockValue,
      monthSales,
      monthProfit,
      monthInvoiceCount: monthInvoices.length,
      weeklyChart: Object.entries(dailySales).map(([day, amount]) => ({ day, amount })),
      dailyChart: hourlyChart,
      monthlyChart,
      recentInvoices: recentInvoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName || 'Walk-in',
        grandTotal: parseFloat(inv.grandTotal),
        paymentStatus: inv.paymentStatus,
        createdAt: inv.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
