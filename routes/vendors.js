const express = require('express');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Vendor, Purchase, PurchaseItem } = require('../models/Purchase');
const VendorLedgerEntry = require('../models/VendorLedgerEntry');
const { auth } = require('../middleware/auth');

const router = express.Router();
const today = () => new Date().toISOString().slice(0, 10);
const money = value => Math.round((Number(value) || 0) * 100) / 100;

const ledgerSummary = entries => {
  const totals = {
    totalPurchases: 0,
    totalPaid: 0,
    totalReturns: 0,
    totalCredits: 0,
    totalDebits: 0,
    balance: 0
  };

  entries.forEach(entry => {
    const amount = money(entry.amount);
    if (entry.direction === 'credit') totals.totalCredits += amount;
    else totals.totalDebits += amount;
    if (entry.entryType === 'purchase') totals.totalPurchases += amount;
    if (entry.entryType === 'payment') totals.totalPaid += amount;
    if (entry.entryType === 'purchase_return') totals.totalReturns += amount;
  });

  Object.keys(totals).forEach(key => { totals[key] = money(totals[key]); });
  totals.balance = money(totals.totalCredits - totals.totalDebits);
  return totals;
};

const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);

const vendorPayload = body => ({
  name: String(body.name || '').trim(),
  contactPerson: String(body.contactPerson || '').trim() || null,
  phone: String(body.phone || '').trim() || null,
  alternatePhone: String(body.alternatePhone || '').trim() || null,
  email: String(body.email || '').trim() || null,
  address: String(body.address || '').trim() || null,
  gstin: String(body.gstin || '').trim().toUpperCase() || null,
  paymentTermsDays: Math.max(0, parseInt(body.paymentTermsDays, 10) || 0),
  bankName: String(body.bankName || '').trim() || null,
  accountNumber: String(body.accountNumber || '').trim() || null,
  ifsc: String(body.ifsc || '').trim().toUpperCase() || null,
  upiId: String(body.upiId || '').trim() || null,
  notes: String(body.notes || '').trim() || null,
  isActive: body.isActive === undefined ? true : Boolean(body.isActive)
});

const findVendor = (id, shopType, options = {}) => Vendor.findOne({
  where: { id, shopType },
  ...options
});

router.get('/summary', auth, async (req, res) => {
  try {
    const [vendors, entries] = await Promise.all([
      Vendor.count({ where: { shopType: req.user.activeShop, isActive: true } }),
      VendorLedgerEntry.findAll({
        where: { shopType: req.user.activeShop },
        attributes: ['entryType', 'direction', 'amount']
      })
    ]);
    res.json({ vendorCount: vendors, ...ledgerSummary(entries) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const where = { shopType: req.user.activeShop };
    if (req.query.status !== 'all') where.isActive = true;
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { contactPerson: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { gstin: { [Op.like]: `%${search}%` } }
      ];
    }

    const vendors = await Vendor.findAll({ where, order: [['name', 'ASC']] });
    const ids = vendors.map(vendor => vendor.id);
    const entries = ids.length ? await VendorLedgerEntry.findAll({
      where: { vendorId: { [Op.in]: ids }, shopType: req.user.activeShop },
      attributes: ['vendorId', 'entryType', 'direction', 'amount']
    }) : [];
    const grouped = new Map();
    entries.forEach(entry => {
      if (!grouped.has(entry.vendorId)) grouped.set(entry.vendorId, []);
      grouped.get(entry.vendorId).push(entry);
    });

    res.json({
      vendors: vendors.map(vendor => ({
        ...vendor.toJSON(),
        summary: ledgerSummary(grouped.get(vendor.id) || [])
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/ledger', auth, async (req, res) => {
  try {
    const vendor = await findVendor(req.params.id, req.user.activeShop);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const where = { vendorId: vendor.id, shopType: req.user.activeShop };
    if (req.query.type) where.entryType = req.query.type;
    if (req.query.from || req.query.to) {
      where.entryDate = {};
      if (req.query.from) where.entryDate[Op.gte] = req.query.from;
      if (req.query.to) where.entryDate[Op.lte] = req.query.to;
    }
    const entries = await VendorLedgerEntry.findAll({
      where,
      include: [{ model: Purchase, as: 'purchase', attributes: ['id', 'vendorBillNo', 'billDate', 'grandTotal', 'paidAmount', 'status'], required: false }],
      order: [['entryDate', 'DESC'], ['id', 'DESC']]
    });
    res.json({ vendor, summary: ledgerSummary(entries), entries });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const vendor = await findVendor(req.params.id, req.user.activeShop);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const [purchases, entries] = await Promise.all([
      Purchase.findAll({
        where: { vendorId: vendor.id, shopType: req.user.activeShop },
        include: [{ model: PurchaseItem, as: 'items' }],
        order: [['billDate', 'DESC'], ['id', 'DESC']]
      }),
      VendorLedgerEntry.findAll({
        where: { vendorId: vendor.id, shopType: req.user.activeShop },
        order: [['entryDate', 'DESC'], ['id', 'DESC']]
      })
    ]);
    res.json({ vendor, summary: ledgerSummary(entries), purchases, ledger: entries });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const data = vendorPayload(req.body);
    if (!data.name) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Vendor name is required' });
    }
    const openingBalance = money(req.body.openingBalance);
    if (openingBalance < 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Opening balance cannot be negative' });
    }
    const vendor = await Vendor.create({ ...data, shopType: req.user.activeShop }, { transaction });
    if (openingBalance > 0) {
      await VendorLedgerEntry.create({
        vendorId: vendor.id,
        entryType: 'opening_balance',
        direction: 'credit',
        amount: openingBalance,
        entryDate: validDate(req.body.openingBalanceDate) ? (req.body.openingBalanceDate || today()) : today(),
        referenceNo: 'OPENING',
        notes: 'Opening payable balance',
        shopType: req.user.activeShop,
        createdBy: req.user.id
      }, { transaction });
    }
    await transaction.commit();
    res.status(201).json({ ...vendor.toJSON(), summary: ledgerSummary(openingBalance > 0 ? [{ entryType: 'opening_balance', direction: 'credit', amount: openingBalance }] : []) });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const vendor = await findVendor(req.params.id, req.user.activeShop);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    const data = vendorPayload({ ...vendor.toJSON(), ...req.body });
    if (!data.name) return res.status(400).json({ message: 'Vendor name is required' });
    await vendor.update(data);
    res.json(vendor);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/:id/payments', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const vendor = await findVendor(req.params.id, req.user.activeShop, { transaction, lock: transaction.LOCK.UPDATE });
    if (!vendor) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Vendor not found' });
    }
    const amount = money(req.body.amount);
    if (amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Payment amount must be greater than zero' });
    }
    if (!validDate(req.body.entryDate)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Enter a valid payment date' });
    }

    let purchase = null;
    if (req.body.purchaseId) {
      purchase = await Purchase.findOne({
        where: { id: req.body.purchaseId, vendorId: vendor.id, shopType: req.user.activeShop },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!purchase) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Purchase not found for this vendor' });
      }
      const due = money(purchase.grandTotal) - money(purchase.paidAmount);
      if (amount > due + 0.009) {
        await transaction.rollback();
        return res.status(400).json({ message: `Payment exceeds purchase balance of ${due.toFixed(2)}` });
      }
      const paidAmount = money(money(purchase.paidAmount) + amount);
      await purchase.update({
        paidAmount,
        status: paidAmount >= money(purchase.grandTotal) ? 'paid' : 'partial',
        paymentDate: req.body.entryDate || today(),
        paymentMode: req.body.paymentMode === 'cash' ? 'cash' : 'online'
      }, { transaction });
    }

    const entry = await VendorLedgerEntry.create({
      vendorId: vendor.id,
      purchaseId: purchase ? purchase.id : null,
      entryType: 'payment',
      direction: 'debit',
      amount,
      entryDate: req.body.entryDate || today(),
      referenceNo: String(req.body.referenceNo || '').trim() || null,
      paymentMode: req.body.paymentMode || 'cash',
      notes: String(req.body.notes || '').trim() || null,
      shopType: req.user.activeShop,
      createdBy: req.user.id
    }, { transaction });
    await transaction.commit();
    res.status(201).json(entry);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ message: error.message });
  }
});

router.post('/:id/adjustments', auth, async (req, res) => {
  try {
    const vendor = await findVendor(req.params.id, req.user.activeShop);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    const allowed = {
      purchase_return: 'debit',
      credit_adjustment: 'credit',
      debit_adjustment: 'debit'
    };
    const entryType = req.body.entryType;
    const amount = money(req.body.amount);
    if (!allowed[entryType]) return res.status(400).json({ message: 'Invalid adjustment type' });
    if (amount <= 0) return res.status(400).json({ message: 'Adjustment amount must be greater than zero' });
    if (!validDate(req.body.entryDate)) return res.status(400).json({ message: 'Enter a valid adjustment date' });
    const entry = await VendorLedgerEntry.create({
      vendorId: vendor.id,
      purchaseId: req.body.purchaseId || null,
      entryType,
      direction: allowed[entryType],
      amount,
      entryDate: req.body.entryDate || today(),
      referenceNo: String(req.body.referenceNo || '').trim() || null,
      notes: String(req.body.notes || '').trim() || null,
      shopType: req.user.activeShop,
      createdBy: req.user.id
    });
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const vendor = await findVendor(req.params.id, req.user.activeShop);
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    const [purchaseCount, ledgerCount] = await Promise.all([
      Purchase.count({ where: { vendorId: vendor.id } }),
      VendorLedgerEntry.count({ where: { vendorId: vendor.id } })
    ]);
    if (purchaseCount || ledgerCount) {
      await vendor.update({ isActive: false });
      return res.json({ message: 'Vendor archived because transaction history exists', archived: true });
    }
    await vendor.destroy();
    res.json({ message: 'Vendor deleted', archived: false });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
