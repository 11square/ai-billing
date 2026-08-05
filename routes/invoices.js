const express = require('express');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Invoice, InvoiceItem, Payment } = require('../models/Invoice');
const { Customer } = require('../models/Customer');
const GroceryProduct = require('../models/GroceryProduct');
const FertilizerProduct = require('../models/FertilizerProduct');
const { auth } = require('../middleware/auth');
const { consumeRecipe, restoreRecipe, reverseRecordedConsumption, recipeQuantity } = require('../services/rawMaterialService');

const router = express.Router();

// Generate Invoice Number
const generateInvoiceNumber = async (shopType) => {
  const prefix = shopType === 'grocery' ? 'GRO' : 'FER';
  const date = new Date();
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

  const count = await Invoice.count({
    where: {
      shopType,
      created_at: {
        [Op.gte]: new Date(date.getFullYear(), date.getMonth(), date.getDate())
      }
    }
  });

  return `${prefix}-${dateStr}-${String(count + 1).padStart(4, '0')}`;
};

// @route   GET /api/invoices
router.get('/', auth, async (req, res) => {
  try {
    const { shopType, startDate, endDate, paymentStatus } = req.query;

    let where = {};

    if (shopType) {
      where.shopType = shopType;
    }

    if (startDate && endDate) {
      where.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    if (req.query.customerId) {
      where.customerId = req.query.customerId;
    }

    const invoices = await Invoice.findAll({
      where,
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: Payment, as: 'payments' }
      ],
      order: [['created_at', 'DESC']]
    });

    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/invoices/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: Payment, as: 'payments' }
      ]
    });

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/invoices
router.post('/', auth, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { shopType, customerId, customerName, customerPhone, items, discount, payments, notes } = req.body;

    // Calculate totals
    let subTotal = 0;
    let gstAmount = 0;

    for (const item of items) {
      const itemTotal = item.quantity * item.unitPrice;
      const itemGst = itemTotal * (item.gstRate / 100);
      subTotal += itemTotal;
      gstAmount += itemGst;
    }

    const grandTotal = subTotal + gstAmount - (discount || 0);

    // Calculate paid amount
    let paidAmount = 0;
    if (payments && payments.length > 0) {
      paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    }

    // Determine payment status
    let paymentStatus = 'unpaid';
    if (paidAmount >= grandTotal) {
      paymentStatus = 'paid';
    } else if (paidAmount > 0) {
      paymentStatus = 'partial';
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(shopType);

    // Create invoice
    const invoice = await Invoice.create({
      invoiceNumber,
      shopType,
      customerId,
      customerName,
      customerPhone,
      subTotal,
      discount: discount || 0,
      gstAmount,
      grandTotal,
      paidAmount,
      paymentStatus,
      notes,
      createdBy: req.user.id
    }, { transaction: t });

    // Create invoice items and update stock
    for (const item of items) {
      const itemGst = (item.quantity * item.unitPrice) * (item.gstRate / 100);
      const totalPrice = (item.quantity * item.unitPrice) + itemGst;

      const invoiceItem = await InvoiceItem.create({
        invoiceId: invoice.id,
        productType: shopType,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        gstRate: item.gstRate,
        gstAmount: itemGst,
        totalPrice
      }, { transaction: t });

      // Purchased products use finished stock. Own-made products consume their recipe at billing.
      if (shopType === 'grocery') {
        const product = await GroceryProduct.findByPk(item.productId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!product || !product.isActive) throw new Error(`${item.productName} is no longer available`);
        if (product.sourceType !== 'outsourced') {
          const consumption = await consumeRecipe({
            product,
            quantity: recipeQuantity(product, item.quantity),
            shopType,
            userId: req.user.id,
            transaction: t,
            referenceType: 'invoice_item',
            referenceId: invoiceItem.id,
            notes: `Billed ${item.quantity} ${item.unit || product.unit} of ${product.name}`
          });
          await product.update({ stock: 0, minStock: 0, purchasePrice: consumption.unitProductionCost }, { transaction: t });
        } else {
          if (Number(product.stock) + 0.0001 < Number(item.quantity)) {
            throw new Error(`Only ${product.stock} ${product.unit} of ${product.name} is in stock`);
          }
          await product.decrement('stock', { by: item.quantity, transaction: t });
        }
      } 
       else {
        const product = await FertilizerProduct.findByPk(item.productId, { transaction: t });
        if (product) {
          // Check for loose sale
          // Assuming product.unit is the "Bag" unit (e.g. 'Bag', 'Box') and item.unit is 'kg' or 'L'
          // We check if item.unit matches product.unit. If distinct and loose is enabled, it's a loose sale.
          if (product.isLooseEnabled && item.unit !== product.unit) {
            let currentLoose = parseFloat(product.looseStock);
            let currentBags = parseInt(product.stock);
            let qtySold = parseFloat(item.quantity);
            const weightPerBag = parseFloat(product.weightPerBag);

            if (currentLoose >= qtySold) {
              currentLoose -= qtySold;
            } else {
              // Need to open bags
              const deficit = qtySold - currentLoose;
              // If weightPerBag is 0 (error case), avoid division by zero
              if (weightPerBag > 0) {
                const bagsToOpen = Math.ceil(deficit / weightPerBag);
                currentBags -= bagsToOpen;
                currentLoose = (currentLoose + (bagsToOpen * weightPerBag)) - qtySold;
              } else {
                // Fallback if config error: just reduce loose stock into negative
                currentLoose -= qtySold;
              }
            }

            await product.update({ stock: currentBags, looseStock: currentLoose }, { transaction: t });
          } else {
            // Normal bag sale
            await product.decrement('stock', {
              by: item.quantity,
              transaction: t
            });
          }
        }
      }
    }

    // Create payments
    if (payments && payments.length > 0) {
      for (const payment of payments) {
        await Payment.create({
          invoiceId: invoice.id,
          amount: payment.amount,
          method: payment.method,
          referenceNumber: payment.referenceNumber
        }, { transaction: t });
      }
    }

    // Update customer totals
    if (customerId) {
      await Customer.increment('totalPurchases', {
        by: grandTotal,
        where: { id: customerId },
        transaction: t
      });

      if (paymentStatus !== 'paid') {
        await Customer.increment('totalCredit', {
          by: grandTotal - paidAmount,
          where: { id: customerId },
          transaction: t
        });
      }
    }

    await t.commit();

    // Fetch complete invoice
    const result = await Invoice.findByPk(invoice.id, {
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: Payment, as: 'payments' }
      ]
    });

    res.status(201).json(result);
  } catch (error) {
    await t.rollback();
    const status = /short by|recipe|Raw material|Inventory item|Cannot convert|Link recipe|no longer available|is in stock/i.test(error.message) ? 400 : 500;
    res.status(status).json({ message: error.message });
  }
});

// @route   PUT /api/invoices/:id/items
// Edit invoice quantities and reconcile stock, totals and customer balances atomically.
router.put('/:id/items', auth, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [{ model: InvoiceItem, as: 'items' }],
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!invoice) {
      const error = new Error('Invoice not found');
      error.status = 404;
      throw error;
    }
    if (invoice.paymentStatus === 'cancelled') {
      const error = new Error('Cancelled invoices cannot be edited');
      error.status = 400;
      throw error;
    }
    if (invoice.shopType !== 'grocery') {
      const error = new Error('Item editing is currently available for POS invoices only');
      error.status = 400;
      throw error;
    }

    const requested = Array.isArray(req.body.items) ? req.body.items : [];
    const requestedById = new Map();
    for (const entry of requested) {
      const id = Number(entry.id);
      const quantity = Number(entry.quantity);
      if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 0) {
        const error = new Error('Each item must have a valid whole-number quantity');
        error.status = 400;
        throw error;
      }
      requestedById.set(id, quantity);
    }

    const originalIds = new Set(invoice.items.map(item => item.id));
    if ([...requestedById.keys()].some(id => !originalIds.has(id))) {
      const error = new Error('One or more invoice items are invalid');
      error.status = 400;
      throw error;
    }

    const edits = invoice.items.map(item => ({
      item,
      oldQuantity: Number(item.quantity),
      newQuantity: requestedById.has(item.id) ? requestedById.get(item.id) : Number(item.quantity)
    }));
    if (!edits.some(edit => edit.newQuantity > 0)) {
      const error = new Error('An invoice must contain at least one item. Use Cancel Invoice instead.');
      error.status = 400;
      throw error;
    }

    // Lock products and verify any increased quantity is available.
    for (const edit of edits) {
      if (edit.newQuantity === edit.oldQuantity) continue;
      const product = await GroceryProduct.findByPk(edit.item.productId, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!product) {
        const error = new Error(`${edit.item.productName} no longer exists in the menu`);
        error.status = 400;
        throw error;
      }
      if (product.sourceType === 'outsourced') {
        const stockAfterEdit = Number(product.stock) + edit.oldQuantity - edit.newQuantity;
        if (stockAfterEdit < 0) {
          const available = Number(product.stock) + edit.oldQuantity;
          const error = new Error(`Only ${available} × ${edit.item.productName} can be kept on this invoice`);
          error.status = 400;
          throw error;
        }
        edit.stockAfterEdit = stockAfterEdit;
      }
      edit.product = product;
    }

    let subTotal = 0;
    let gstAmount = 0;
    for (const edit of edits) {
      if (edit.newQuantity <= 0) continue;
      const lineSubTotal = edit.newQuantity * Number(edit.item.unitPrice);
      const lineGst = lineSubTotal * (Number(edit.item.gstRate) / 100);
      subTotal += lineSubTotal;
      gstAmount += lineGst;
    }
    subTotal = Math.round(subTotal * 100) / 100;
    gstAmount = Math.round(gstAmount * 100) / 100;
    const grandTotal = Math.round((subTotal + gstAmount - Number(invoice.discount || 0)) * 100) / 100;
    const oldPaidAmount = Number(invoice.paidAmount);
    let paidAmount = oldPaidAmount;
    if (grandTotal < 0) {
      const error = new Error('Remove or reduce the invoice discount before removing these items');
      error.status = 400;
      throw error;
    }
    const refundAmount = Math.max(0, Math.round((oldPaidAmount - grandTotal) * 100) / 100);
    if (refundAmount > 0) {
      const refundMethod = ['cash', 'upi', 'card'].includes(req.body.refundMethod)
        ? req.body.refundMethod
        : 'cash';
      await Payment.create({
        invoiceId: invoice.id,
        amount: -refundAmount,
        method: refundMethod,
        referenceNumber: `Refund after invoice edit`
      }, { transaction: t });
      paidAmount = Math.round((oldPaidAmount - refundAmount) * 100) / 100;
    }

    for (const edit of edits) {
      if (edit.newQuantity === edit.oldQuantity) continue;
      if (edit.product.sourceType !== 'outsourced') {
        const difference = edit.newQuantity - edit.oldQuantity;
        if (difference > 0) {
          await consumeRecipe({
            product: edit.product,
            quantity: recipeQuantity(edit.product, difference),
            shopType: invoice.shopType,
            userId: req.user.id,
            transaction: t,
            referenceType: 'invoice_item',
            referenceId: edit.item.id,
            notes: `Invoice edit added ${difference} ${edit.item.unit || edit.product.unit} of ${edit.product.name}`
          });
        } else {
          await restoreRecipe({
            product: edit.product,
            quantity: recipeQuantity(edit.product, Math.abs(difference)),
            shopType: invoice.shopType,
            userId: req.user.id,
            transaction: t,
            referenceType: 'invoice_item',
            referenceId: edit.item.id,
            notes: `Invoice edit returned ${Math.abs(difference)} ${edit.item.unit || edit.product.unit} of ${edit.product.name}`,
            capToRecorded: true
          });
        }
        await edit.product.update({ stock: 0, minStock: 0 }, { transaction: t });
      } else {
        await edit.product.update({ stock: edit.stockAfterEdit }, { transaction: t });
      }
      if (edit.newQuantity === 0) {
        await edit.item.destroy({ transaction: t });
      } else {
        const lineSubTotal = edit.newQuantity * Number(edit.item.unitPrice);
        const lineGst = Math.round(lineSubTotal * (Number(edit.item.gstRate) / 100) * 100) / 100;
        await edit.item.update({
          quantity: edit.newQuantity,
          gstAmount: lineGst,
          totalPrice: Math.round((lineSubTotal + lineGst) * 100) / 100
        }, { transaction: t });
      }
    }

    const oldGrandTotal = Number(invoice.grandTotal);
    const oldCredit = Math.max(0, oldGrandTotal - oldPaidAmount);
    const newCredit = Math.max(0, grandTotal - paidAmount);
    const paymentStatus = paidAmount >= grandTotal - 0.009
      ? 'paid'
      : (paidAmount > 0 ? 'partial' : 'unpaid');

    await invoice.update({ subTotal, gstAmount, grandTotal, paidAmount, paymentStatus }, { transaction: t });

    if (invoice.customerId) {
      const customer = await Customer.findByPk(invoice.customerId, { transaction: t, lock: t.LOCK.UPDATE });
      if (customer) {
        await customer.increment('totalPurchases', { by: grandTotal - oldGrandTotal, transaction: t });
        await customer.increment('totalCredit', { by: newCredit - oldCredit, transaction: t });
      }
    }

    await t.commit();
    const result = await Invoice.findByPk(invoice.id, {
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: Payment, as: 'payments' }
      ]
    });
    res.json(result);
  } catch (error) {
    await t.rollback();
    const isInventoryError = /short by|recipe|Raw material|Inventory item|Cannot convert|Link recipe/i.test(error.message);
    res.status(error.status || (isInventoryError ? 400 : 500)).json({ message: error.message });
  }
});

// @route   POST /api/invoices/:id/payment
router.post('/:id/payment', auth, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const { amount, method, referenceNumber } = req.body;

    // Create payment
    await Payment.create({
      invoiceId: invoice.id,
      amount,
      method,
      referenceNumber
    }, { transaction: t });

    // Update invoice
    const newPaidAmount = parseFloat(invoice.paidAmount) + amount;
    let paymentStatus = 'partial';
    if (newPaidAmount >= invoice.grandTotal) {
      paymentStatus = 'paid';
    }

    await invoice.update({
      paidAmount: newPaidAmount,
      paymentStatus
    }, { transaction: t });

    // Update customer credit
    if (invoice.customerId) {
      await Customer.decrement('totalCredit', {
        by: amount,
        where: { id: invoice.customerId },
        transaction: t
      });
    }

    await t.commit();

    const result = await Invoice.findByPk(invoice.id, {
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: Payment, as: 'payments' }
      ]
    });

    res.json(result);
  } catch (error) {
    await t.rollback();
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/invoices/:id/cancel
router.post('/:id/cancel', auth, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [{ model: InvoiceItem, as: 'items' }],
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (invoice.paymentStatus === 'cancelled') {
      return res.status(400).json({ message: 'Invoice already cancelled' });
    }

    // Restore purchased stock or the raw materials consumed for made-to-order items.
    for (const item of invoice.items) {
      if (invoice.shopType === 'grocery') {
        const product = await GroceryProduct.findByPk(item.productId, { transaction: t, lock: t.LOCK.UPDATE });
        if (product?.sourceType === 'outsourced') {
          await GroceryProduct.increment('stock', { by: item.quantity, where: { id: item.productId }, transaction: t });
        }
      } else {
        const product = await FertilizerProduct.findByPk(item.productId, { transaction: t });
        if (product) {
          if (product.isLooseEnabled && item.unit !== product.unit) {
            // Revert loose sale: just add back to looseStock
            // We do not re-bag items automatically
            await product.increment('looseStock', { by: item.quantity, transaction: t });
          } else {
            await product.increment('stock', { by: item.quantity, transaction: t });
          }
        }
      }
    }
    if (invoice.shopType === 'grocery') {
      await reverseRecordedConsumption({
        referenceType: 'invoice_item',
        referenceIds: invoice.items.map(item => item.id),
        shopType: invoice.shopType,
        userId: req.user.id,
        transaction: t,
        reversalType: 'invoice_cancel',
        reversalId: invoice.id,
        notes: `Cancelled ${invoice.invoiceNumber}`
      });
    }

    // revert customer stats
    if (invoice.customerId) {
      await Customer.decrement('totalPurchases', {
        by: invoice.grandTotal,
        where: { id: invoice.customerId },
        transaction: t
      });

      if (invoice.paymentStatus !== 'paid') {
        // if it was unpaid/partial, we need to remove the credit amount
        const creditAmount = invoice.grandTotal - invoice.paidAmount;
        await Customer.decrement('totalCredit', {
          by: creditAmount,
          where: { id: invoice.customerId },
          transaction: t
        });
      }
    }

    await invoice.update({ paymentStatus: 'cancelled' }, { transaction: t });

    await t.commit();
    res.json({ message: 'Invoice cancelled successfully', invoice });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
