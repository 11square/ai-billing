const express = require('express');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { RawMaterial, RawMaterialMovement } = require('../models/RawMaterial');
const GroceryProduct = require('../models/GroceryProduct');
const { auth } = require('../middleware/auth');
const { roundQty, roundMoney } = require('../services/rawMaterialService');

const router = express.Router();
const units = ['g', 'kg', 'ml', 'L', 'piece', 'pack'];

const materialPayload = body => ({
  name: String(body.name || '').trim(),
  category: String(body.category || '').trim() || null,
  sku: String(body.sku || '').trim() || null,
  unit: String(body.unit || 'kg'),
  minStock: Math.max(0, roundQty(body.minStock || 0)),
  costPerUnit: Math.max(0, roundMoney(body.costPerUnit || 0)),
  vendorId: Number(body.vendorId) || null,
  expiryDate: body.expiryDate || null,
  notes: String(body.notes || '').trim() || null,
  isActive: body.isActive === undefined ? true : Boolean(body.isActive)
});

const findMaterial = (id, shopType, options = {}) => RawMaterial.findOne({
  where: { id, shopType },
  ...options
});

router.get('/summary', auth, async (req, res) => {
  try {
    const materials = await RawMaterial.findAll({ where: { shopType: req.user.activeShop, isActive: true } });
    const stockValue = materials.reduce((sum, item) => sum + Number(item.stock) * Number(item.costPerUnit), 0);
    res.json({
      totalMaterials: materials.length,
      lowStockCount: materials.filter(item => Number(item.stock) <= Number(item.minStock)).length,
      outOfStockCount: materials.filter(item => Number(item.stock) <= 0).length,
      stockValue: roundMoney(stockValue)
    });
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
        { category: { [Op.like]: `%${search}%` } },
        { sku: { [Op.like]: `%${search}%` } }
      ];
    }
    const materials = await RawMaterial.findAll({ where, order: [['name', 'ASC']] });
    const products = await GroceryProduct.findAll({ where: { sourceType: 'own', isActive: true }, attributes: ['id', 'name', 'boq'] });
    const usage = new Map();
    products.forEach(product => (Array.isArray(product.boq) ? product.boq : []).forEach(line => {
      const id = Number(line.rawMaterialId);
      if (!id) return;
      if (!usage.has(id)) usage.set(id, []);
      usage.get(id).push({ id: product.id, name: product.name, qty: line.qty, unit: line.unit });
    }));
    res.json({
      materials: materials.map(material => ({ ...material.toJSON(), usedIn: usage.get(material.id) || [] }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/:id/movements', auth, async (req, res) => {
  try {
    const material = await findMaterial(req.params.id, req.user.activeShop);
    if (!material) return res.status(404).json({ message: 'Raw material not found' });
    const movements = await RawMaterialMovement.findAll({
      where: { rawMaterialId: material.id, shopType: req.user.activeShop },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
    });
    res.json({ material, movements });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const data = materialPayload(req.body);
    const openingStock = roundQty(req.body.openingStock || 0);
    if (!data.name) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Raw-material name is required' });
    }
    if (!units.includes(data.unit)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Select a valid stock unit' });
    }
    if (openingStock < 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Opening stock cannot be negative' });
    }
    const existing = await RawMaterial.findOne({ where: { name: data.name, shopType: req.user.activeShop }, transaction });
    if (existing) {
      await transaction.rollback();
      return res.status(409).json({ message: 'A raw material with this name already exists' });
    }
    const material = await RawMaterial.create({ ...data, stock: openingStock, shopType: req.user.activeShop }, { transaction });
    if (openingStock > 0) {
      await RawMaterialMovement.create({
        rawMaterialId: material.id,
        movementType: 'opening',
        direction: 'in',
        quantity: openingStock,
        balanceAfter: openingStock,
        unitCost: data.costPerUnit,
        referenceType: 'opening',
        notes: 'Opening raw-material stock',
        shopType: req.user.activeShop,
        createdBy: req.user.id
      }, { transaction });
    }
    await transaction.commit();
    res.status(201).json(material);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const material = await findMaterial(req.params.id, req.user.activeShop);
    if (!material) return res.status(404).json({ message: 'Raw material not found' });
    const data = materialPayload({ ...material.toJSON(), ...req.body });
    if (!data.name) return res.status(400).json({ message: 'Raw-material name is required' });
    if (!units.includes(data.unit)) return res.status(400).json({ message: 'Select a valid stock unit' });
    if (data.unit !== material.unit && Number(material.stock) !== 0) {
      return res.status(400).json({ message: 'Stock unit can only be changed when current stock is zero' });
    }
    await material.update(data);
    res.json(material);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ message: 'A raw material with this name already exists' });
    res.status(500).json({ message: error.message });
  }
});

router.post('/:id/adjustments', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const material = await findMaterial(req.params.id, req.user.activeShop, { transaction, lock: transaction.LOCK.UPDATE });
    if (!material) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Raw material not found' });
    }
    const allowed = {
      purchase: 'in',
      adjustment_in: 'in',
      adjustment_out: 'out',
      wastage: 'out',
      return_to_vendor: 'out'
    };
    const movementType = req.body.movementType;
    const direction = allowed[movementType];
    const quantity = roundQty(req.body.quantity);
    const unitCost = req.body.unitCost === undefined ? Number(material.costPerUnit) : Math.max(0, roundMoney(req.body.unitCost));
    if (!direction || !(quantity > 0)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Select a valid movement and quantity' });
    }
    const currentStock = Number(material.stock);
    if (direction === 'out' && quantity > currentStock + 0.0001) {
      await transaction.rollback();
      return res.status(400).json({ message: `Only ${currentStock} ${material.unit} is available` });
    }
    const newStock = roundQty(currentStock + (direction === 'in' ? quantity : -quantity));
    let newCost = Number(material.costPerUnit);
    if (movementType === 'purchase' && newStock > 0) {
      newCost = roundMoney(((currentStock * Number(material.costPerUnit)) + (quantity * unitCost)) / newStock);
    }
    await material.update({ stock: newStock, costPerUnit: newCost }, { transaction });
    const movement = await RawMaterialMovement.create({
      rawMaterialId: material.id,
      movementType,
      direction,
      quantity,
      balanceAfter: newStock,
      unitCost,
      referenceType: 'manual',
      notes: String(req.body.notes || '').trim() || null,
      shopType: req.user.activeShop,
      createdBy: req.user.id
    }, { transaction });
    await transaction.commit();
    res.status(201).json({ material, movement });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ message: error.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const material = await findMaterial(req.params.id, req.user.activeShop);
    if (!material) return res.status(404).json({ message: 'Raw material not found' });
    if (Number(material.stock) !== 0) {
      return res.status(409).json({ message: `Reduce ${material.name} stock to zero before archiving` });
    }
    const products = await GroceryProduct.findAll({ where: { sourceType: 'own', isActive: true }, attributes: ['name', 'boq'] });
    const linked = products.filter(product => (Array.isArray(product.boq) ? product.boq : []).some(line => Number(line.rawMaterialId) === material.id));
    if (linked.length) {
      return res.status(409).json({ message: `Remove this material from these recipes first: ${linked.map(product => product.name).join(', ')}` });
    }
    const movementCount = await RawMaterialMovement.count({ where: { rawMaterialId: material.id } });
    if (movementCount) {
      await material.update({ isActive: false });
      return res.json({ message: 'Raw material archived with its movement history', archived: true });
    }
    await material.destroy();
    res.json({ message: 'Raw material deleted', archived: false });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
