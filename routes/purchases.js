const express = require('express');
const router = express.Router();
const { Vendor, Purchase, PurchaseItem } = require('../models/Purchase');
const VendorLedgerEntry = require('../models/VendorLedgerEntry');
const { RawMaterial, RawMaterialMovement } = require('../models/RawMaterial');
const { roundQty, roundMoney } = require('../services/rawMaterialService');
const User = require('../models/User');
const GroceryProduct = require('../models/GroceryProduct');
const FertilizerProduct = require('../models/FertilizerProduct');
const { auth } = require('../middleware/auth');
const sequelize = require('../config/database');

// Get all purchases
router.get('/', auth, async (req, res) => {
    try {
        const purchases = await Purchase.findAll({
            where: { shopType: req.user.activeShop },
            include: [
                { model: PurchaseItem, as: 'items' },
                { model: Vendor, as: 'vendor' },
                { model: User, as: 'creator', attributes: ['id', 'name', 'email'] }
            ],
            order: [['created_at', 'DESC']]
        });

        res.json({ purchases });
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get single purchase
router.get('/:id', auth, async (req, res) => {
    try {
        const purchase = await Purchase.findOne({
            where: { id: req.params.id, shopType: req.user.activeShop },
            include: [
                { model: PurchaseItem, as: 'items' },
                { model: Vendor, as: 'vendor' },
                { model: User, as: 'creator', attributes: ['id', 'name', 'email'] }
            ]
        });

        if (!purchase) {
            return res.status(404).json({ message: 'Purchase not found' });
        }

        res.json(purchase);
    } catch (error) {
        console.error('Error fetching purchase:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create purchase
router.post('/', auth, async (req, res) => {
    const t = await sequelize.transaction();

    try {
        const {
            vendorName,
            vendorId,
            invoiceNo,
            vendorBillNo,
            billDate,
            paymentMode,
            paymentDate,
            items,
            totalAmount,
            totalTax,
            discount,
            grandTotal,
            status,
            paidAmount
        } = req.body;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(billDate || ''))) {
            await t.rollback();
            return res.status(400).json({ message: 'Enter a valid bill date' });
        }
        if (!Array.isArray(items) || !items.length) {
            await t.rollback();
            return res.status(400).json({ message: 'Add at least one purchase item' });
        }

        const vendor = await Vendor.findOne({
            where: { id: vendorId, shopType: req.user.activeShop, isActive: true },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!vendor) {
            await t.rollback();
            return res.status(400).json({ message: 'Select an active vendor' });
        }

        const purchaseTotal = Number(grandTotal);
        if (!Number.isFinite(purchaseTotal) || purchaseTotal <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Purchase total must be greater than zero' });
        }
        const initialPaid = status === 'paid'
            ? purchaseTotal
            : status === 'partial' ? Math.min(Math.max(Number(paidAmount) || 0, 0), purchaseTotal) : 0;
        const purchaseStatus = initialPaid >= purchaseTotal ? 'paid' : initialPaid > 0 ? 'partial' : 'pending';

        // Create purchase
        const purchase = await Purchase.create({
            vendorName: vendor.name,
            vendorId: vendor.id,
            invoiceNo: invoiceNo || null,
            vendorBillNo: vendorBillNo || null,
            billDate: new Date(billDate),
            paymentMode: paymentMode || 'cash',
            paymentDate: paymentDate ? new Date(paymentDate) : null,
            totalAmount,
            totalTax: totalTax || 0,
            discount: discount || 0,
            grandTotal,
            paidAmount: initialPaid,
            status: purchaseStatus,
            shopType: req.user.activeShop,
            createdBy: req.user.id
        }, { transaction: t });

        // Create purchase items and update product stock
        if (items && items.length > 0) {
            for (const item of items) {
                await PurchaseItem.create({
                    purchaseId: purchase.id,
                    productId: item.productId || null,
                    rawMaterialId: item.rawMaterialId || null,
                    itemKind: item.itemKind === 'raw_material' ? 'raw_material' : 'product',
                    productType: req.user.activeShop,
                    name: item.name,
                    category: item.category || null,
                    unit: item.unit,
                    quantity: item.quantity,
                    cost: item.cost,
                    sellingPrice: item.sellingPrice,
                    mrp: item.mrp,
                    tax: item.tax || 0,
                    totalCost: item.totalCost
                }, { transaction: t });

                if (item.itemKind === 'raw_material') {
                    const material = await RawMaterial.findOne({
                        where: { id: item.rawMaterialId, shopType: req.user.activeShop, isActive: true },
                        transaction: t,
                        lock: t.LOCK.UPDATE
                    });
                    if (!material) throw new Error(`Raw material not found: ${item.name}`);
                    const quantity = roundQty(item.quantity);
                    if (!(quantity > 0)) throw new Error(`Enter a valid quantity for ${item.name}`);
                    const currentStock = Number(material.stock);
                    const newStock = roundQty(currentStock + quantity);
                    const averageCost = newStock > 0
                        ? roundMoney(((currentStock * Number(material.costPerUnit)) + (quantity * Number(item.cost))) / newStock)
                        : Number(item.cost);
                    await material.update({ stock: newStock, costPerUnit: averageCost }, { transaction: t });
                    await RawMaterialMovement.create({
                        rawMaterialId: material.id,
                        movementType: 'purchase',
                        direction: 'in',
                        quantity,
                        balanceAfter: newStock,
                        unitCost: item.cost,
                        referenceType: 'purchase',
                        referenceId: purchase.id,
                        notes: `Received through PO-${String(purchase.id).padStart(4, '0')}`,
                        shopType: req.user.activeShop,
                        createdBy: req.user.id
                    }, { transaction: t });
                } else if (item.productId) {
                    if (req.user.activeShop === 'grocery') {
                        await GroceryProduct.increment('stock', {
                            by: item.quantity,
                            where: { id: item.productId },
                            transaction: t
                        });
                        await GroceryProduct.update({
                            purchasePrice: item.cost,
                            sellingPrice: item.sellingPrice,
                            mrp: item.mrp
                        }, {
                            where: { id: item.productId },
                            transaction: t
                        });
                    } else {
                        await FertilizerProduct.increment('stock', {
                            by: item.quantity,
                            where: { id: item.productId },
                            transaction: t
                        });
                        // Update prices if provided
                        await FertilizerProduct.update({
                            purchasePrice: item.cost,
                            sellingPrice: item.sellingPrice,
                            mrp: item.mrp
                        }, {
                            where: { id: item.productId },
                            transaction: t
                        });
                    }
                }
            }
        }

        await VendorLedgerEntry.create({
            vendorId: vendor.id,
            purchaseId: purchase.id,
            entryType: 'purchase',
            direction: 'credit',
            amount: purchaseTotal,
            entryDate: String(billDate).slice(0, 10),
            referenceNo: vendorBillNo || `PO-${String(purchase.id).padStart(4, '0')}`,
            notes: `Purchase order PO-${String(purchase.id).padStart(4, '0')}`,
            shopType: req.user.activeShop,
            createdBy: req.user.id
        }, { transaction: t });

        if (initialPaid > 0) {
            await VendorLedgerEntry.create({
                vendorId: vendor.id,
                purchaseId: purchase.id,
                entryType: 'payment',
                direction: 'debit',
                amount: initialPaid,
                entryDate: paymentDate ? String(paymentDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
                referenceNo: vendorBillNo || `PO-${String(purchase.id).padStart(4, '0')}`,
                paymentMode: paymentMode === 'cash' ? 'cash' : 'online',
                notes: 'Payment recorded with purchase',
                shopType: req.user.activeShop,
                createdBy: req.user.id
            }, { transaction: t });
        }

        await t.commit();

        // Fetch the complete purchase with items
        const completePurchase = await Purchase.findByPk(purchase.id, {
            include: [
                { model: PurchaseItem, as: 'items' },
                { model: Vendor, as: 'vendor' },
                { model: User, as: 'creator', attributes: ['id', 'name', 'email'] }
            ]
        });

        res.status(201).json(completePurchase);
    } catch (error) {
        await t.rollback();
        console.error('Error creating purchase:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Update purchase status
router.patch('/:id/status', auth, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { status } = req.body;

        if (!['pending', 'partial', 'paid'].includes(status)) {
            await t.rollback();
            return res.status(400).json({ message: 'Invalid purchase status' });
        }
        const purchase = await Purchase.findOne({
            where: { id: req.params.id, shopType: req.user.activeShop },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!purchase) {
            await t.rollback();
            return res.status(404).json({ message: 'Purchase not found' });
        }

        if (status !== 'paid') {
            await t.rollback();
            return res.status(400).json({ message: 'Use vendor payments to record partial payments or corrections' });
        }
        const remaining = Math.max(0, Number(purchase.grandTotal) - Number(purchase.paidAmount || 0));
        if (remaining > 0.009) {
            await VendorLedgerEntry.create({
                vendorId: purchase.vendorId,
                purchaseId: purchase.id,
                entryType: 'payment',
                direction: 'debit',
                amount: remaining,
                entryDate: new Date().toISOString().slice(0, 10),
                paymentMode: req.body.paymentMode || 'cash',
                referenceNo: String(req.body.referenceNo || '').trim() || null,
                notes: 'Purchase marked paid',
                shopType: req.user.activeShop,
                createdBy: req.user.id
            }, { transaction: t });
        }
        await purchase.update({ status: 'paid', paidAmount: purchase.grandTotal, paymentDate: new Date() }, { transaction: t });
        await t.commit();
        res.json(purchase);
    } catch (error) {
        await t.rollback();
        console.error('Error updating purchase status:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete purchase
router.delete('/:id', auth, async (req, res) => {
    const t = await sequelize.transaction();

    try {
        const purchase = await Purchase.findOne({
            where: { id: req.params.id, shopType: req.user.activeShop },
            include: [{ model: PurchaseItem, as: 'items' }]
        });

        if (!purchase) {
            await t.rollback();
            return res.status(404).json({ message: 'Purchase not found' });
        }

        // Reverse stock updates
        for (const item of purchase.items) {
            if (item.itemKind === 'raw_material' && item.rawMaterialId) {
                const material = await RawMaterial.findByPk(item.rawMaterialId, { transaction: t, lock: t.LOCK.UPDATE });
                if (material) {
                    const quantity = Number(item.quantity);
                    if (Number(material.stock) + 0.0001 < quantity) {
                        throw new Error(`Cannot delete PO: ${material.name} stock has already been consumed`);
                    }
                    const newStock = roundQty(Number(material.stock) - quantity);
                    const remainingValue = (Number(material.stock) * Number(material.costPerUnit)) - (quantity * Number(item.cost));
                    const newCost = newStock > 0 ? Math.max(0, roundMoney(remainingValue / newStock)) : 0;
                    await material.update({ stock: newStock, costPerUnit: newCost }, { transaction: t });
                    await RawMaterialMovement.create({
                        rawMaterialId: material.id,
                        movementType: 'return_to_vendor',
                        direction: 'out',
                        quantity,
                        balanceAfter: newStock,
                        unitCost: item.cost,
                        referenceType: 'purchase_delete',
                        referenceId: purchase.id,
                        notes: `PO-${String(purchase.id).padStart(4, '0')} deleted`,
                        shopType: purchase.shopType,
                        createdBy: req.user.id
                    }, { transaction: t });
                }
            } else if (item.productId) {
                if (purchase.shopType === 'grocery') {
                    await GroceryProduct.decrement('stock', {
                        by: item.quantity,
                        where: { id: item.productId },
                        transaction: t
                    });
                } else {
                    await FertilizerProduct.decrement('stock', {
                        by: item.quantity,
                        where: { id: item.productId },
                        transaction: t
                    });
                }
            }
        }

        // Delete items
        await PurchaseItem.destroy({
            where: { purchaseId: purchase.id },
            transaction: t
        });

        await VendorLedgerEntry.destroy({
            where: { purchaseId: purchase.id },
            transaction: t
        });

        // Delete purchase
        await purchase.destroy({ transaction: t });

        await t.commit();
        res.json({ message: 'Purchase deleted successfully' });
    } catch (error) {
        await t.rollback();
        console.error('Error deleting purchase:', error);
        const status = /already been consumed/i.test(error.message) ? 409 : 500;
        res.status(status).json({ message: status === 409 ? error.message : 'Server error' });
    }
});

module.exports = router;
